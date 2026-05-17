const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");
const os = require("os");
const path = require("path");
const fs = require("fs");

admin.initializeApp();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Prompt settings — 교사용 코칭 가이드 기준
const STUDENT_LEVEL_INSTRUCTIONS = {
  elementary_low:  "학생은 미취학~초등 3학년입니다. 코칭 멘트는 짧고 따뜻하게 작성하세요. 발음 교정보다 자신감·참여·간단한 문장 완성을 우선하세요. 학부모 요약에는 가정에서 구체적으로 칭찬해 줄 포인트를 1개 이상 포함하세요.",
  elementary_high: "학생은 초등 4~6학년입니다. 발음, 유창성, 어휘·문장 수준, 내용 전개를 균형 있게 다루세요. 코칭 멘트는 학생이 이해할 수 있는 구체적인 표현으로 작성하세요. 학부모 요약은 칭찬과 다음 성장 포인트가 자연스럽게 이어지게 작성하세요.",
  middle:          "학생은 중학생입니다. 분석적인 코칭이 가능합니다. 발음·유창성·문장 정확성·어휘 선택·내용 구성·표현 확장을 구체적으로 지도하세요. 학부모 요약은 성장 포인트 중심으로 자연스럽고 덜 기계적인 문체로 작성하세요.",
};

