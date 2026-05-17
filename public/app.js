// Firebase ?ㅼ젙
const firebaseConfig = {
  apiKey: "AIzaSyAQqVLX0WrIIjqJbrVr5aqzmqgapWz6kQg",
  authDomain: "yoons-speakback-v0.firebaseapp.com",
  projectId: "yoons-speakback-v0",
  storageBucket: "yoons-speakback-v0.firebasestorage.app",
  messagingSenderId: "1063861463644",
  appId: "1:1063861463644:web:34e4c82fa335cb381e5499",
  measurementId: "G-6T3S34G374"
};

let firebaseStorageApi = null;

// Cloud Function 吏곸젒 URL (asia-northeast3 Seoul)
const FUNCTION_URL = "/api/evaluateSpeech";

// ?곹깭
let selectedFile = null;
let activeTab = "file"; // "file" | "youtube"
let currentEval = null;
let currentStudentName = "";
let currentStudentClass = "";
let currentRubricType = "yoon";
let currentFeedbackId = null;
let selectedStudentLevel = ""; // 미선택 상태로 시작
let selectedPreviewUrl = "";
let feedbackEditMode = false;
let retryPayload = null;
let retryStudentName = "";
let retryRubricType = "yoon";
let isCompressingVideo = false;
let ffmpegApi = null;
let fileSelectionToken = 0;

const UPLOAD_MAX_MB = 100;
const COMPRESSED_TARGET_MB = 90;

// 탭 전환
window.switchTab = (tab) => {
  activeTab = tab;
  document.getElementById("tab-file")?.classList.toggle("active", tab === "file");
  document.getElementById("tab-youtube")?.classList.toggle("active", tab === "youtube");
  document.getElementById("tab-file")?.setAttribute("aria-selected", tab === "file");
  document.getElementById("tab-youtube")?.setAttribute("aria-selected", tab === "youtube");
  document.getElementById("panel-file")?.classList.toggle("active", tab === "file");
  document.getElementById("panel-youtube")?.classList.toggle("active", tab === "youtube");
};

window.handleDragOver = (e) => {
  e.preventDefault();
  document.getElementById("dropZone").classList.add("drag-over");
};

window.handleDragLeave = () => {
  document.getElementById("dropZone").classList.remove("drag-over");
};

window.handleDrop = (e) => {
  e.preventDefault();
  document.getElementById("dropZone").classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file) setSelectedFile(file);
};

window.handleFileSelect = (e) => {
  const file = e.target.files[0];
  if (file) setSelectedFile(file);
};

function bindFileInputHandlers() {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("dragover", window.handleDragOver);
  dropZone.addEventListener("dragleave", window.handleDragLeave);
  dropZone.addEventListener("drop", window.handleDrop);
  fileInput.addEventListener("change", window.handleFileSelect);
}

function bindPageActions() {
  document.getElementById("tab-file")?.addEventListener("click", () => window.switchTab("file"));
  document.getElementById("tab-youtube")?.addEventListener("click", () => window.switchTab("youtube"));
  document.getElementById("submitBtn")?.addEventListener("click", () => window.handleSubmit());
  document.getElementById("youtubeUrl")?.addEventListener("input", () => window.validateYoutubeUrl());
  document.getElementById("removeFileBtn")?.addEventListener("click", removeSelectedFile);
  document.getElementById("retryBtn")?.addEventListener("click", retryLastEvaluation);
  // Sticky 액션바
  document.getElementById("stickyEditBtn")?.addEventListener("click", toggleFeedbackEdit);
  document.getElementById("stickyPdfBtn")?.addEventListener("click", () => window.printFeedback());
  document.querySelectorAll(".level-card").forEach((btn) => {
    btn.addEventListener("click", () => setStudentLevel(btn.dataset.level));
  });
  // 학부모 요약 복사 버튼
  document.getElementById("copyTeacherCommentBtn")?.addEventListener("click", copyTeacherComment);
}

// ── 사용 방법 가이드 모달 ──────────────────────────────────
const GUIDE_SEEN_KEY = "speakback_guide_seen";

window.showGuideModal = () => {
  document.getElementById("guideModal")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

function closeGuideModal() {
  if (document.getElementById("guideNoSee")?.checked) {
    localStorage.setItem(GUIDE_SEEN_KEY, "1");
  }
  document.getElementById("guideModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

function initGuideModal() {
  if (!localStorage.getItem(GUIDE_SEEN_KEY)) {
    window.showGuideModal();
  }
  document.getElementById("guideStartBtn")?.addEventListener("click", closeGuideModal);
  document.getElementById("modalCloseBtn")?.addEventListener("click", closeGuideModal);
  document.getElementById("guideModal")?.addEventListener("click", (e) => {
    if (e.target.id === "guideModal") closeGuideModal();
  });
}

// ── 히스토리 패널 이벤트 위임 (초기화 시 한 번만 등록) ────────
// onclick 인라인 핸들러에 JSON.stringify 문자열을 넣으면
// 큰따옴표가 HTML 속성을 깨뜨려 이벤트가 실행되지 않는 문제를 방지.
function initHistoryListClickHandler() {
  const listEl = document.getElementById("historyList");
  if (!listEl) return;
  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".history-item[data-history-id]");
    if (btn) window.loadHistoryItem(btn.dataset.historyId);
  });
}
// ─────────────────────────────────────────────────────────

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindFileInputHandlers();
    bindPageActions();
    initGuideModal();
    initHistoryListClickHandler();
  });
} else {
  bindFileInputHandlers();
  bindPageActions();
  initGuideModal();
  initHistoryListClickHandler();
}

async function setSelectedFile(file) {
  if (!file) return;

  const selectionToken = ++fileSelectionToken;
  hideRetryBox();
  clearCompressionStatus();
  setSubmitDisabled(false);

  const originalFile = file;
  const originalMb = bytesToMb(originalFile.size);
  let compressionNotice = "";

  if (shouldCompressVideo(originalFile)) {
    try {
      setCompressingVideo(true);
      file = await compressVideoFile(originalFile);
      if (selectionToken !== fileSelectionToken) return;
      const compressedMb = bytesToMb(file.size);
      compressionNotice = `원본 ${originalMb.toFixed(1)}MB를 AI 분석용 ${compressedMb.toFixed(1)}MB 영상으로 압축했습니다.`;
    } catch (err) {
      if (selectionToken !== fileSelectionToken) return;
      clearCompressionStatus();
      const message = err?.message || "알 수 없는 오류";
      if (originalFile.size > UPLOAD_MAX_MB * 1024 * 1024) {
        selectedFile = null;
        clearSelectedFilePreview();
        alert(`영상 압축에 실패했습니다: ${message}\n\n현재 업로드 제한은 ${UPLOAD_MAX_MB}MB입니다.`);
        return;
      }
      showFileWarning(`자동 압축에 실패해 원본으로 진행합니다. (${message})`);
      file = originalFile;
    } finally {
      if (selectionToken === fileSelectionToken) setCompressingVideo(false);
    }
  }

  if (selectionToken !== fileSelectionToken) return;

  if (file.size > UPLOAD_MAX_MB * 1024 * 1024) {
    selectedFile = null;
    clearSelectedFilePreview();
    alert(`파일 크기가 ${UPLOAD_MAX_MB}MB를 초과합니다. 압축 후에도 업로드 제한을 넘었습니다.`);
    return;
  }

  selectedFile = file;
  renderSelectedFile(file, originalFile);
  validateVideoFile(file);
  if (compressionNotice) showFileWarning(compressionNotice);
}

