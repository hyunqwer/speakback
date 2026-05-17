const LOCAL_FEEDBACK_KEY = "speakback_feedbacks";

const params = new URLSearchParams(window.location.search);
const targetId = params.get("id");

if (targetId) {
  loadDetail(targetId);
} else {
  loadList();
}

function getLocalFeedbacks() {
  return JSON.parse(localStorage.getItem(LOCAL_FEEDBACK_KEY) || "[]");
}

function formatStoredDate(value) {
  if (!value) return "날짜 미상";
  const date = value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function loadList() {
  showListView();
  const listEl = document.getElementById("feedbackList");
  const list = getLocalFeedbacks();

  if (!list.length) {
    listEl.innerHTML = '<p class="empty-notice">이 브라우저에 저장된 피드백이 없습니다.</p>';
    return;
  }

  listEl.innerHTML = "";
  list.forEach((item) => listEl.appendChild(buildListItem(item.id, item)));
}

function buildListItem(id, item) {
  const div = document.createElement("div");
  div.className = "feedback-list-item";
  div.onclick = () => navigateToDetail(id);

  const date = formatStoredDate(item.createdAt);
  const source = item.videoSource === "youtube" ? "YouTube" : "파일";

  div.innerHTML = `
    <div class="fli-left">
      <span class="fli-name">${escHtml(item.studentName || "학생")}</span>
      <span class="fli-meta">${escHtml(source)} · ${escHtml(date)}</span>
    </div>
    <div class="fli-right">
      <span class="fli-rubric-badge">코칭</span>
      <span class="fli-arrow">›</span>
    </div>
  `;
  return div;
}

function loadDetail(id) {
  showDetailView();
  const item = getLocalFeedbacks().find((feedback) => feedback.id === id);
  if (!item) {
    alert("이 브라우저에 저장된 피드백을 찾을 수 없습니다.");
    showList();
    return;
  }
  renderDetail(item);
}

function renderDetail(item) {
  const ev = item.evaluation || {};
  const date = formatStoredDate(item.createdAt);

  document.getElementById("d-studentName").textContent = item.studentName || "학생";
  document.getElementById("d-meta").textContent = date;
  document.getElementById("d-result-yoon").classList.remove("hidden");

  const overall = ev.overall_feedback || {};
  const areas = ev.area_feedback || {};

  document.getElementById("d-fb-overall").textContent = [
    overall.level ? `코칭 레벨: ${overall.level}` : "",
    overall.summary,
    overall.strongest_point ? `가장 뚜렷한 강점: ${overall.strongest_point}` : "",
    overall.priority_improvement ? `우선 개선점: ${overall.priority_improvement}` : "",
  ].filter(Boolean).join("\n\n");

  document.getElementById("d-fb-presentation").textContent = formatArea(areas.presentation_attitude);
  document.getElementById("d-fb-communication").textContent = formatArea(areas.delivery_communication);
  document.getElementById("d-fb-content").textContent = formatArea(areas.content_organization);
  document.getElementById("d-fb-advice").textContent = formatPracticePlan(ev);
}

function formatArea(area) {
  if (!area) return "";
  return [
    area.well_done ? `잘한 점: ${area.well_done}` : "",
    area.needs_work ? `보완할 점: ${area.needs_work}` : "",
    area.practice_mission ? `연습 미션: ${area.practice_mission}` : "",
  ].filter(Boolean).join("\n\n");
}

function formatPracticePlan(ev) {
  const plan = Array.isArray(ev.next_practice_plan)
    ? ev.next_practice_plan.map((item) => {
        const step = item.step ? `${item.step}. ` : "";
        return `${step}${item.mission || ""}${item.how_to_practice ? `\n${item.how_to_practice}` : ""}`;
      }).join("\n\n")
    : "";

  return [
    plan,
    ev.teacher_comment_suggestion ? `교사용 코멘트 예시: ${ev.teacher_comment_suggestion}` : "",
  ].filter(Boolean).join("\n\n");
}

function navigateToDetail(id) {
  window.location.href = `history.html?id=${encodeURIComponent(id)}`;
}

window.showList = () => {
  window.location.href = "history.html";
};

function showListView() {
  document.getElementById("listView").classList.remove("hidden");
  document.getElementById("detailView").classList.add("hidden");
}

function showDetailView() {
  document.getElementById("listView").classList.add("hidden");
  document.getElementById("detailView").classList.remove("hidden");
}

function escHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
