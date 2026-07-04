const sourceText = document.querySelector("#sourceText");
const charCount = document.querySelector("#charCount");
const convertButton = document.querySelector("#convertButton");
const clearButton = document.querySelector("#clearButton");
const copyAllButton = document.querySelector("#copyAllButton");
const clearRecentButton = document.querySelector("#clearRecentButton");
const resultList = document.querySelector("#resultList");
const recentList = document.querySelector("#recentList");
const modeLabel = document.querySelector("#modeLabel");
const audienceGroup = document.querySelector("#audienceGroup");
const toneGroup = document.querySelector("#toneGroup");
const formatGroup = document.querySelector("#formatGroup");
const themeOptions = document.querySelectorAll("[data-theme]");
const riskMeter = document.querySelector("#riskMeter");
const riskBadge = document.querySelector("#riskBadge");
const riskReason = document.querySelector("#riskReason");

const RECENT_KEY = "office-tone-recent";
const THEME_KEY = "office-tone-theme";
let hasConverted = false;
let lastResults = [];

const labels = {
  audience: {
    boss: "상사",
    coworker: "동료",
    junior: "후배",
    vendor: "거래처",
    customer: "고객",
  },
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

const riskCopy = {
  low: ["위험도 낮음", "바로 보내기에도 비교적 무난한 표현입니다."],
  medium: ["위험도 보통", "표현이 다소 건조하거나 오해될 수 있어 완충이 필요합니다."],
  high: ["위험도 높음", "상대가 공격적으로 받아들일 수 있어 표현을 크게 순화해야 합니다."],
};

function getActiveValue(group) {
  return group.querySelector(".active").dataset.value;
}

function setActive(button) {
  const group = button.parentElement;
  group.querySelectorAll(".chip").forEach((chip) => {
    chip.classList.remove("active");
    chip.setAttribute("aria-checked", "false");
  });
  button.classList.add("active");
  button.setAttribute("aria-checked", "true");
  updateModeLabel();
}

function setGroupValue(group, value) {
  const target = group.querySelector(`[data-value="${value}"]`);
  if (target) setActive(target);
}

function cleanInput(text) {
  return text.trim().replace(/\s+/g, " ");
}

async function requestAiResults(raw, audience, tone, format) {
  const response = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: raw, audience, tone, format }),
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

  return {
    risk: normalizeRisk(data.risk),
    results: data.results.slice(0, 3).map((item, index) => ({
      title: item.title || ["안전한 표현", "부드러운 표현", "단호한 표현"][index],
      text: item.text,
    })),
  };
}

async function buildResults() {
  const raw = cleanInput(sourceText.value);
  const audience = getActiveValue(audienceGroup);
  const tone = getActiveValue(toneGroup);
  const format = getActiveValue(formatGroup);

  if (!raw) {
    hasConverted = false;
    lastResults = [];
    updateCopyAllState();
    renderRisk(null);
    renderEmpty("문장을 입력하면 AI가 의도와 수위를 함께 판단합니다.", "바로 보낼 무난한 표현부터 속마음을 살린 표현까지 3가지로 만들어드려요.");
    return;
  }

  setLoading(true);
  renderRisk({ level: "medium", reason: "원문 표현을 분석 중입니다." });
  renderEmpty("회사어로 바꾸는 중입니다.", "문장 의도와 상대를 함께 반영하고 있어요.");

  try {
    const aiData = await requestAiResults(raw, audience, tone, format);
    hasConverted = true;
    lastResults = aiData.results;
    renderRisk(aiData.risk);
    renderResults(aiData.results);
    saveRecent({ text: raw, audience, tone, format, results: aiData.results, risk: aiData.risk, createdAt: Date.now() });
    renderRecent();
  } catch (error) {
    lastResults = [];
    updateCopyAllState();
    renderRisk(null);
    if (error.code === "DAILY_LIMIT") {
      renderLimitState();
      return;
    }
    renderUnavailableState(error);
  } finally {
    setLoading(false);
  }
}

function normalizeRisk(risk) {
  const level = ["low", "medium", "high"].includes(risk?.level) ? risk.level : "medium";
  return { level, reason: risk?.reason || riskCopy[level][1] };
}