function buildYoonPrompt(studentLevel, studentName) {
  const levelNote = STUDENT_LEVEL_INSTRUCTIONS[studentLevel] || STUDENT_LEVEL_INSTRUCTIONS.elementary_high;
  return `You are Yoon's SpeakBack — an AI that analyzes student English presentation videos for Korean English teachers.

Your output is a TEACHER-FACING coaching guide, NOT a student report.
The teacher will use this to plan and run the next coaching session immediately.

Student name: ${studentName || "학생"}
Level note: ${levelNote}

Watch the entire video carefully. Be specific and evidence-based.
Write ALL text fields in Korean. Do not use emoji or decorative symbols.
Do not assign numeric scores, rankings, pass/fail, or contest judgments.
Do not repeat the same content across different fields.
Balance the feedback across speaking ability as a whole. Do not over-focus on pronunciation.
Explicitly consider these dimensions when evidence is available:
- pronunciation and intonation
- fluency, pausing, rhythm, and speaking pace
- vocabulary level and appropriateness
- sentence level, grammar, and ability to complete ideas
- content development, organization, examples, and clarity of message
- confidence, eye contact, posture, and audience awareness
If grammar is imperfect but communication is fluent and understandable, acknowledge that strength.
For parent_summary, sound like a caring teacher writing to a parent. Avoid stiff AI-like phrasing. For younger students, include a concrete "칭찬해 주세요" point when appropriate.

[Output requirements]

1. one_line_diagnosis
   2-3 Korean sentences. Teacher-focused read: this student's biggest strength and the single most impactful coaching point for the next session. Mention whether the next coaching focus is pronunciation, fluency, sentence/vocabulary growth, content organization, or presentation attitude.

2. overall_feedback
   - level: "Great Job" | "Good Work" | "Keep Going"
   - summary: 3-4 Korean sentences. Objective, analytical description for the teacher's internal notes across pronunciation/intonation, fluency, vocabulary/sentence level, content organization, and presentation attitude. Do not make it pronunciation-only unless that is truly the dominant issue.

3. coaching_priorities (2-4 items, ranked by urgency)
   Each item:
   - rank: integer (1 = most urgent)
   - focus: short coaching focus point (8-12 words). Across the list, include non-pronunciation areas such as fluency, vocabulary/sentence growth, or content organization when there is evidence.
   - urgency: "높음" | "중간" | "낮음"
   - reason: 1-2 sentences — specific evidence from the video (what was heard/seen)
   - handling: 1-2 sentences — concrete in-class action to address this

4. video_review_points (2-5 specific moments)
   Each item:
   - time: approximate timestamp, e.g. "0:24"
   - type: "strength" | "improve"
   - observation: what was heard or seen at that exact moment (1 sentence)
   - teacher_action: what the teacher should DO at this moment in class (e.g. "해당 구간 2회 재생 후 단어 카드 지도")
   - coaching_script: A process-based script in Korean for the teacher to use at this moment. Follow this 3-step structure: (1) teacher models the target aloud, (2) teacher asks the student to self-diagnose ("어느 부분이 어려웠어?"), (3) focused repetition on what the student identified. Do NOT prescribe a specific phonemic fix or use Korean phonetic transcription (한글 발음 전사). The teacher will identify the exact issue on the spot. Tone: warm, direct, age-appropriate informal (~야/이야, ~해보자).

5. coaching_procedure (5-7 steps as strings)
   Concrete in-class steps. Be specific — include timestamps and actions.
   Example: "0:02 장면 보여주며 시작 태도 칭찬", "1:06 구간 함께 듣기 → until soft 교사 모델링 → 학생 3회 따라 말하기"
   Each step must be a distinct classroom action. Do NOT repeat the same coaching content already covered in coaching_priorities. If referencing a priority item, write it as a brief action step (e.g. "우선순위 1 항목 집중 연습") rather than restating the full reason/handling.

6. coaching_scripts (3-5 items)
   Ready-to-use teacher scripts for specific situations.
   Each item:
   - situation: when to use this (e.g. "발음이 불명확할 때", "재녹화 전")
   - script: Process-based script — (1) teacher models, (2) student self-diagnoses the difficulty, (3) targeted repetition drill on what the student identified. Do NOT use Korean phonetic transcription (한글 발음 전사) or prescribe a specific phonemic fix. Korean, warm, direct, age-appropriate.

7. timed_coaching
   - min3: single most urgent action only (1-2 sentences)
   - min5: 2-3 focus areas with specific actions (2-3 sentences)
   - min10: full session — video review + correction + content + optional re-recording (3-5 sentences)

8. re_recording_mission
   2-3 achievable targets for re-recording. Start with "같은 발표문으로 다시 녹화하되..."

9. parent_summary
   2-3 warm Korean sentences for parents. Lead with specific praise, include one natural home praise/coaching point when appropriate, and end with a forward-looking growth note. Ready to send. No jargon. Avoid formulaic AI wording.

10. area_feedback (standard 3-area breakdown for reference)
    presentation_attitude, delivery_communication, content_organization.
    Each: well_done (2-3 sentences), needs_work (2-3 sentences), practice_mission (1 concrete mission).
    - presentation_attitude: posture, gaze, facial expression, confidence, audience awareness.
    - delivery_communication: pronunciation, intonation, fluency, pauses, rhythm, pace, volume.
    - content_organization: vocabulary level, sentence level, grammar patterns, idea development, examples, opening/closing, coherence.

11. video_quality_note
    If audio/video quality limits analysis, note briefly. Otherwise null.

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "video_quality_note": "<string or null>",
  "one_line_diagnosis": "<string>",
  "overall_feedback": {
    "level": "Great Job | Good Work | Keep Going",
    "summary": "<string>"
  },
  "coaching_priorities": [
    { "rank": 1, "focus": "<string>", "urgency": "높음|중간|낮음", "reason": "<string>", "handling": "<string>" }
  ],
  "video_review_points": [
    { "time": "0:00", "type": "strength|improve", "observation": "<string>", "teacher_action": "<string>", "coaching_script": "<string>" }
  ],
  "coaching_procedure": ["<step>", "<step>"],
  "coaching_scripts": [
    { "situation": "<string>", "script": "<string>" }
  ],
  "timed_coaching": {
    "min3": "<string>",
    "min5": "<string>",
    "min10": "<string>"
  },
  "re_recording_mission": "<string>",
  "parent_summary": "<string>",
  "area_feedback": {
    "presentation_attitude": { "well_done": "<string>", "needs_work": "<string>", "practice_mission": "<string>" },
    "delivery_communication": { "well_done": "<string>", "needs_work": "<string>", "practice_mission": "<string>" },
    "content_organization":   { "well_done": "<string>", "needs_work": "<string>", "practice_mission": "<string>" }
  }
}`;
}

