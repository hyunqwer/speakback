const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");
const os = require("os");
const path = require("path");
const fs = require("fs");

admin.initializeApp();

const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Prompt settings
const STUDENT_LEVEL_INSTRUCTIONS = {
  elementary_low: "The student is in preschool to elementary grade 3. Use short, easy Korean sentences. Do not use emoji or decorative symbols anywhere in the JSON values. Keep the tone warm and simple.",
  elementary_high: "The student is in elementary grades 4-6. Balance specific praise with concrete improvement coaching. Use clear Korean that students, parents, and teachers can understand.",
  middle: "The student is in middle school. Give slightly more analytical coaching and explain the reason behind each improvement mission in Korean.",
};

function buildYoonPrompt(studentLevel, studentName) {
  const levelInstruction = STUDENT_LEVEL_INSTRUCTIONS[studentLevel] || STUDENT_LEVEL_INSTRUCTIONS.elementary_high;
  return `
You are an expert English presentation coach for Yoon's SpeakBack.

Student name: ${studentName || "student"}
Audience level instruction: ${levelInstruction}

You are reviewing a student's English presentation practice video.
Your role is to provide practical coaching feedback that helps the student improve the next presentation.
Do not output numeric scores, rankings, predicted awards, or pass/fail judgments.
Do not explain or mention this restriction in the feedback.

Evaluate common presentation skills:
- organizing ideas before speaking,
- presenting a clear message,
- using posture, eye contact, gestures, facial expression, and confidence,
- speaking with clear pronunciation, natural stress, intonation, pace, breathing, and volume,
- staying on topic,
- using a clear opening, body, and conclusion,
- using topic-appropriate vocabulary and natural expression chunks.

Watch the entire video carefully before giving feedback.
Be specific, fair, and educational.
Do not give vague praise.
Do not assume details that are not visible or audible in the video.
If video or audio quality limits evaluation, state that clearly in video_quality_note.

[Feedback Areas]
1. PRESENTATION ATTITUDE (발표 태도): posture, eye contact, gestures, facial expression, confidence, audience awareness, calm beginning, clear ending.
2. DELIVERY & COMMUNICATION (전달력): pronunciation clarity, stress, intonation, pace, pauses, chunking, breathing, volume, fluency, hesitation, repetition, fillers.
3. CONTENT & ORGANIZATION (내용 구성): clear topic, opening, logical body, supporting details/examples, conclusion, staying on topic, vocabulary, natural chunks.

[Timestamp Comments]
Include 2-5 timestamp comments when you can identify specific visible or audible moments.
Use approximate timestamps such as "0:12".
If timestamps are not reliable, return an empty array.

[Pronunciation Caution]
Do not mark homophones such as "flour/flower", "right/write", or "see/sea" as pronunciation errors.
Do not treat speech-to-text recognition mistakes as the student's pronunciation mistakes.
Do not overcorrect small accent differences. Mention only issues that clearly affect communication.
For young Korean learners, focus on communication clarity and improvement, not native-like perfection.

[Overall Level]
Assign ONE label based on overall coaching impression:
- "Great Job": strong presentation skills overall
- "Good Work": solid effort with clear areas to grow
- "Keep Going": early stage, needs focused practice
Use this only as a short encouragement label. Do not explain what the label is not.

[Feedback Style]
Write all feedback in Korean.
Use a professional but encouraging coaching tone.
The feedback should be useful for the student, parent, and teacher.
For each area, provide what the student did well, what should improve, and one concrete practice mission.
Do not output numeric scores.
Do not compare the student with other students.
Do not include disclaimer sentences about contests, judging, scoring, awards, pass/fail, or prediction.
Do not use Korean phrases such as "대회 점수", "심사 점수", "대회 결과", "무관합니다", "예측하지 않습니다", or "공식 평가".
IMPORTANT: overall_feedback.summary and teacher_comment_suggestion must be clearly different.
- summary: analytical, third-person, for the teacher's internal use.
- teacher_comment_suggestion: warm, first-person coaching voice, addressed to the student, ready to send.
${studentLevel === "elementary_low" ? "IMPORTANT: Do not use emoji in any output field." : ""}

Return ONLY valid JSON - no markdown fences, no extra text:
{
  "video_quality_note": "<영상 또는 음성 품질 이슈가 있으면 한국어로 작성. 없으면 null>",
  "overall_feedback": {
    "level": "Great Job | Good Work | Keep Going",
    "summary": "<3-4 Korean sentences for the teacher's internal review. Objectively describe the student's overall presentation performance across all three areas (attitude, delivery, content). Be specific and analytical — avoid vague praise. This is NOT a message to the student or parent.>",
    "strongest_point": "<One specific strength in Korean>",
    "priority_improvement": "<One most important improvement point in Korean>"
  },
  "timestamp_comments": [
    { "time": "0:00", "type": "strength | improve", "comment": "<Specific Korean comment about that moment>" }
  ],
  "area_feedback": {
    "presentation_attitude": {
      "well_done": "<3-4 Korean sentences>",
      "needs_work": "<3-4 Korean sentences>",
      "practice_mission": "<One concrete Korean practice mission>"
    },
    "delivery_communication": {
      "well_done": "<3-4 Korean sentences>",
      "needs_work": "<3-4 Korean sentences>",
      "practice_mission": "<One concrete Korean practice mission>"
    },
    "content_organization": {
      "well_done": "<3-4 Korean sentences>",
      "needs_work": "<3-4 Korean sentences>",
      "practice_mission": "<One concrete Korean practice mission>"
    }
  },
  "next_practice_plan": [
    { "step": 1, "mission": "<First short practice task in Korean>", "how_to_practice": "<Specific instruction in Korean>" },
    { "step": 2, "mission": "<Second short practice task in Korean>", "how_to_practice": "<Specific instruction in Korean>" },
    { "step": 3, "mission": "<Third short practice task in Korean>", "how_to_practice": "<Specific instruction in Korean>" }
  ],
  "teacher_comment_suggestion": "<2-3 Korean sentences written AS the teacher speaking directly to the student (use '~했어요', '~해보세요' tone). This should be warm, encouraging, and ready to send to the student or parent as-is. It must feel DIFFERENT from the summary — focus on one key praise and one actionable next step, written in a personal coaching voice. Do NOT repeat the summary.>"
}
`;
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
        contents = [
          { text: prompt },
          { fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" } },
        ];
      } else {
        const bucket = admin.storage().bucket();
        const storageFile = bucket.file(storagePath);
        storageFileToDelete = storageFile;
        const ext = path.extname(storagePath) || ".mp4";
        tmpPath = path.join(os.tmpdir(), `speech_${Date.now()}${ext}`);

        await storageFile.download({ destination: tmpPath });

        const uploadResult = await ai.files.upload({
          file: tmpPath,
          config: {
            mimeType: mimeType || "video/mp4",
            displayName: studentName ? `${studentName}_speech` : "speech_video",
          },
        });

        const readyFile = await waitForFileReady(ai, uploadResult.name);

        contents = [
          { text: prompt },
          { fileData: { fileUri: readyFile.uri, mimeType: readyFile.mimeType } },
        ];
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: contents }],
        config: { temperature: 0 },
      });

      console.log("Gemini usage metadata", {
        studentName: studentName || "student",
        rubricType,
        videoSource: youtubeUrl ? "youtube" : "file",
        usageMetadata: response.usageMetadata || response.usage_metadata || null,
      });

      const rawText = response.candidates[0].content.parts[0].text;
      const evaluation = extractJson(rawText);

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
      if (tmpPath && fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
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