function renderSelectedFile(file, originalFile = file) {
  const fileInfo = document.getElementById("fileInfo");
  const compressed = file !== originalFile;
  const originalText = compressed ? ` · 원본 ${bytesToMb(originalFile.size).toFixed(1)} MB` : "";
  if (fileInfo) {
    fileInfo.textContent = `선택된 파일: ${file.name} (${bytesToMb(file.size).toFixed(1)} MB${originalText})`;
    fileInfo.classList.remove("hidden");
  }

  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = URL.createObjectURL(file);
  const preview = document.getElementById("videoPreview");
  const previewWrap = document.getElementById("videoPreviewWrap");
  if (preview && previewWrap) {
    preview.src = selectedPreviewUrl;
    previewWrap.classList.remove("hidden");
  }
}

function shouldCompressVideo(file) {
  if (!file?.type?.startsWith("video/")) return false;
  return file.size > UPLOAD_MAX_MB * 1024 * 1024;
}

function bytesToMb(bytes) {
  return bytes / 1024 / 1024;
}

function setCompressingVideo(on) {
  isCompressingVideo = on;
  setSubmitDisabled(on);
  const fileInput = document.getElementById("fileInput");
  if (fileInput) fileInput.disabled = on;
}

function setSubmitDisabled(disabled) {
  const submitBtn = document.getElementById("submitBtn");
  if (!submitBtn) return;
  submitBtn.disabled = disabled;
  submitBtn.textContent = disabled ? "영상 압축 중..." : "AI 피드백 생성하기";
}

function updateCompressionStatus(percent, text, title = "용량이 커서 영상 압축 중...") {
  const wrap = document.getElementById("compressionStatus");
  const titleEl = document.getElementById("compressionStatusTitle");
  const percentEl = document.getElementById("compressionPercent");
  const textEl = document.getElementById("compressionStatusText");
  const bar = document.getElementById("compressionBarFill");
  const normalized = Math.max(0, Math.min(100, Math.round(percent || 0)));

  wrap?.classList.remove("hidden");
  if (titleEl) titleEl.textContent = title;
  if (percentEl) percentEl.textContent = `${normalized}%`;
  if (textEl) textEl.textContent = text || "AI 분석용으로 용량을 줄이고 있습니다.";
  if (bar) bar.style.width = `${normalized}%`;
}

function clearCompressionStatus() {
  const wrap = document.getElementById("compressionStatus");
  const bar = document.getElementById("compressionBarFill");
  if (wrap) wrap.classList.add("hidden");
  if (bar) bar.style.width = "0%";
}

function showFileWarning(message) {
  const warning = document.getElementById("fileWarning");
  if (!warning) return;
  warning.textContent = message;
  warning.classList.remove("hidden");
}

function clearSelectedFilePreview() {
  const fileInfo = document.getElementById("fileInfo");
  const preview = document.getElementById("videoPreview");
  const previewWrap = document.getElementById("videoPreviewWrap");
  if (fileInfo) fileInfo.classList.add("hidden");
  if (preview) preview.removeAttribute("src");
  if (previewWrap) previewWrap.classList.add("hidden");
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = "";
}

async function compressVideoFile(file) {
  if (canUseNativeVideoCompression()) {
    try {
      return await compressVideoFileNative(file);
    } catch (err) {
      console.warn("Native video compression failed, falling back to ffmpeg.wasm:", err);
      updateCompressionStatus(3, "파일 용량이 커서 예비 압축 엔진으로 변환을 다시 시도하고 있습니다.");
    }
  }

  updateCompressionStatus(3, "파일 용량이 커서 압축 모듈을 불러오는 중입니다. 처음에는 조금 오래 걸릴 수 있어요.");
  const { ffmpeg, fetchFile } = await loadFfmpeg();
  const inputName = `input.${getFileExtension(file.name) || "mp4"}`;
  const outputName = "speakback-compressed.mp4";

  updateCompressionStatus(8, "원본 영상이 커서 압축 변환을 준비하는 중입니다.");
  await ffmpeg.writeFile(inputName, await fetchFile(file));

  const firstPass = [
    "-i", inputName,
    "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease,format=yuv420p",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-b:v", "1800k",
    "-maxrate", "2200k",
    "-bufsize", "4400k",
    "-r", "24",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    outputName,
  ];

  await runFfmpegCommand(ffmpeg, firstPass, "AI 분석용 720p 영상으로 압축 중입니다.");
  let data = await ffmpeg.readFile(outputName);
  let blob = new Blob([data], { type: "video/mp4" });

  if (blob.size > COMPRESSED_TARGET_MB * 1024 * 1024) {
    await ffmpeg.deleteFile(outputName).catch(() => {});
    const secondPass = [
      "-i", inputName,
      "-vf", "scale=854:854:force_original_aspect_ratio=decrease,format=yuv420p",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "30",
      "-b:v", "1000k",
      "-maxrate", "1300k",
      "-bufsize", "2600k",
      "-r", "24",
      "-c:a", "aac",
      "-b:a", "80k",
      "-movflags", "+faststart",
      outputName,
    ];
    await runFfmpegCommand(ffmpeg, secondPass, "용량을 더 줄이기 위해 한 번 더 압축 중입니다.");
    data = await ffmpeg.readFile(outputName);
    blob = new Blob([data], { type: "video/mp4" });
  }

  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  if (!blob.size) throw new Error("압축 결과 파일이 비어 있습니다.");
  updateCompressionStatus(100, "압축이 완료되었습니다.", "압축 완료");

  const baseName = file.name.replace(/\.[^.]+$/, "") || "speech";
  return new File([blob], `${baseName}_compressed.mp4`, {
    type: "video/mp4",
    lastModified: Date.now(),
  });
}

function canUseNativeVideoCompression() {
  return Boolean(
    window.MediaRecorder &&
    HTMLCanvasElement.prototype.captureStream &&
    (HTMLMediaElement.prototype.captureStream || HTMLMediaElement.prototype.mozCaptureStream)
  );
}

async function compressVideoFileNative(file) {
  const mimeType = getBestMediaRecorderMimeType();
  if (!mimeType) throw new Error("이 브라우저는 영상 자동 압축을 지원하지 않습니다.");

  updateCompressionStatus(3, "파일 용량이 커서 브라우저 기본 압축을 준비하는 중입니다.");
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = sourceUrl;
  video.muted = false;
  video.volume = 0;
  video.playsInline = true;
  video.preload = "metadata";
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.top = "-9999px";
  document.body.appendChild(video);

  try {
    await waitForVideoMetadata(video);
    const { width, height } = getCompressedDimensions(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("영상 압축용 캔버스를 만들 수 없습니다.");

    const fps = 24;
    const videoStream = canvas.captureStream(fps);
    const sourceStream = captureVideoElementStream(video);
    const audioTracks = sourceStream ? sourceStream.getAudioTracks() : [];
    const mixedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioTracks,
    ]);

    const chunks = [];
    const recorder = new MediaRecorder(mixedStream, {
      mimeType,
      videoBitsPerSecond: 1_800_000,
      audioBitsPerSecond: 96_000,
    });

    const recordingDone = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => reject(new Error(recorder.error?.message || "브라우저 영상 압축 중 오류가 발생했습니다."));
      recorder.onstop = resolve;
    });

    updateCompressionStatus(5, "파일 용량이 커서 AI 분석 전에 영상을 재인코딩하고 있습니다. 영상 길이만큼 시간이 걸릴 수 있어요.");
    recorder.start(1000);

    let drawFrameId = 0;
    const drawFrame = () => {
      if (!video.paused && !video.ended) {
        ctx.drawImage(video, 0, 0, width, height);
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
        const pct = 5 + Math.min(92, (video.currentTime / duration) * 92);
        updateCompressionStatus(pct, "파일 용량이 커서 압축 변환 중입니다. 화면을 닫지 마세요.");
        drawFrameId = requestAnimationFrame(drawFrame);
      }
    };

    video.currentTime = 0;
    await video.play();
    drawFrame();

    await new Promise((resolve, reject) => {
      video.onended = resolve;
      video.onerror = () => reject(new Error("원본 영상을 재생할 수 없어 압축하지 못했습니다."));
    });

    if (drawFrameId) cancelAnimationFrame(drawFrameId);
    if (recorder.state !== "inactive") recorder.stop();
    await recordingDone;

    stopMediaStream(mixedStream);
    stopMediaStream(sourceStream);

    const outputType = mimeType.split(";")[0];
    const blob = new Blob(chunks, { type: outputType });
    if (!blob.size) throw new Error("압축 결과 파일이 비어 있습니다.");

    updateCompressionStatus(100, "압축이 완료되었습니다.", "압축 완료");
    const ext = outputType.includes("mp4") ? "mp4" : "webm";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "speech";
    return new File([blob], `${baseName}_compressed.${ext}`, {
      type: outputType,
      lastModified: Date.now(),
    });
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}

function getBestMediaRecorderMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error("영상 정보를 읽을 수 없습니다."));
  });
}

function getCompressedDimensions(sourceWidth, sourceHeight) {
  const maxEdge = 1280;
  const ratio = Math.min(1, maxEdge / Math.max(sourceWidth || maxEdge, sourceHeight || maxEdge));
  return {
    width: Math.max(2, Math.round((sourceWidth || maxEdge) * ratio / 2) * 2),
    height: Math.max(2, Math.round((sourceHeight || maxEdge) * ratio / 2) * 2),
  };
}

function captureVideoElementStream(video) {
  const capture = video.captureStream || video.mozCaptureStream;
  return capture ? capture.call(video) : null;
}

function stopMediaStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

async function loadFfmpeg() {
  if (ffmpegApi) return ffmpegApi;

  const { FFmpeg } = await import("/vendor/ffmpeg/index.js");

  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    const pct = 10 + Math.min(88, Math.max(0, progress || 0) * 88);
    updateCompressionStatus(pct, "파일 용량이 커서 AI 분석용으로 용량을 줄이고 있습니다.");
  });

  updateCompressionStatus(5, "파일 용량이 커서 압축 엔진을 초기화하는 중입니다. 첫 실행에는 시간이 걸릴 수 있어요.");
  const vendorBase = new URL("/vendor/ffmpeg/", window.location.href).href;
  await withTimeout(
    ffmpeg.load({
      classWorkerURL: `${vendorBase}worker.js`,
      coreURL: `${vendorBase}ffmpeg-core.js`,
      wasmURL: `${vendorBase}ffmpeg-core.wasm`,
    }),
    90000,
    "압축 엔진을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요."
  );

  ffmpegApi = {
    ffmpeg,
    fetchFile: async (source) => new Uint8Array(await source.arrayBuffer()),
  };
  return ffmpegApi;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runFfmpegCommand(ffmpeg, args, message) {
  updateCompressionStatus(10, message);
  const code = await ffmpeg.exec(args);
  if (code !== 0) {
    throw new Error(`영상 압축 명령이 실패했습니다. code=${code}`);
  }
}

function getFileExtension(fileName) {
  const ext = String(fileName || "").split(".").pop();
  return /^[a-zA-Z0-9]+$/.test(ext) ? ext.toLowerCase() : "";
}

function setStudentLevel(level) {
  selectedStudentLevel = level || "";
  const levelInput = document.getElementById("studentLevel");
  if (levelInput) levelInput.value = selectedStudentLevel;

  document.querySelectorAll(".level-card").forEach((btn) => {
    const isActive = btn.dataset.level === selectedStudentLevel;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-checked", isActive ? "true" : "false");
  });

  // 선택하면 힌트 숨김
  if (selectedStudentLevel) {
    clearStudentLevelError();
  }
}

window.setStudentLevel = setStudentLevel;

function showStudentLevelError() {
  const field = document.getElementById("levelField");
  const hint = document.getElementById("levelHint");
  field?.classList.add("has-error");
  if (hint) {
    hint.textContent = "AI 피드백을 만들기 전에 피드백 스타일을 선택해 주세요.";
    hint.classList.remove("hidden");
  }
  field?.scrollIntoView({ behavior: "smooth", block: "center" });
  const firstLevelCard = document.querySelector(".level-card");
  firstLevelCard?.focus({ preventScroll: true });
}

function clearStudentLevelError() {
  document.getElementById("levelField")?.classList.remove("has-error");
  document.getElementById("levelHint")?.classList.add("hidden");
}

function validateVideoFile(file) {
  const warning = document.getElementById("fileWarning");
  if (!warning) return;
  warning.classList.add("hidden");
  warning.textContent = "";

  if (file.size > 35 * 1024 * 1024) {
    warning.textContent = "영상 파일이 큰 편입니다. 처리 시간이 길어질 수 있어요.";
    warning.classList.remove("hidden");
  }

  const probeUrl = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    URL.revokeObjectURL(probeUrl);
    const duration = probe.duration || 0;
    if (duration > 180) {
      warning.textContent = "3분을 넘는 영상입니다. 분석 시간이 길어지거나 실패할 수 있어요. 가능하면 3분 이내 영상을 권장합니다.";
      warning.classList.remove("hidden");
    }
  };
  probe.onerror = () => URL.revokeObjectURL(probeUrl);
  probe.src = probeUrl;
}

function removeSelectedFile() {
  fileSelectionToken++;
  selectedFile = null;
  document.getElementById("fileInput").value = "";
  document.getElementById("fileInfo").classList.add("hidden");
  const preview = document.getElementById("videoPreview");
  const previewWrap = document.getElementById("videoPreviewWrap");
  if (preview) preview.removeAttribute("src");
  if (previewWrap) previewWrap.classList.add("hidden");
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedPreviewUrl = "";
  const fileWarning = document.getElementById("fileWarning");
  if (fileWarning) fileWarning.classList.add("hidden");
  clearCompressionStatus();
  setCompressingVideo(false);
  hideRetryBox();
}

window.validateYoutubeUrl = () => {
  const input = document.getElementById("youtubeUrl");
  if (!input) return false;
  const val = input.value.trim();
  const videoId = getYoutubeVideoId(val);
  const valid = Boolean(videoId);
  input.style.borderColor = val
    ? valid ? "var(--accent)" : "var(--danger)"
    : "";
  renderYoutubePreview(videoId);
  return valid;
};

function getNormalizedYoutubeUrl(url) {
  const videoId = getYoutubeVideoId(url);
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

function getYoutubeVideoId(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");

    if (host === "youtu.be") {
      return normalizeYoutubeId(parsed.pathname.split("/").filter(Boolean)[0]);
    }

    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (parsed.pathname === "/watch") {
        return normalizeYoutubeId(parsed.searchParams.get("v"));
      }

      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) {
        return normalizeYoutubeId(parts[1]);
      }
    }
  } catch (err) {
    return "";
  }

  return "";
}

function normalizeYoutubeId(id) {
  const value = (id || "").trim();
  return /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : "";
}

function renderYoutubePreview(videoId) {
  const preview = document.getElementById("youtubePreview");
  const previewWrap = document.getElementById("youtubePreviewWrap");
  if (!preview || !previewWrap) return;

  if (!videoId) {
    preview.removeAttribute("src");
    previewWrap.classList.add("hidden");
    return;
  }

  preview.src = `https://www.youtube.com/embed/${videoId}`;
  previewWrap.classList.remove("hidden");
}