function renderRisk(risk) {
  if (!risk) {
    riskMeter.hidden = true;
    riskMeter.dataset.level = "";
    return;
  }
  const copy = riskCopy[risk.level] || riskCopy.medium;
  riskMeter.hidden = false;
  riskMeter.dataset.level = risk.level;
  riskBadge.textContent = copy[0];
  riskReason.textContent = risk.reason || copy[1];
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
      await writeClipboard(item.text);
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
    <span>내일 다시 이용하거나, 추후 광고 시청 후 추가 생성 기능을 붙일 수 있습니다.</span>
    <button type="button" disabled>광고 보고 2회 추가 생성</button>
  `;
  resultList.append(card);
}

function renderUnavailableState(error) {
  const isNotConfigured = error.status === 503;
  resultList.innerHTML = "";
  const card = document.createElement("article");
  card.className = "limit-state";
  card.innerHTML = `
    <strong>${isNotConfigured ? "아직 AI API가 연결되지 않았습니다." : "AI 변환이 잠시 불안정합니다."}</strong>
    <span>${isNotConfigured ? "API 키를 연결하면 바로 AI 변환 결과가 나옵니다." : "잠시 후 다시 시도해주세요."}</span>
  `;
  resultList.append(card);
}

function saveRecent(item) {
  const recent = getRecent();
  const withoutDuplicate = recent.filter((entry) => entry.text !== item.text || entry.tone !== item.tone || entry.format !== item.format || entry.audience !== item.audience);
  localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...withoutDuplicate].slice(0, 6)));
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
    meta.textContent = `${labels.audience[item.audience] || "상사"} · ${labels.tone[item.tone] || item.tone} · ${labels.format[item.format] || item.format}`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      sourceText.value = item.text;
      setGroupValue(audienceGroup, item.audience || "boss");
      setGroupValue(toneGroup, item.tone || "polite");
      setGroupValue(formatGroup, item.format || "general");
      updateCount();
      lastResults = Array.isArray(item.results) ? item.results : [];
      hasConverted = lastResults.length > 0;
      if (hasConverted) {
        renderRisk(item.risk);
        renderResults(lastResults);
      }
      sourceText.focus();
    });
    recentList.append(button);
  });
}

function syncChipAccessibility() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", String(chip.classList.contains("active")));
  });
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.top = "-9999px";
  document.body.append(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

function setLoading(isLoading) {
  convertButton.disabled = isLoading;
  convertButton.textContent = isLoading ? "변환 중..." : "회사어로 바꾸기";
}

function updateCopyAllState() {
  copyAllButton.disabled = lastResults.length === 0;
  copyAllButton.textContent = "전체 복사";
}

function updateCount() {
  charCount.textContent = `${sourceText.value.length}자`;
}

function updateModeLabel() {
  const audience = getActiveValue(audienceGroup);
  const tone = getActiveValue(toneGroup);
  const format = getActiveValue(formatGroup);
  modeLabel.textContent = `${labels.audience[audience]} · ${labels.tone[tone]} · ${labels.format[format]}`;
}

function applyTheme(theme) {
  const nextTheme = ["light", "dark"].includes(theme) ? theme : "auto";
  if (nextTheme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = nextTheme;

  themeOptions.forEach((button) => {
    const isActive = button.dataset.theme === nextTheme;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  localStorage.setItem(THEME_KEY, nextTheme);
}

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    setActive(button);
    if (sourceText.value.trim() && hasConverted) {
      lastResults = [];
      updateCopyAllState();
      renderRisk(null);
      renderEmpty("설정이 바뀌었습니다.", "새 상대, 톤, 형식으로 보려면 회사어로 바꾸기를 눌러주세요.");
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

themeOptions.forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme)));

sourceText.addEventListener("input", () => {
  updateCount();
  if (hasConverted) {
    hasConverted = false;
    lastResults = [];
    renderRisk(null);
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
  await writeClipboard(lastResults.map((item) => item.text).join("\n\n"));
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
  renderRisk(null);
  updateCopyAllState();
  updateCount();
  renderEmpty("문장을 입력하면 AI가 의도와 수위를 함께 판단합니다.", "바로 보낼 무난한 표현부터 속마음을 살린 표현까지 3가지로 만들어드려요.");
  sourceText.focus();
});

updateCount();
updateModeLabel();
updateCopyAllState();
syncChipAccessibility();
applyTheme(localStorage.getItem(THEME_KEY) || "auto");
renderRecent();