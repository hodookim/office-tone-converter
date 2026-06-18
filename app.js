const sourceText = document.querySelector("#sourceText");
const charCount = document.querySelector("#charCount");
const convertButton = document.querySelector("#convertButton");
const clearButton = document.querySelector("#clearButton");
const copyAllButton = document.querySelector("#copyAllButton");
const clearRecentButton = document.querySelector("#clearRecentButton");
const resultList = document.querySelector("#resultList");
const recentList = document.querySelector("#recentList");
const modeLabel = document.querySelector("#modeLabel");
const toneGroup = document.querySelector("#toneGroup");
const formatGroup = document.querySelector("#formatGroup");

const RECENT_KEY = "office-tone-recent";
let hasConverted = false;
let lastResults = [];

const labels = {
  tone: {
    polite: "정중",
    soft: "부드럽게",
    firm: "단호하게",
    short: "짧게",
  },
  format: {
    general: "일반",
    mail: "메일",
    chat: "메신저",
    report: "보고",
  },
};

function getActiveValue(group) {
  return group.querySelector(".active").dataset.value;
}

function setActive(button) {
  const group = button.parentElement;
  group.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
  button.classList.add("active");
  updateModeLabel();
}

function setGroupValue(group, value) {
  const target = group.querySelector(`[data-value="${value}"]`);
  if (target) setActive(target);
}

function cleanInput(text) {
  return text.trim().replace(/\s+/g, " ");
}

async function requestAiResults(raw, tone, format) {
  const response = await fetch("/api/convert", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: raw,
      tone,
      format,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.error || "AI 변환을 사용할 수 없습니다.");
    error.code = errorData.code;
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (!Array.isArray(data.results) || data.results.length === 0) {
    throw new Error("AI 결과가 비어 있습니다.");
  }

  return data.results.slice(0, 2).map((item, index) => ({
    title: item.title || ["바로 보내기", "조금 더 다듬기"][index],
    text: item.text,
  }));
}

async function buildResults() {
  const raw = cleanInput(sourceText.value);
  const tone = getActiveValue(toneGroup);
  const format = getActiveValue(formatGroup);

  if (!raw) {
    hasConverted = false;
    lastResults = [];
    updateCopyAllState();
    renderEmpty("문장을 입력하면 AI가 상황을 알아서 판단합니다.", "톤과 형식만 고르면 바로 보낼 수 있는 문장 2개를 만들어드려요.");
    return;
  }

  setLoading(true);
  renderEmpty("회사어로 바꾸는 중입니다.", "잠시만 기다려주세요.");

  try {
    const aiResults = await requestAiResults(raw, tone, format);
    hasConverted = true;
    lastResults = aiResults;
    renderResults(aiResults);
    saveRecent({ text: raw, tone, format, results: aiResults, createdAt: Date.now() });
    renderRecent();
  } catch (error) {
    lastResults = [];
    updateCopyAllState();
    if (error.code === "DAILY_LIMIT") {
      renderLimitState();
      return;
    }

    renderUnavailableState(error);
  } finally {
    setLoading(false);
  }
}

function renderResults(items) {
  resultList.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "result-card";

    const header = document.createElement("header");
    const title = document.createElement("h3");
    const copy = document.createElement("button");
    const text = document.createElement("p");

    title.textContent = item.title;
    copy.className = "copy-button";
    copy.type = "button";
    copy.textContent = "복사";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.text);
      copy.textContent = "완료";
      card.classList.add("copied");
      setTimeout(() => {
        copy.textContent = "복사";
        card.classList.remove("copied");
      }, 1200);
    });

    text.textContent = item.text;
    header.append(title, copy);
    card.append(header, text);
    resultList.append(card);
  });

  updateCopyAllState();
}

function renderEmpty(title, description) {
  resultList.innerHTML = "";
  const empty = document.createElement("article");
  empty.className = "empty-state";
  empty.innerHTML = `<strong>${title}</strong><span>${description}</span>`;
  resultList.append(empty);
}

function renderLimitState() {
  resultList.innerHTML = "";

  const card = document.createElement("article");
  card.className = "limit-state";
  card.innerHTML = `
    <strong>오늘 무료 AI 변환 횟수를 모두 사용했습니다.</strong>
    <span>내일 다시 이용하거나, 나중에 광고 시청 후 추가 생성 기능을 붙일 수 있습니다.</span>
    <button type="button" disabled>광고 보고 2회 추가 생성</button>
  `;
  resultList.append(card);
}

