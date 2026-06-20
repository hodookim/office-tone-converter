const form = document.querySelector("#reasonForm");
const sourceText = document.querySelector("#sourceText");
const textCount = document.querySelector("#textCount");
const resultList = document.querySelector("#resultList");
const modeLabel = document.querySelector("#modeLabel");
const generateButton = document.querySelector("#generateButton");
const copyAllButton = document.querySelector("#copyAllButton");
const quickButtons = document.querySelectorAll(".quick-section button");
const themeButtons = document.querySelectorAll(".theme-button");
const recentList = document.querySelector("#recentList");
const clearButton = document.querySelector("#clearButton");

const THEME_KEY = "leaveReasonTheme";
const RECENT_KEY = "leaveReasonRecent";
let lastResults = [];

const typeLabels = {
  annual: "연차",
  half: "반차",
  sick: "병가",
  late: "지각",
  remote: "재택",
  early: "조퇴",
};

const styleLabels = {
  normal: "기본",
  polite: "정중",
  short: "짧게",
  messenger: "메신저",
};

function getActiveValue(groupName) {
  return document.querySelector(`[data-group="${groupName}"] .chip.active`)?.dataset.value;
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

function updateCount() {
  textCount.textContent = `${sourceText.value.trim().length}자`;
}

function updateModeLabel() {
  const type = typeLabels[getActiveValue("reasonType")] || "연차";
  const style = styleLabels[getActiveValue("style")] || "기본";
  modeLabel.textContent = `${type} · ${style}`;
}

function renderResults(items) {
  lastResults = items;
  resultList.innerHTML = "";
  if (!items.length) {
    resultList.innerHTML = `
      <div class="empty-state">
        <strong>결과를 만들지 못했습니다.</strong>
        <span>상황을 조금 더 구체적으로 입력해 주세요.</span>
      </div>
    `;
    updateCopyAllState();
    return;
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const title = document.createElement("h3");
    title.textContent = item.title || `문장 ${index + 1}`;
    const text = document.createElement("p");
    text.textContent = item.text;
    const copy = document.createElement("button");
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
    card.append(title, text, copy);
    resultList.append(card);
  });
  updateCopyAllState();
}

function renderError(message) {
  lastResults = [];
  resultList.innerHTML = `
    <div class="limit-state">
      <strong>${message}</strong>
      <span>문장을 줄이거나 잠시 후 다시 시도해 주세요.</span>
    </div>
  `;
  updateCopyAllState();
}

async function buildResults() {
  const text = sourceText.value.trim();
  if (!text) {
    sourceText.focus();
    renderError("상황을 먼저 입력해 주세요.");
    return;
  }

  setLoading(true);
  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        reasonType: getActiveValue("reasonType"),
        style: getActiveValue("style"),
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "문장 생성에 실패했습니다.");
    }

    renderResults(data.results || []);
    saveRecent(text);
  } catch (error) {
    renderError(error.message || "문장 생성 중 오류가 발생했습니다.");
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? "작성 중..." : "문장 만들기";
}

function updateCopyAllState() {
  copyAllButton.disabled = lastResults.length === 0;
  copyAllButton.textContent = "전체 복사";
}

function saveRecent(text) {
  const item = {
    text,
    mode: modeLabel.textContent,
    createdAt: Date.now(),
  };
  const recent = getRecent().filter((entry) => entry.text !== text);
  recent.unshift(item);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 5)));
  renderRecent();
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function renderRecent() {
  const recent = getRecent();
  if (!recent.length) {
    recentList.innerHTML = '<p class="muted">아직 저장된 생성 결과가 없습니다.</p>';
    return;
  }

  recentList.innerHTML = "";
  recent.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector("strong").textContent = item.text;
    button.querySelector("span").textContent = item.mode;
    button.addEventListener("click", () => {
      sourceText.value = item.text;
      updateCount();
      sourceText.focus();
    });
    recentList.append(button);
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

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  themeButtons.forEach((button) => {
    const active = button.dataset.themeValue === theme;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncChipAccessibility() {
  document.querySelectorAll(".chip").forEach((chip) => {
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", String(chip.classList.contains("active")));
  });
}

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => setActive(button));
});

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sourceText.value = button.textContent.trim();
    updateCount();
    sourceText.focus();
  });
});

themeButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeValue));
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  buildResults();
});

copyAllButton.addEventListener("click", async () => {
  if (!lastResults.length) return;
  await writeClipboard(lastResults.map((item) => item.text).join("\n\n"));
  copyAllButton.textContent = "완료";
  setTimeout(updateCopyAllState, 1200);
});

clearButton.addEventListener("click", () => {
  localStorage.removeItem(RECENT_KEY);
  renderRecent();
});

sourceText.addEventListener("input", updateCount);

updateCount();
updateModeLabel();
updateCopyAllState();
syncChipAccessibility();
applyTheme(localStorage.getItem(THEME_KEY) || "auto");
renderRecent();