window.handleSubmit = async () => {
  hideRetryBox();
  if (isCompressingVideo) {
    alert("영상 압축이 끝난 뒤 다시 눌러 주세요.");
    return;
  }
  const studentName  = document.getElementById("studentName").value.trim();
  const studentClass = document.getElementById("studentClass")?.value.trim() || "";
  const studentLevel = document.getElementById("studentLevel")?.value || selectedStudentLevel;
  setStudentLevel(studentLevel);
  const rubricType   = document.querySelector('input[name="rubricType"]:checked')?.value || "yoon";

  if (!studentName) {
    alert("학생 이름을 입력해 주세요.");
    document.getElementById("studentName").focus();
    return;
  }

  if (!selectedStudentLevel) {
    showStudentLevelError();
    return;
  }

  let payload;

  if (activeTab === "file") {
    if (!selectedFile) {
      alert("영상 파일을 선택해 주세요.");
      return;
    }
    setLoading(true);
    setProgressStep("upload");
    document.querySelector(".loading-text").textContent = "업로드 중... 0%";
    try {
      const storagePath = await uploadToStorage(selectedFile, studentName);
      payload = { storagePath, mimeType: selectedFile.type || "video/mp4", studentName, studentClass, studentLevel, rubricType };
    } catch (err) {
      setLoading(false);
      alert("파일 업로드 중 오류가 발생했습니다: " + err.message);
      return;
    }
  } else {
    const youtubeUrl = document.getElementById("youtubeUrl").value.trim();
    const normalizedYoutubeUrl = getNormalizedYoutubeUrl(youtubeUrl);
    if (!youtubeUrl) {
      alert("YouTube URL을 입력해 주세요.");
      document.getElementById("youtubeUrl").focus();
      return;
    }
    if (!normalizedYoutubeUrl) {
      window.validateYoutubeUrl();
      alert("올바른 YouTube URL을 입력해 주세요.");
      document.getElementById("youtubeUrl").focus();
      return;
    }
    payload = { youtubeUrl: normalizedYoutubeUrl, studentName, studentClass, studentLevel, rubricType };
    setLoading(true);
  }

  retryPayload = payload;
  retryStudentName = studentName;
  retryRubricType = rubricType;
  await runEvaluation(payload, { studentName, studentClass, studentLevel, rubricType });
};

async function runEvaluation(payload, meta) {
  setProgressStep("feedback");
  document.querySelector(".loading-text").textContent = "AI가 영상을 분석하고 있습니다...";
  const estimate = document.getElementById("loadingEstimate");
  if (estimate) estimate.textContent = "Gemini 영상 처리 중 · 보통 1~3분 소요";

  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "알 수 없는 오류");
    const localFeedbackId = saveFeedbackLocally({
      feedbackId: data.feedbackId,
      studentName: data.studentName,
      studentClass: meta.studentClass,
      studentLevel: meta.studentLevel,
      rubricType: data.rubricType || meta.rubricType,
      evaluation: data.evaluation,
      videoSource: payload.youtubeUrl ? "youtube" : "file",
      youtubeUrl: payload.youtubeUrl || null,
      storagePath: payload.storagePath || null,
    });
    retryPayload = null;
    setProgressStep("done");
    setLoading(false);
    displayResult(data.studentName, data.evaluation, localFeedbackId, data.rubricType || meta.rubricType);
  } catch (err) {
    setLoading(false);
    showRetryBox(err.message);
  }
}

async function retryLastEvaluation() {
  if (!retryPayload) {
    alert("다시 시도할 분석 정보가 없습니다. 영상을 다시 선택해 주세요.");
    return;
  }

  hideRetryBox();
  setLoading(true);
  await runEvaluation(retryPayload, {
    studentName: retryStudentName || document.getElementById("studentName").value.trim(),
    studentClass: document.getElementById("studentClass")?.value.trim() || "",
    studentLevel: document.getElementById("studentLevel")?.value || selectedStudentLevel,
    rubricType: retryRubricType || "yoon",
  });
}

function showRetryBox(message) {
  const box = document.getElementById("retryBox");
  const msg = document.getElementById("retryMessage");
  if (!box || !msg) return;
  msg.textContent = `${message || "알 수 없는 오류"} 업로드한 영상과 학생 정보는 유지되어 있습니다.`;
  box.classList.remove("hidden");
}

function hideRetryBox() {
  document.getElementById("retryBox")?.classList.add("hidden");
}

function saveFeedbackLocally(item) {
  const key = "speakback_feedbacks";
  const list = JSON.parse(localStorage.getItem(key) || "[]");
  const id = item.feedbackId || crypto.randomUUID();
  const saved = {
    id,
    studentName: item.studentName || "학생",
    studentClass: item.studentClass || "",
    studentLevel: item.studentLevel || "elementary_high",
    rubricType: item.rubricType || "yoon",
    evaluation: item.evaluation,
    videoSource: item.videoSource || "",
    youtubeUrl: item.youtubeUrl || null,
    storagePath: item.storagePath || null,
    createdAt: new Date().toISOString(),
  };

  localStorage.setItem(key, JSON.stringify([saved, ...list].slice(0, 100)));
  return id;
}