function renderUnavailableState(error) {
  resultList.innerHTML = "";

  const isNotConfigured = error.status === 503;
  const card = document.createElement("article");
  card.className = "limit-state";
  card.innerHTML = `
    <strong>${isNotConfigured ? "아직 AI API가 연결되지 않았습니다." : "AI 변환이 잠시 불안정합니다."}</strong>
    <span>${isNotConfigured ? "Gemini API 키를 연결하면 여기서 바로 AI 변환 결과가 나옵니다." : "잠시 후 다시 시도해주세요."}</span>
  `;
  resultList.append(card);
}

function saveRecent(item) {
  const recent = getRecent();
  const withoutDuplicate = recent.filter((entry) => entry.text !== item.text || entry.tone !== item.tone || entry.format !== item.format);
  const next = [item, ...withoutDuplicate].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function getRecent() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderRecent() {
  const recent = getRecent();
  recentList.innerHTML = "";

  if (recent.length === 0) {
    const empty = document.createElement("p");
    empty.className = "recent-empty";
    empty.textContent = "아직 저장된 변환이 없습니다.";
    recentList.append(empty);
    return;
  }

  recent.forEach((item) => {
    const button = document.createElement("button");
    button.className = "recent-item";
    button.type = "button";

    const title = document.createElement("strong");
    const meta = document.createElement("span");
    title.textContent = item.text;
    meta.textContent = `${labels.tone[item.tone] || item.tone} · ${labels.format[item.format] || item.format}`;

    button.append(title, meta);
    button.addEventListener("click", () => {
      sourceText.value = item.text;
      setGroupValue(toneGroup, item.tone);
      setGroupValue(formatGroup, item.format);
      updateCount();
      lastResults = Array.isArray(item.results) ? item.results : [];
      hasConverted = lastResults.length > 0;
      if (hasConverted) {
        renderResults(lastResults);
      }
      sourceText.focus();
    });
    recentList.append(button);
  });
}

function setLoading(isLoading) {
  convertButton.disabled = isLoading;
  convertButton.textContent = isLoading ? "변환 중..." : "변환하기";
}

function updateCopyAllState() {
  copyAllButton.disabled = lastResults.length === 0;
  copyAllButton.textContent = "전체 복사";
}

function updateCount() {
  charCount.textContent = `${sourceText.value.length}자`;
}

function updateModeLabel() {
  const tone = getActiveValue(toneGroup);
  const format = getActiveValue(formatGroup);
  modeLabel.textContent = `${labels.tone[tone]} · ${labels.format[format]}`;
}

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    setActive(button);
    if (sourceText.value.trim() && hasConverted) {
      lastResults = [];
      updateCopyAllState();
      renderEmpty("설정이 바뀌었습니다.", "새 톤과 형식으로 보려면 변환하기를 눌러주세요.");
    }
  });
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    sourceText.value = button.dataset.example;
    updateCount();
    buildResults();
    sourceText.focus();
  });
});

sourceText.addEventListener("input", () => {
  updateCount();
  if (hasConverted) {
    hasConverted = false;
    lastResults = [];
    updateCopyAllState();
  }
});

sourceText.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    buildResults();
  }
});

convertButton.addEventListener("click", buildResults);
copyAllButton.addEventListener("click", async () => {
  if (lastResults.length === 0) return;
  await navigator.clipboard.writeText(lastResults.map((item) => item.text).join("\n\n"));
  copyAllButton.textContent = "완료";
  setTimeout(updateCopyAllState, 1200);
});

clearRecentButton.addEventListener("click", () => {
  localStorage.removeItem(RECENT_KEY);
  renderRecent();
});

clearButton.addEventListener("click", () => {
  sourceText.value = "";
  hasConverted = false;
  lastResults = [];
  updateCopyAllState();
  updateCount();
  renderEmpty("문장을 입력하면 AI가 상황을 알아서 판단합니다.", "톤과 형식만 고르면 바로 보낼 수 있는 문장 2개를 만들어드려요.");
  sourceText.focus();
});

updateCount();
updateModeLabel();
updateCopyAllState();
renderRecent();