// Extract the first complete JSON object from the model response.
function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("AI 응답에서 JSON을 찾을 수 없습니다.");

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape)              { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true;  continue; }
    if (ch === '"')          { inString = !inString; continue; }
    if (inString)            continue;
    if (ch === "{")          depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error("AI 응답의 JSON 형식이 완전하지 않습니다.");
}

// Wait until Gemini finishes processing the uploaded file.
async function waitForFileReady(ai, fileName) {
  let file = await ai.files.get({ name: fileName });
  while (file.state === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 2500));
    file = await ai.files.get({ name: fileName });
  }
  if (file.state === "FAILED") {
    throw new Error("Gemini 파일 처리 실패: " + fileName);
  }
  return file;
}

// Cloud Function: evaluateSpeech
exports.evaluateSpeech = onRequest(
  {
    secrets: [geminiApiKey],
    timeoutSeconds: 300,
    memory: "1GiB",
    region: "asia-northeast3", // Seoul
    cors: true,
    invoker: "public",
  },
  async (req, res) => {
    // CORS
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { youtubeUrl, storagePath, mimeType, studentName, studentLevel } = req.body;
    const rubricType = "yoon";
    const prompt = buildYoonPrompt(studentLevel, studentName);

    if (!youtubeUrl && !storagePath) {
      res.status(400).json({ error: "youtubeUrl 또는 storagePath가 필요합니다." });
      return;
    }

    let tmpPath = null;
    let storageFileToDelete = null;
    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      let contents;

      if (youtubeUrl) {
        // Gemini can process a YouTube URL directly.
        contents = [
          { text: prompt },
          { fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" } },
        ];
      } else {
        // Firebase Storage file download, then upload to Gemini File API.
        const bucket = admin.storage().bucket();
        const storageFile = bucket.file(storagePath);
        storageFileToDelete = storageFile; // 분석 완료 후 삭제를 위해 참조 보관
        const ext = path.extname(storagePath) || ".mp4";
        tmpPath = path.join(os.tmpdir(), `speech_${Date.now()}${ext}`);

        await storageFile.download({ destination: tmpPath });

        const uploadResult = await ai.files.upload({
          file: tmpPath,
          config: {
            mimeType: mimeType || "video/mp4",
            displayName: `speech_video_${Date.now()}`,
          },
        });

        const readyFile = await waitForFileReady(ai, uploadResult.name);

        contents = [
          { text: prompt },
          { fileData: { fileUri: readyFile.uri, mimeType: readyFile.mimeType } },
        ];
      }

      // Request the analysis from Gemini.
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: contents }],
        config: { temperature: 0 },
      });

      console.log("Gemini usage metadata", {
        rubricType,
        videoSource: youtubeUrl ? "youtube" : "file",
        usageMetadata: response.usageMetadata || response.usage_metadata || null,
      });

      const rawText = response.candidates[0].content.parts[0].text;

      // Extract the first complete JSON object from the model response.
      const evaluation = extractJson(rawText);

      // Save feedback to Firestore.
      const db = admin.firestore();
      const docRef = await db.collection("feedbacks").add({
        studentName: studentName || "학생",
        studentClass: req.body.studentClass || "",
        studentLevel: studentLevel || "elementary_high",
        rubricType,
        evaluation,
        videoSource: youtubeUrl ? "youtube" : "file",
        youtubeUrl: youtubeUrl || null,
        storagePath: storagePath || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({
        success: true,
        studentName: studentName || "학생",
        feedbackId: docRef.id,
        rubricType,
        evaluation,
      });
    } catch (error) {
      console.error("evaluateSpeech error:", error);
      res.status(500).json({ success: false, error: error.message });
    } finally {
      // Clean up temporary file.
      if (tmpPath && fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
      // Clean up Firebase Storage file after analysis.
      if (storageFileToDelete) {
        try {
          await storageFileToDelete.delete();
          console.log("Storage 파일 삭제 완료:", storagePath);
        } catch (deleteErr) {
          console.warn("Storage 파일 삭제 실패 (무시됨):", deleteErr.message);
        }
      }
    }
  }
);