// ── 히스토리 슬라이드 패널 ──────────────────────────────────
window.openHistoryPanel = () => {
  renderHistoryPanel();
  document.getElementById("historyPanel")?.classList.add("open");
  document.getElementById("historyOverlay")?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

window.closeHistoryPanel = () => {
  document.getElementById("historyPanel")?.classList.remove("open");
  document.getElementById("historyOverlay")?.classList.add("hidden");
  document.body.style.overflow = "";
};

function renderHistoryPanel() {
  const listEl = document.getElementById("historyList");
  if (!listEl) return;

  const allItems = JSON.parse(localStorage.getItem("speakback_feedbacks") || "[]");

  if (!allItems.length) {
    listEl.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">&#128203;</div>
        아직 저장된 피드백이 없어요.<br>첫 번째 분석을 시작해보세요!
      </div>`;
    return;
  }

  const groups = {};
  allItems.forEach((item) => {
    const key = getLocalDateKey(new Date(item.createdAt));
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  const today = getLocalDateKey(new Date());
  const yesterday = getLocalDateKey(new Date(Date.now() - 86400000));
  const levelLabel = { elementary_low: "따뜻한 격려", elementary_high: "균형 코칭", middle: "심층 분석" };

  let html = "";
  Object.keys(groups).sort().reverse().forEach((dateKey) => {
    const label = dateKey === today ? "오늘" : dateKey === yesterday ? "어제" : dateKey;
    html += `<div class="history-date-group">${label}</div>`;
    groups[dateKey].forEach((item) => {
      const time = new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      const lv = levelLabel[item.studentLevel] || "";
      const initial = escapeHtml((item.studentName || "?")[0]);
      const name = escapeHtml(item.studentName || "학생");
      // ⚠️ onclick에 JSON.stringify 문자열을 넣으면 큰따옴표가 HTML 속성을 깨뜨림
      // → data-id 속성에 저장하고, 이벤트 위임으로 처리
      html += `
        <button class="history-item" type="button" data-history-id="${escapeHtml(item.id)}">
          <div class="history-item-avatar">${initial}</div>
          <div class="history-item-info">
            <div class="history-item-name">${name}</div>
            <div class="history-item-meta">${time}</div>
          </div>
          <span class="history-item-level">${lv}</span>
        </button>`;
    });
  });

  listEl.innerHTML = html;
}

window.loadHistoryItem = (id) => {
  const list = JSON.parse(localStorage.getItem("speakback_feedbacks") || "[]");
  const item = list.find((i) => i.id === id);
  if (!item || !item.evaluation) return;

  // 패널 먼저 닫기
  closeHistoryPanel();

  // 카드 상태 즉시 초기화
  document.getElementById("inputCard").classList.add("hidden");
  document.getElementById("loadingCard").classList.add("hidden");
  document.getElementById("resultCard").classList.add("hidden");
  currentStudentClass = item.studentClass || "";

  // 패널 닫힘 애니메이션(280ms) 완료 후 결과 렌더링
  // → 그래야 scrollIntoView / sticky 바가 정상 동작함
  setTimeout(() => {
    displayResult(item.studentName || "학생", item.evaluation, item.id, item.rubricType || "yoon", true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, 320);
};

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function uploadToStorage(file, studentName) {
  const { storage, ref, uploadBytesResumable } = await loadFirebaseStorage();
  const ext = file.name.split(".").pop();
  const safeExt = /^[a-zA-Z0-9]+$/.test(ext) ? ext.toLowerCase() : "mp4";
  const fileName = `speech_${Date.now()}_${crypto.randomUUID()}.${safeExt}`;
  const storageRef = ref(storage, `speeches/${fileName}`);
  const metadata = {
    contentType: file.type || "video/mp4",
  };

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, metadata);
    task.on(
      "state_changed",
      (snapshot) => {
        const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        const loadingText = document.querySelector(".loading-text");
        if (loadingText) loadingText.textContent = `업로드 중... ${pct}%`;
      },
      reject,
      () => {
        setProgressStep("process");
        resolve(task.snapshot.ref.fullPath);
      }
    );
  });
}

async function loadFirebaseStorage() {
  if (firebaseStorageApi) return firebaseStorageApi;

  const [{ initializeApp }, { getStorage, ref, uploadBytesResumable }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js"),
  ]);

  const app = initializeApp(firebaseConfig);
  firebaseStorageApi = {
    storage: getStorage(app),
    ref,
    uploadBytesResumable,
  };
  return firebaseStorageApi;
}

function setLoading(on) {
  document.getElementById("inputCard").classList.toggle("hidden", on);
  document.getElementById("loadingCard").classList.toggle("hidden", !on);
  updateStepBar(on ? "loading" : "input");
  if (on) {
    document.getElementById("resultCard").classList.add("hidden");
    document.querySelector(".loading-text").textContent = "AI가 영상을 분석하고 있습니다...";
    setProgressStep("upload");
  }
}

function setProgressStep(step) {
  const order = ["upload", "process", "feedback", "done"];
  const current = order.indexOf(step);
  const estimate = document.getElementById("loadingEstimate");
  const estimates = {
    upload: "영상 업로드 중 · 파일 크기에 따라 10~60초 소요",
    process: "Gemini 영상 처리 중 · 보통 1~3분 소요",
    feedback: "AI 피드백 생성 중 · 보통 20~40초 소요",
    done: "분석 완료",
  };
  if (estimate) estimate.textContent = estimates[step] || estimates.feedback;
  order.forEach((name, index) => {
    const el = document.getElementById(`progress-${name}`);
    if (!el) return;
    el.classList.toggle("done", index < current);
    el.classList.toggle("active", index === current);
  });
}

function updateStepBar(step) {
  const order = ["input", "loading", "result"];
  const current = order.indexOf(step);
  order.forEach((name, index) => {
    const pip = document.getElementById(`pip-${name}`);
    if (!pip) return;
    pip.classList.toggle("done", index < current);
    pip.classList.toggle("active", index === current);
  });

  const labels = {
    input: "학생 정보 입력",
    loading: "영상 분석 중",
    result: "피드백 확인",
  };
  const label = document.getElementById("stepLabel");
  if (label) label.textContent = labels[step] || labels.input;
}

function showStickyBar() {
  document.getElementById("stickyActionBar")?.classList.remove("hidden");
  document.body.classList.add("result-mode");
}

function hideStickyBar() {
  document.getElementById("stickyActionBar")?.classList.add("hidden");
  document.body.classList.remove("result-mode");
}

function displayResult(studentName, ev, feedbackId, rubricType, fromHistory = false) {
  currentEval        = ev;
  currentStudentName = studentName;
  // fromHistory 일 때는 loadHistoryItem 에서 이미 currentStudentClass를 설정했으므로 덮어쓰지 않음
  if (!fromHistory) {
    currentStudentClass = document.getElementById("studentClass")?.value.trim() || "";
  }
  currentRubricType  = "yoon";
  currentFeedbackId = feedbackId || null;
  feedbackEditMode = false;

  document.getElementById("loadingCard").classList.add("hidden");
  updateStepBar("result");
  const resultCard = document.getElementById("resultCard");
  resultCard.classList.remove("hidden");
  showStickyBar();

  document.getElementById("resultStudentName").textContent = studentName;

  document.getElementById("result-yoon")?.classList.add("hidden");
  displayYoonResult(ev);

  const saveNotice = document.getElementById("saveNotice");
  if (feedbackId && !fromHistory) {
    saveNotice.textContent = "오늘 처리한 학생 목록에 저장되었습니다.";
    saveNotice.classList.remove("hidden");
  } else {
    saveNotice.classList.add("hidden");
  }

  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function displayYoonResult(ev) {
  document.getElementById("result-yoon").classList.remove("hidden");

  const overall = ev.overall_feedback || {};
  const areas = ev.area_feedback || {};
  const badge = document.getElementById("overallLevelBadge");
  const level = overall.level || "";
  if (level) {
    badge.textContent = level;
    badge.className = "level-badge";
    if (level === "Great Job") badge.classList.add("level-great");
    else if (level === "Keep Going") badge.classList.add("level-ok");
    else badge.classList.add("level-good");
  } else {
    badge.className = "level-badge hidden";
    badge.classList.add("hidden");
  }

  setEditableText("fb-summary", overall.summary);
  setEditableText("fb-strongest", overall.strongest_point || "");
  setEditableText("fb-priority", overall.priority_improvement || "");

  setEditableText("fb-presentation-well", areas.presentation_attitude?.well_done || "");
  setEditableText("fb-presentation-work", areas.presentation_attitude?.needs_work || "");
  setEditableText("fb-presentation-mission", areas.presentation_attitude?.practice_mission || "");

  setEditableText("fb-delivery-well", areas.delivery_communication?.well_done || "");
  setEditableText("fb-delivery-work", areas.delivery_communication?.needs_work || "");
  setEditableText("fb-delivery-mission", areas.delivery_communication?.practice_mission || "");

  setEditableText("fb-content-well", areas.content_organization?.well_done || "");
  setEditableText("fb-content-work", areas.content_organization?.needs_work || "");
  setEditableText("fb-content-mission", areas.content_organization?.practice_mission || "");

  setEditableText("fb-teacher-comment", ev.teacher_comment_suggestion || "");
  renderQualityNote(ev.video_quality_note);
  renderTimestampComments(ev.timestamp_comments || []);
  renderPracticePlan(ev.next_practice_plan || []);
  setFeedbackEditable(false);
}

function setEditableText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function renderQualityNote(note) {
  const el = document.getElementById("qualityNote");
  if (!el) return;
  if (note) {
    el.textContent = note;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderTimestampComments(items) {
  const section = document.getElementById("timestampSection");
  const list = document.getElementById("timestampList");
  if (!section || !list) return;
  list.innerHTML = "";
  if (!items.length) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "timestamp-item";
    row.innerHTML = `
      <span class="timestamp-time">${escapeHtml(item.time || "-")}</span>
      <span class="timestamp-comment ${item.type === "strength" ? "strength" : "improve"} editable-feedback" data-timestamp-index="${index}">${escapeHtml(item.comment || "")}</span>
    `;
    list.appendChild(row);
  });
}

function renderPracticePlan(items) {
  const list = document.getElementById("practicePlanList");
  if (!list) return;
  list.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "practice-item";
    row.innerHTML = `
      <div class="practice-step">${escapeHtml(String(item.step || index + 1))}</div>
      <div>
        <div class="practice-mission editable-feedback" data-plan-index="${index}" data-plan-field="mission">${escapeHtml(item.mission || "")}</div>
        <div class="practice-how editable-feedback" data-plan-index="${index}" data-plan-field="how_to_practice">${escapeHtml(item.how_to_practice || "")}</div>
      </div>
    `;
    list.appendChild(row);
  });
}

function setEditableText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || "";
}

function renderQualityNote(note) {
  const el = document.getElementById("qualityNote");
  if (!el) return;
  if (note) {
    el.textContent = note;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

function renderCoachingPriorities(items) {
  const wrap = document.getElementById("coaching-priorities-wrap");
  if (!wrap) return;
  if (!items.length) {
    wrap.innerHTML = '<p class="fb-empty">코칭 우선순위 정보가 없습니다.</p>';
    return;
  }
  wrap.innerHTML = items.map((item, i) => {
    const urgencyClass = item.urgency === "높음" ? "urgency-high"
                       : item.urgency === "낮음" ? "urgency-low"
                       : "urgency-mid";
    return `
      <div class="priority-item ${urgencyClass}">
        <div class="priority-header">
          <span class="priority-rank">${escapeHtml(String(item.rank || i + 1))}</span>
          <span class="priority-focus editable-feedback" data-priority-index="${i}" data-priority-field="focus">${escapeHtml(item.focus || "")}</span>
          <span class="priority-urgency-badge">${escapeHtml(item.urgency || "")}</span>
        </div>
        <div class="priority-body">
          <div class="priority-reason-row">
            <span class="priority-row-label">근거</span>
            <span class="priority-reason">${escapeHtml(item.reason || "")}</span>
          </div>
          <div class="priority-handling-row">
            <span class="priority-row-label">수업 액션</span>
            <span class="priority-handling editable-feedback" data-priority-index="${i}" data-priority-field="handling">${escapeHtml(item.handling || "")}</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

function renderVideoReviewPoints(items) {
  const wrap    = document.getElementById("video-review-wrap");
  const section = document.getElementById("video-review-section");
  if (!wrap) return;
  if (!items.length) {
    if (section) section.classList.add("hidden");
    return;
  }
  if (section) section.classList.remove("hidden");

  wrap.innerHTML = items.map((item, i) => {
    const isStrength = (item.type === "strength");
    const typeLabel  = isStrength ? "강점" : "개선";
    const typeClass  = isStrength ? "review-strength" : "review-improve";
    // backward compat: old timestamp_comments used .comment, new uses .observation
    const observation = escapeHtml(item.observation || item.comment || "");
    const teacherAction = item.teacher_action ? `
      <div class="review-row review-action-row">
        <span class="review-row-label">교사 액션</span>
        <span class="review-teacher-action">${escapeHtml(item.teacher_action)}</span>
      </div>` : "";
    const coachingScript = item.coaching_script ? `
      <div class="review-row review-script-row">
        <span class="review-row-label">코칭 멘트</span>
        <span class="review-coaching-script editable-feedback" data-review-index="${i}" data-review-field="coaching_script">${escapeHtml(item.coaching_script)}</span>
      </div>` : "";
    return `
      <div class="review-point ${typeClass}">
        <div class="review-header">
          <span class="review-time-badge">${escapeHtml(item.time || "-")}</span>
          <span class="review-type-badge">${typeLabel}</span>
        </div>
        <div class="review-observation">${observation}</div>
        ${teacherAction}${coachingScript}
      </div>`;
  }).join("");
}

function renderCoachingProcedure(steps) {
  const list = document.getElementById("coaching-procedure-wrap");
  if (!list) return;
  list.innerHTML = steps.map((step, i) =>
    `<li class="procedure-step"><span class="procedure-text editable-feedback" data-procedure-index="${i}">${escapeHtml(String(step || ""))}</span></li>`
  ).join("");
}

function renderCoachingScripts(items) {
  const wrap = document.getElementById("coaching-scripts-wrap");
  if (!wrap) return;
  if (!items.length) {
    wrap.innerHTML = '<p class="fb-empty">코칭 멘트 예시가 없습니다.</p>';
    return;
  }
  wrap.innerHTML = items.map((item, i) => `
    <div class="script-item">
      <div class="script-situation">${escapeHtml(item.situation || "")}</div>
      <div class="script-text editable-feedback" data-script-index="${i}" data-script-field="script">${escapeHtml(item.script || "")}</div>
    </div>`
  ).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toggleFeedbackEdit() {
  if (!currentEval) return;
  feedbackEditMode = !feedbackEditMode;
  if (!feedbackEditMode) {
    syncEditedFeedbackToState();
    updateLocalFeedback(currentFeedbackId, currentEval);
  }
  setFeedbackEditable(feedbackEditMode);
}

async function copyTeacherComment() {
  const el  = document.getElementById("fb-teacher-comment");
  const btn = document.getElementById("copyTeacherCommentBtn");
  if (!el || !btn) return;

  const text = el.textContent.trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "복사됨 ✓";
    btn.classList.add("copy-btn--done");
    setTimeout(() => {
      btn.textContent = "복사";
      btn.classList.remove("copy-btn--done");
    }, 2000);
  } catch {
    // clipboard API 미지원 fallback
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    try {
      document.execCommand("copy");
      btn.textContent = "복사됨 ✓";
      btn.classList.add("copy-btn--done");
      setTimeout(() => {
        btn.textContent = "복사";
        btn.classList.remove("copy-btn--done");
      }, 2000);
    } catch {
      alert("복사에 실패했습니다. 텍스트를 직접 선택해 주세요.");
    }
    sel.removeAllRanges();
  }
}

function setFeedbackEditable(on) {
  document.querySelectorAll("#result-yoon .editable-feedback").forEach((el) => {
    el.setAttribute("contenteditable", on ? "true" : "false");
  });
  // 기존 상단 버튼 (있으면 동기화)
  const btn = document.getElementById("editFeedbackBtn");
  if (btn) {
    btn.textContent = on ? "저장" : "편집";
    btn.classList.toggle("on", on);
  }
  // Sticky 바 버튼 동기화
  const sabBtn = document.getElementById("stickyEditBtn");
  if (sabBtn) {
    sabBtn.textContent = on ? "저장" : "편집";
    sabBtn.classList.toggle("on", on);
  }
}

function syncEditedFeedbackToState() {
  document.querySelectorAll("#result-yoon [data-field]").forEach((el) => {
    setDeepValue(currentEval, el.dataset.field, stripLabel(el.textContent));
  });
  document.querySelectorAll("#timestampList [data-timestamp-index]").forEach((el) => {
    const index = Number(el.dataset.timestampIndex);
    if (currentEval.timestamp_comments?.[index]) {
      currentEval.timestamp_comments[index].comment = el.textContent.trim();
    }
  });
  document.querySelectorAll("#practicePlanList [data-plan-index]").forEach((el) => {
    const index = Number(el.dataset.planIndex);
    const field = el.dataset.planField;
    if (currentEval.next_practice_plan?.[index] && field) {
      currentEval.next_practice_plan[index][field] = el.textContent.trim();
    }
  });
  displayYoonResult(currentEval);
}

function stripLabel(text) {
  return String(text || "")
    .replace(/^가장 뚜렷한 강점:\s*/, "")
    .replace(/^우선 개선점:\s*/, "")
    .replace(/^잘한 점:\s*/, "")
    .replace(/^보완할 점:\s*/, "")
    .replace(/^다음 연습 미션:\s*/, "")
    .replace(/^교사용 코멘트 예시:\s*/, "")
    .trim();
}

function setDeepValue(target, path, value) {
  const parts = path.split(".");
  let current = target;
  parts.slice(0, -1).forEach((part) => {
    current[part] ||= {};
    current = current[part];
  });
  current[parts[parts.length - 1]] = value;
}

function updateLocalFeedback(id, evaluation) {
  if (!id) return;
  const key = "speakback_feedbacks";
  const list = JSON.parse(localStorage.getItem(key) || "[]");
  const updated = list.map((item) => item.id === id ? { ...item, evaluation } : item);
  localStorage.setItem(key, JSON.stringify(updated));
}










/** PDF 출력 전 확인 모달 — Promise 반환 */
function showPdfConfirmModal() {
  return new Promise((resolve) => {
    const modal   = document.getElementById("pdfConfirmModal");
    const okBtn   = document.getElementById("pdfConfirmOk");
    const editBtn = document.getElementById("pdfConfirmEdit");
    const closeBtn= document.getElementById("pdfConfirmClose");
    if (!modal) { resolve(true); return; }

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    const cleanup = (result) => {
      modal.classList.add("hidden");
      document.body.style.overflow = "";
      resolve(result);
    };

    okBtn?.addEventListener("click",   () => cleanup(true),  { once: true });
    editBtn?.addEventListener("click", () => cleanup(false), { once: true });
    closeBtn?.addEventListener("click",() => cleanup(false), { once: true });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup(false);
    }, { once: true });
  });
}

window.printFeedback = async () => {
  if (!currentEval) return;
  if (feedbackEditMode) {
    feedbackEditMode = false;
    syncEditedFeedbackToState();
    updateLocalFeedback(currentFeedbackId, currentEval);
  }

  // PDF 출력 전 확인 모달
  const confirmed = await showPdfConfirmModal();
  if (!confirmed) return;

  const btn = document.getElementById("stickyPdfBtn");
  if (btn) { btn.disabled = true; btn.textContent = "PDF 생성 중..."; }

  try {
    if (!window.jspdf) {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await setupKoreanPdfFont(pdf);

    const now = new Date();
    renderFeedbackPdf(pdf, currentEval, currentStudentName, currentStudentClass, now, currentRubricType);

    const dateTag = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    pdf.save(`${currentStudentName}_${dateTag}.pdf`);
  } catch (err) {
    alert("PDF 생성 실패: " + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "PDF 출력"; }
  }
};

async function setupKoreanPdfFont(pdf) {
  const fontName = "NanumGothic";
  if (pdf.getFontList()[fontName]) {
    pdf.setFont(fontName, "normal");
    return;
  }

  const fontUrl = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf";
  const response = await fetch(fontUrl);
  if (!response.ok) throw new Error("한글 PDF 폰트를 불러오지 못했습니다.");

  const buffer = await response.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  pdf.addFileToVFS("NanumGothic-Regular.ttf", btoa(binary));
  pdf.addFont("NanumGothic-Regular.ttf", fontName, "normal");
  pdf.setFont(fontName, "normal");
}

function renderFeedbackPdf(pdf, ev, name, cls, now, rubricType) {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const M = 14;
  const cW = pageW - M * 2;
  const BOT = pageH - 17;
  const LH = 5.2;
  let y = 0;

  const P = {
    navy: [27, 43, 94],
    navyMid: [42, 63, 128],
    amber: [232, 160, 32],
    amberDark: [124, 58, 10],
    surface: [247, 247, 244],
    white: [255, 255, 255],
    border: [229, 229, 220],
    text: [26, 26, 46],
    muted: [107, 107, 138],
    green: [26, 82, 48],
    greenBg: [235, 245, 238],
    blue: [12, 64, 120],
    blueBg: [235, 242, 251],
    orange: [124, 58, 10],
    orangeBg: [253, 240, 229],
    shadow: [221, 221, 214],
  };

  const fg = (...c) => pdf.setTextColor(...c);
  const fill = (...c) => pdf.setFillColor(...c);
  const stroke = (...c) => pdf.setDrawColor(...c);
  const rrect = (x, yy, w, h, r, mode = "F") => pdf.roundedRect(x, yy, w, h, r, r, mode);
  const line = (x1, yy, x2) => {
    stroke(...P.border);
    pdf.setLineWidth(0.25);
    pdf.line(x1, yy, x2, yy);
  };
  const mH = (text, maxW, fs = 9.5) => {
    if (!text) return 0;
    pdf.setFontSize(fs);
    return pdf.splitTextToSize(String(text), maxW).length * LH;
  };
  const wT = (text, tx, ty, maxW, fs = 9.5, color = P.text) => {
    if (!text) return 0;
    fg(...color);
    pdf.setFontSize(fs);
    const lines = pdf.splitTextToSize(String(text), maxW);
    lines.forEach((l, i) => pdf.text(l, tx, ty + i * LH));
    return lines.length * LH;
  };
  const footer = () => {
    const n = pdf.internal.getNumberOfPages();
    line(M, pageH - 13, pageW - M);
    fg(...P.muted); pdf.setFontSize(7.5);
    pdf.text(`Yoon's SpeakBack | ${n}`, pageW / 2, pageH - 8, { align: "center" });
  };
  const paintPageBg = () => {
    fill(...P.surface);
    pdf.rect(0, 0, pageW, pageH, "F");
  };
  const newPage = () => {
    footer();
    pdf.addPage();
    paintPageBg();
    y = 17;
  };
  const need = (h) => {
    if (y + h > BOT) {
      newPage();
      return true;
    }
    return false;
  };
  const drawSectionTitle = (title, color = P.navy, keepWithNext = 0) => {
    need(12 + keepWithNext);
    fill(...color);
    rrect(M, y + 1, 3.5, 8, 1.7);
    fg(...color);
    pdf.setFontSize(11.2);
    pdf.text(title, M + 7, y + 7.7);
    y += 12;
  };
  const drawCard = ({ title, text, bg = P.white, accent = P.navy, titleColor = accent, fs = 9.5 }) => {
    if (!text) return;
    const pad = 6;
    const titleH = title ? 8 : 0;
    const h = mH(text, cW - pad * 2 - 3, fs) + titleH + pad * 2;
    need(h);
    fill(...P.shadow);
    rrect(M + 0.6, y + 0.8, cW, h, 3.2);
    fill(...bg);
    stroke(...P.border);
    pdf.setLineWidth(0.25);
    rrect(M, y, cW, h, 3.2, "DF");
    fill(...accent);
    rrect(M, y, 3, h, 1.6);
    if (title) {
      fg(...titleColor);
      pdf.setFontSize(8.5);
      pdf.text(title, M + pad, y + 7);
    }
    wT(text, M + pad, y + pad + titleH + 3, cW - pad * 2 - 3, fs, P.text);
    y += h + 5;
  };
  const drawPill = (text, x, yy, w, bg, color = P.white) => {
    fill(...bg);
    rrect(x, yy, w, 8.5, 4.2);
    fg(...color);
    pdf.setFontSize(8);
    pdf.text(text, x + w / 2, yy + 5.8, { align: "center" });
  };

  paintPageBg();

  fill(...P.navy);
  pdf.rect(0, 0, pageW, 42, "F");
  fill(...P.amber);
  pdf.rect(0, 38.5, pageW, 3.5, "F");
  fg(...P.white);
  pdf.setFontSize(18);
  pdf.text("Yoon's SpeakBack", M, 14);
  fg(...P.amber);
  pdf.setFontSize(18);
  pdf.text(" AI Feedback", M + 55, 14);
  fg(225, 229, 245);
  pdf.setFontSize(9);
  pdf.text("발표 연습 개선용 코칭 리포트", M, 23);
  fg(...P.white);
  pdf.setFontSize(12.5);
  pdf.text(`${name || "학생"}${cls ? ` | ${cls}` : ""}`, M, 34);
  const dateStr = now.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  fg(225, 229, 245);
  pdf.setFontSize(8.5);
  pdf.text(dateStr, pageW - M, 34, { align: "right" });

  y = 50;
  footer();

  const overall = ev.overall_feedback || {};
  if (overall.level) {
    const lvlC = { "Great Job": P.green, "Good Work": P.blue, "Keep Going": P.orange };
    drawPill(overall.level, M, y, 36, lvlC[overall.level] || P.navy);
    y += 14;
  }

  drawCard({
    title: "종합 평가",
    text: overall.summary,
    bg: P.white,
    accent: P.navy,
    titleColor: P.navy,
    fs: 10,
  });

  const strongest = overall.strongest_point || "";
  const priority = overall.priority_improvement || "";
  if (strongest || priority) {
    const gap = 5;
    const colW = (cW - gap) / 2;
    const pad = 5;
    const innerW = colW - pad * 2;
    const sH = strongest ? mH(strongest, innerW, 9.4) + 19 : 0;
    const pH = priority ? mH(priority, innerW, 9.4) + 19 : 0;
    const rowH = Math.max(sH, pH, 28);
    need(rowH + 2);

    const drawMini = (x, title, text, bg, color) => {
      fill(...bg);
      stroke(...P.border);
      pdf.setLineWidth(0.25);
      rrect(x, y, colW, rowH, 3, "DF");
      fill(...color);
      rrect(x + pad, y + 5, 22, 7, 3.5);
      fg(...P.white);
      pdf.setFontSize(7.5);
      pdf.text(title, x + pad + 11, y + 9.9, { align: "center" });
      wT(text, x + pad, y + 18, innerW, 9.4, P.text);
    };
    if (strongest) drawMini(M, "강점", strongest, P.greenBg, P.green);
    if (priority)  drawMini(M + colW + gap, "개선", priority, P.orangeBg, P.orange);
    y += rowH + 6;
  }

  const tss = (Array.isArray(ev.timestamp_comments) ? ev.timestamp_comments : [])
    .filter((t) => t && t.time && t.comment);
  if (tss.length) {
    const timestampHeight = (ts) => Math.max(14, mH(ts.comment, cW - 34, 9.3) + 8);
    drawSectionTitle("타임스탬프 코멘트", P.navy, timestampHeight(tss[0]) + 3);

    for (const ts of tss) {
      const isStrength = ts.type === "strength";
      const color = isStrength ? P.green : P.orange;
      const bg    = isStrength ? P.greenBg : P.orangeBg;
      const tag   = isStrength ? "강점" : "개선";
      const bh    = timestampHeight(ts);
      need(bh + 2);
      fill(...P.white);
      stroke(...P.border);
      pdf.setLineWidth(0.25);
      rrect(M, y, cW, bh, 2.5, "DF");
      drawPill(tag, M + 5, y + 4, 17, color);
      fill(...bg);
      rrect(M + 26, y + 4, 17, 7.5, 3.8);
      fg(...color);
      pdf.setFontSize(7.5);
      pdf.text(ts.time, M + 34.5, y + 9.1, { align: "center" });
      wT(ts.comment, M + 48, y + 8.4, cW - 54, 9.3, P.text);
      y += bh + 3;
    }
    y += 3;
  }

  const areas = ev.area_feedback || {};
  const areaDefs = [
    { key: "presentation_attitude", label: "발표 태도",  color: P.green,  light: P.greenBg },
    { key: "delivery_communication", label: "전달력",    color: P.blue,   light: P.blueBg  },
    { key: "content_organization",   label: "내용 구성", color: P.orange, light: P.orangeBg },
  ];

  for (const def of areaDefs) {
    const area = areas[def.key];
    if (!area) continue;
    const pad    = 6;
    const innerW = cW - pad * 2 - 4;
    const items  = [
      { label: "잘한 점",   text: area.well_done,        color: P.green,    bg: P.greenBg  },
      { label: "보완할 점", text: area.needs_work,        color: P.orange,   bg: P.orangeBg },
      { label: "연습 미션", text: area.practice_mission,  color: def.color,  bg: def.light  },
    ].filter((item) => item.text).map((item) => ({
      ...item,
      height: Math.max(22, mH(item.text, innerW, 9.4) + 18),
    }));
    if (!items.length) continue;

    drawSectionTitle(def.label, def.color, items[0].height + 4);
    for (const item of items) {
      const h = item.height;
      need(h);
      fill(...P.white);
      stroke(...P.border);
      pdf.setLineWidth(0.25);
      rrect(M, y, cW, h, 3, "DF");
      fill(...item.bg);
      rrect(M + pad, y + 5, 26, 8, 4);
      fg(...item.color);
      pdf.setFontSize(8);
      pdf.text(item.label, M + pad + 13, y + 10.4, { align: "center" });
      wT(item.text, M + pad + 4, y + 19, innerW, 9.4, P.text);
      y += h + 4;
    }
    y += 1;
  }

  const plan = Array.isArray(ev.next_practice_plan) ? ev.next_practice_plan : [];
  if (plan.length) {
    const planItems = plan.map((item) => {
      const mission = item.mission || "";
      const how     = item.how_to_practice || "";
      const msnH    = mH(mission, cW - 28, 10);
      const howH    = mH(how, cW - 28, 9.1);
      return { ...item, mission, how, missionHeight: msnH, height: Math.max(22, msnH + howH + 13) };
    });
    drawSectionTitle("다음 연습 계획", P.navyMid, planItems[0].height + 4);

    for (const item of planItems) {
      const stepH = item.height;
      need(stepH);
      fill(...P.white);
      stroke(...P.border);
      pdf.setLineWidth(0.25);
      rrect(M, y, cW, stepH, 3, "DF");
      fill(...P.navy);
      pdf.circle(M + 10, y + 10, 5, "F");
      fg(...P.white);
      pdf.setFontSize(9);
      pdf.text(String(item.step || ""), M + 10, y + 12.5, { align: "center" });
      wT(item.mission, M + 22, y + 8,                         cW - 28, 10,  P.text);
      wT(item.how,     M + 22, y + 8 + item.missionHeight + 4, cW - 28, 9.1, P.muted);
      y += stepH + 4;
    }
    y += 2;
  }

  drawCard({
    title: "영상/음성 품질 참고",
    text:  ev.video_quality_note,
    bg:    P.orangeBg,
    accent: P.amber,
    titleColor: P.orange,
    fs:    9.3,
  });

  footer();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}

window.resetForm = () => {
  removeSelectedFile();
  document.getElementById('studentName').value = '';
  const studentClass = document.getElementById('studentClass');
  if (studentClass) studentClass.value = '';
  setStudentLevel('');
  document.getElementById('levelHint')?.classList.add('hidden');
  retryPayload = null;
  hideRetryBox();
  const youtubeUrl = document.getElementById('youtubeUrl');
  if (youtubeUrl) {
    youtubeUrl.value = '';
    youtubeUrl.style.borderColor = '';
  }
  renderYoutubePreview('');
  document.getElementById('resultCard').classList.add('hidden');
  document.getElementById('result-yoon').classList.add('hidden');
  hideStickyBar();
  document.getElementById('saveNotice').classList.add('hidden');
  document.getElementById('inputCard').classList.remove('hidden');
  window.switchTab('file');
  updateStepBar('input');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
