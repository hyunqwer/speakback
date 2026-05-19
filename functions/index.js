const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");
const os = require("os");
const path = require("path");
const fs = require("fs");
const YTDlpWrap = require("yt-dlp-wrap").default;

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
Use a warm, encouraging coaching tone — like a supportive teacher celebrating what the student did well and pointing to the next exciting step forward.
The feedback should be useful for the student, parent, and teacher.
For each area, provide what the student did well, then frame the next growth step as an addition — not a correction.
Do not output numeric scores.
Do not compare the student with other students.
Do not include disclaimer sentences about contests, judging, scoring, awards, pass/fail, or prediction.
Do not use Korean phrases such as "대회 점수", "심사 점수", "대회 결과", "무관합니다", "예측하지 않습니다", or "공식 평가".
NOTE: overall_feedback.summary combines both teacher analysis and a student-facing closing message. The final sentence should be warm and ready to send as-is.

[Tone Rules — STRICTLY FOLLOW]
NEVER use contrast conjunctions to connect praise and improvement.
FORBIDDEN patterns: "~했지만", "~했으나", "하지만", "그러나", "그런데", "반면에", "~에 비해", "아쉽게도", "~이 부족했어요", "~이 약했어요".
INSTEAD: State the strength as a complete positive sentence. Then open the next sentence with additive openers such as:
"여기에 ~도 더해 보면", "다음 발표에서는 ~도 시도해 보면", "이제 ~에 도전해 보면", "한 가지 더 해보고 싶은 건", "~까지 더하면 더욱 빛날 거야".
GOOD example: "내용이 정말 풍성했어요. 여기에 한두 가지 구체적인 예시를 더해 주면 더욱 완성도 있는 발표가 될 거예요."
BAD example: "내용은 좋았지만 구체적인 예시가 부족했어요."
Apply this rule to ALL text fields: well_done, needs_work, practice_mission, summary, strongest_point, priority_improvement, and timestamp comments.
${studentLevel === "elementary_low" ? "IMPORTANT: Do not use emoji in any output field." : ""}

Return ONLY valid JSON - no markdown fences, no extra text:
{
  "video_quality_note": "<영상 또는 음성 품질 이슈가 있으면 한국어로 작성. 없으면 null>",
  "overall_feedback": {
    "level": "Great Job | Good Work | Keep Going",
    "summary": "<3-4 Korean sentences. First 2-3 sentences: objective analytical note covering attitude, delivery, and content (third-person, for the teacher's reference). Final sentence: a warm, direct encouragement addressed to the student — one specific praise + one next challenge, written in a tone the teacher can copy and send as-is (e.g. '~했어요, 다음엔 ~해봐요'). The whole field should feel like a complete coaching note the teacher can share with the student or parent after light editing.>",
    "strongest_point": "<One specific strength in Korean>",
    "priority_improvement": "<One most important next growth challenge in Korean — framed as an exciting next step, not a weakness>"
  },
  "timestamp_comments": [
    { "time": "0:00", "type": "strength | improve", "comment": "<Specific Korean comment about that moment>" }
  ],
  "area_feedback": {
    "presentation_attitude": {
      "well_done": "<3-4 Korean sentences>",
      "needs_work": "<3-4 Korean sentences. Frame as the next exciting growth step — what to ADD or TRY next, not what was wrong. Use additive language.>",
      "practice_mission": "<One concrete Korean practice mission — written as a positive challenge, not a correction>"
    },
    "delivery_communication": {
      "well_done": "<3-4 Korean sentences>",
      "needs_work": "<3-4 Korean sentences. Frame as the next exciting growth step — what to ADD or TRY next, not what was wrong. Use additive language.>",
      "practice_mission": "<One concrete Korean practice mission — written as a positive challenge, not a correction>"
    },
    "content_organization": {
      "well_done": "<3-4 Korean sentences>",
      "needs_work": "<3-4 Korean sentences. Frame as the next exciting growth step — what to ADD or TRY next, not what was wrong. Use additive language.>",
      "practice_mission": "<One concrete Korean practice mission>"
    }
  },
  "next_practice_plan": [
    { "step": 1, "mission": "<First short practice task in Korean>", "how_to_practice": "<Specific instruction in Korean>" },
    { "step": 2, "mission": "<Second short practice task in Korean>", "how_to_practice": "<Specific instruction in Korean>" },
    { "step": 3, "mission": "<Third short practice task in Korean>", "how_to_practice": "<Specific instruction in Korean>" }
  ]
}
`;
}

// ---- 영상 URL 타입 감지 ----
function detectVideoType(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
    if (["youtube.com", "youtu.be", "youtube-nocookie.com"].includes(host)) return "youtube";
    if (host === "instagram.com") return "instagram";
  } catch (e) {}
  return null;
}

// yt-dlp 바이너리 경로 (Lambda /tmp에 캐시)
const YTDLP_BINARY = "/tmp/yt-dlp";

async function getYtDlpBinary() {
  if (!fs.existsSync(YTDLP_BINARY)) {
    console.log("yt-dlp 바이너리 다운로드 중...");
    await YTDlpWrap.downloadFromGithub(YTDLP_BINARY);
    fs.chmodSync(YTDLP_BINARY, 0o755);
    console.log("yt-dlp 바이너리 다운로드 완료");
  }
  return YTDLP_BINARY;
}

async function downloadVideoFromUrl(url) {
  const binaryPath = await getYtDlpBinary();
  const ytDlp = new YTDlpWrap(binaryPath);
  const outputPath = `/tmp/video_${Date.now()}.mp4`;
  await ytDlp.execPromise([
    url,
    "-o", outputPath,
    "-f", "best[ext=mp4]/best[height<=720]/best",
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout", "30",
  ]);
  return outputPath;
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

    const { youtubeUrl, instagramUrl, storagePath, mimeType, studentName, studentLevel } = req.body;
    const videoUrl = instagramUrl || youtubeUrl;
    const rubricType = "yoon";
    const prompt = buildYoonPrompt(studentLevel, studentName);

    if (!youtubeUrl && !instagramUrl && !storagePath) {
      res.status(400).json({ error: "youtubeUrl, instagramUrl 또는 storagePath가 필요합니다." });
      return;
    }

    let tmpPath = null;
    let storageFileToDelete = null;
    try {
      const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });

      let contents;

      if (youtubeUrl) {
        // YouTube: Gemini가 URL 직접 처리
        contents = [
          { text: prompt },
          { fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" } },
        ];
      } else if (instagramUrl) {
        // Instagram: yt-dlp로 다운로드 후 Gemini File API 업로드
        console.log("Instagram 영상 다운로드 시작:", instagramUrl);
        tmpPath = await downloadVideoFromUrl(instagramUrl);
        console.log("Instagram 영상 다운로드 완료:", tmpPath);

        const uploadResult = await ai.files.upload({
          file: tmpPath,
          config: {
            mimeType: "video/mp4",
            displayName: studentName ? `${studentName}_instagram` : "instagram_video",
          },
        });

        const readyFile = await waitForFileReady(ai, uploadResult.name);

        contents = [
          { text: prompt },
          { fileData: { fileUri: readyFile.uri, mimeType: readyFile.mimeType } },
        ];
      } else {
        // 파일 업로드: Firebase Storage에서 다운로드 후 Gemini File API 업로드
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
        videoSource: youtubeUrl ? "youtube" : instagramUrl ? "instagram" : "file",
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
        videoSource: youtubeUrl ? "youtube" : instagramUrl ? "instagram" : "file",
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
