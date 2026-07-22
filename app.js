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
const pasteButton = document.querySelector("#pasteButton");
const clearInputButton = document.querySelector("#clearInputButton");
const networkStatus = document.querySelector("#networkStatus");
const toast = document.querySelector("#toast");
const tabButtons = document.querySelectorAll("[data-tab-target]");
const appViews = document.querySelectorAll("[data-app-view]");

const RECENT_KEY = "office-tone-recent-v2";
const THEME_KEY = "office-tone-theme";
const PRODUCTION_API_ORIGIN = "https://office-tone-converter.vercel.app";
const REQUEST_TIMEOUT_MS = 30000;
const ADMOB_TEST_BANNER_ID = "ca-app-pub-3940256099942544/6300978111";
const ADMOB_BANNER_ID = window.OFFICE_TONE_ADMOB_BANNER_ID || ADMOB_TEST_BANNER_ID;
const isMobileShell = document.body.classList.contains("mobile-app");
let hasConverted = false;
let lastResults = [];
let toastTimer;

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
  return group?.querySelector(".active")?.dataset.value || "";
}

function setActive(button) {
  const group = button.closest('[role="radiogroup"]') || button.parentElement;
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
  const response = await fetchWithTimeout(getApiUrl("/api/convert"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: raw, audience, tone, format }),
  }, REQUEST_TIMEOUT_MS);

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
    results: pickResultsForTone(data.results.slice(0, 5).map((item, index) => ({
      title: item.title || ["정중한 표현", "부드러운 표현", "단호한 표현", "짧은 표현", "센스형 표현"][index],
      text: item.text,
    })), tone),
    warning: data.warning,
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("AI 응답 시간이 초과되었습니다.");
      timeoutError.code = "REQUEST_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pickResultsForTone(results, tone) {
  if (!Array.isArray(results) || results.length === 0) return [];

  const toneIndex = {
    polite: 0,
    soft: 1,
    firm: 2,
    short: 3,
  };
  const titleByTone = {
    polite: "정중한 표현",
    soft: "부드러운 표현",
    firm: "단호한 표현",
    short: "짧은 표현",
  };

  const selectedIndex = toneIndex[tone] ?? 0;
  const selected = results[selectedIndex] || results[0];
  const sense = pickSenseResult(results, selectedIndex, selected?.text);

  return [
    { ...selected, title: titleByTone[tone] || selected.title },
    { ...sense, title: "센스형 표현" },
  ].filter((item) => item?.text);
}

function pickSenseResult(results, selectedIndex, selectedText) {
  const explicit = results.find((item, index) => index !== selectedIndex && /센스|위트|재치/.test(item.title || ""));
  if (explicit) return explicit;

  const fallback = results[4] || results.find((item, index) => index !== selectedIndex && item.text !== selectedText) || results[selectedIndex] || results[0];
  return fallback;
}

function getApiUrl(path) {
  if (window.OFFICE_TONE_API_BASE) {
    return `${window.OFFICE_TONE_API_BASE}${path}`;
  }

  if (isNativeApp()) {
    return `${PRODUCTION_API_ORIGIN}${path}`;
  }

  return path;
}

function isNativeApp() {
  const capacitor = window.Capacitor;

  if (capacitor?.isNativePlatform?.()) {
    return true;
  }

  if (location.protocol === "capacitor:") {
    return true;
  }

  const isLocalWebView = /^https?:$/.test(location.protocol) && location.hostname === "localhost" && /\bwv\b/i.test(navigator.userAgent);
  return isLocalWebView;
}

async function initNativeAds() {
  if (!isNativeApp()) return;

  document.body.classList.add("native-shell");

  const adMob = window.Capacitor?.Plugins?.AdMob;
  if (!adMob) return;

  try {
    await adMob.initialize();
    await adMob.showBanner({
      adId: ADMOB_BANNER_ID,
      adSize: "ADAPTIVE_BANNER",
      position: "BOTTOM_CENTER",
      margin: 0,
      isTesting: ADMOB_BANNER_ID === ADMOB_TEST_BANNER_ID,
    });
    document.body.classList.add("native-ad-enabled");
  } catch (error) {
    console.info("AdMob banner skipped", error);
  }
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
    renderEmpty("문장을 입력하면 AI가 의도와 수위를 함께 판단합니다.", "선택한 톤 1개와 센스형 표현 1개를 함께 제안합니다.");
    return;
  }

  if (!navigator.onLine) {
    lastResults = [];
    updateCopyAllState();
    renderRisk(null);
    renderUnavailableState({ code: "OFFLINE" });
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
    renderResults(aiData.results, aiData.warning);
    saveRecent({ text: raw, audience, tone, format, results: aiData.results, risk: aiData.risk, createdAt: Date.now() });
    renderRecent();
    showToast("회사어 변환이 완료되었습니다.");
    scrollToResults();
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
  const riskBarFill = document.querySelector("#riskBarFill");
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
  if (riskBarFill) {
    const widths = { low: "33%", medium: "66%", high: "100%" };
    riskBarFill.style.width = widths[risk.level] || "66%";
  }
}

function renderResults(items, notice) {
  resultList.innerHTML = "";

  if (notice) {
    const note = document.createElement("p");
    note.className = "result-notice";
    note.textContent = notice;
    resultList.append(note);
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.style.animationDelay = `${index * 120}ms`;
    const header = document.createElement("header");
    const title = document.createElement("h3");
    const actions = document.createElement("div");
    const copy = document.createElement("button");
    const text = document.createElement("p");

    actions.className = "result-actions";
    title.textContent = item.title;
    copy.className = "copy-button";
    copy.type = "button";
    copy.textContent = "복사";
    copy.setAttribute("aria-label", `${item.title} 복사`);
    copy.addEventListener("click", async () => {
      await writeClipboard(item.text);
      copy.textContent = "완료";
      card.classList.add("copied");
      showToast("문장을 복사했습니다.");
      setTimeout(() => {
        copy.textContent = "복사";
        card.classList.remove("copied");
      }, 1200);
    });

    actions.append(copy);
    if (isMobileShell && typeof navigator.share === "function") {
      const share = document.createElement("button");
      share.className = "share-button";
      share.type = "button";
      share.textContent = "공유";
      share.setAttribute("aria-label", `${item.title} 공유`);
      share.addEventListener("click", async () => {
        try {
          await navigator.share({ title: item.title, text: item.text });
        } catch (error) {
          if (error.name !== "AbortError") showToast("공유할 수 없습니다. 복사를 이용해주세요.");
        }
      });
      actions.append(share);
    }

    text.textContent = item.text;
    header.append(title, actions);
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
    <span>내일 다시 이용해주세요. 안정화 후 추가 생성 기능을 검토하겠습니다.</span>
  `;
  resultList.append(card);
}

function renderUnavailableState(error) {
  const isOffline = error.code === "OFFLINE" || !navigator.onLine;
  const isTimeout = error.code === "REQUEST_TIMEOUT";
  const isNotConfigured = error.status === 503;
  resultList.innerHTML = "";
  const card = document.createElement("article");
  card.className = "limit-state";
  const title = document.createElement("strong");
  const description = document.createElement("span");

  if (isOffline) {
    title.textContent = "인터넷 연결이 필요합니다.";
    description.textContent = "연결을 확인한 뒤 다시 시도해주세요.";
  } else if (isNotConfigured) {
    title.textContent = "아직 AI API가 연결되지 않았습니다.";
    description.textContent = "API 설정을 확인해주세요.";
  } else if (isTimeout) {
    title.textContent = "AI 응답이 예상보다 오래 걸리고 있습니다.";
    description.textContent = "네트워크 상태를 확인한 뒤 다시 시도해주세요.";
  } else {
    title.textContent = "AI 변환이 잠시 불안정합니다.";
    description.textContent = "잠시 후 다시 시도해주세요.";
  }

  card.append(title, description);
  if (!isNotConfigured) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "다시 시도";
    retry.addEventListener("click", buildResults);
    card.append(retry);
  }
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
    attachSwipeDelete(button, item);
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
      activateTab("compose");
      sourceText.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
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

function attachSwipeDelete(button, item) {
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  button.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    currentX = startX;
    isDragging = true;
  }, { passive: true });

  button.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    currentX = e.touches[0].clientX;
    const delta = currentX - startX;
    if (delta < 0 && delta > -120) {
      button.style.transform = `translateX(${delta}px)`;
    }
  }, { passive: true });

  button.addEventListener("touchend", () => {
    if (!isDragging) return;
    isDragging = false;
    const delta = currentX - startX;
    if (delta < -70) {
      button.classList.add("swipe-removing");
      setTimeout(() => removeRecentItem(item), 250);
    } else {
      button.style.transform = "";
    }
  });
}

function removeRecentItem(item) {
  const recent = getRecent().filter((entry) => !(entry.text === item.text && entry.tone === item.tone && entry.audience === item.audience));
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  renderRecent();
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
  setConvertButtonLabel(isLoading ? "변환 중..." : "회사어로 바꾸기");
  if (isLoading) {
    renderSkeletonLoading();
  }
}

function setConvertButtonLabel(label) {
  if (!isMobileShell) {
    convertButton.textContent = label;
    return;
  }

  const icon = document.createElement("img");
  icon.src = "./assets/icons/sparkles.svg";
  icon.alt = "";
  convertButton.replaceChildren(icon, document.createTextNode(label));
}

function renderSkeletonLoading() {
  resultList.innerHTML = "";
  for (let i = 0; i < 2; i++) {
    const skeleton = document.createElement("article");
    skeleton.className = "skeleton-card";
    skeleton.innerHTML = `
      <header class="skeleton-header">
        <div class="skeleton-line skeleton-title"></div>
        <div class="skeleton-line skeleton-btn"></div>
      </header>
      <div class="skeleton-body">
        <div class="skeleton-line skeleton-text"></div>
        <div class="skeleton-line skeleton-text"></div>
        <div class="skeleton-line skeleton-text-short"></div>
      </div>
    `;
    resultList.append(skeleton);
  }
}

function updateCopyAllState() {
  copyAllButton.disabled = lastResults.length === 0;
  copyAllButton.textContent = "전체 복사";
}

function updateCount() {
  charCount.textContent = `${sourceText.value.length}자`;
}

function scrollToResults() {
  if (window.innerWidth <= 820) {
    const resultPanel = document.querySelector(".result-panel");
    if (resultPanel) {
      resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
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

  const isDark = nextTheme === "dark" || (nextTheme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && isMobileShell) themeMeta.content = isDark ? "#111416" : "#f5f7fb";
}

function showToast(message) {
  if (!toast || !message) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function activateTab(name) {
  if (!appViews.length) return;

  appViews.forEach((view) => {
    const isActive = view.dataset.appView === name;
    view.hidden = !isActive;
    view.classList.toggle("active", isActive);
  });

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === name;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  if (name === "history") renderRecent();
}

function invalidateResults(title = "설정이 바뀌었습니다.") {
  if (!hasConverted && lastResults.length === 0) return;
  hasConverted = false;
  lastResults = [];
  renderRisk(null);
  updateCopyAllState();
  renderEmpty(title, "현재 문장과 설정으로 다시 변환해주세요.");
}

function resetComposer({ resetOptions = false, focus = true } = {}) {
  sourceText.value = "";
  hasConverted = false;
  lastResults = [];
  if (resetOptions) {
    setGroupValue(audienceGroup, "boss");
    setGroupValue(toneGroup, "polite");
    setGroupValue(formatGroup, "general");
  }
  renderRisk(null);
  updateCopyAllState();
  updateCount();
  renderEmpty("문장을 입력하면 AI가 의도와 수위를 함께 판단합니다.", "선택한 톤 1개와 센스형 표현 1개를 함께 제안합니다.");
  activateTab("compose");
  if (focus) sourceText.focus();
}

async function pasteFromClipboard() {
  if (!navigator.clipboard?.readText) {
    showToast("입력창을 길게 눌러 붙여넣어주세요.");
    sourceText.focus();
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showToast("클립보드에 붙여넣을 문장이 없습니다.");
      return;
    }
    sourceText.value = text.slice(0, Number(sourceText.maxLength) || 500);
    updateCount();
    invalidateResults("원문이 변경되었습니다.");
    sourceText.focus();
  } catch {
    showToast("입력창을 길게 눌러 붙여넣어주세요.");
    sourceText.focus();
  }
}

function updateNetworkStatus() {
  if (networkStatus) networkStatus.hidden = navigator.onLine;
}

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    setActive(button);
    if (sourceText.value.trim()) invalidateResults();
  });
});

document.querySelectorAll("[data-example]").forEach((button) => {
  button.addEventListener("click", () => {
    sourceText.value = button.dataset.example;
    updateCount();
    invalidateResults("새 문장을 불러왔습니다.");

    if (button.dataset.autoconvert === "false") {
      activateTab("compose");
      window.scrollTo({ top: 0, behavior: "smooth" });
      sourceText.focus();
      showToast("입력창에 문장을 담았습니다.");
      return;
    }

    buildResults();
    sourceText.focus();
  });
});

themeOptions.forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme)));

tabButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    activateTab(button.dataset.tabTarget);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  button.addEventListener("keydown", (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + direction + tabButtons.length) % tabButtons.length;
    tabButtons[nextIndex].focus();
    tabButtons[nextIndex].click();
  });
});

sourceText.addEventListener("input", () => {
  updateCount();
  invalidateResults("원문이 변경되었습니다.");
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
  showToast("추천 표현을 모두 복사했습니다.");
  setTimeout(updateCopyAllState, 1200);
});
clearRecentButton.addEventListener("click", () => {
  localStorage.removeItem(RECENT_KEY);
  renderRecent();
  showToast("최근 기록을 비웠습니다.");
});
clearButton.addEventListener("click", () => resetComposer({ resetOptions: true }));
pasteButton?.addEventListener("click", pasteFromClipboard);
clearInputButton?.addEventListener("click", () => resetComposer({ focus: true }));
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

updateCount();
updateModeLabel();
updateCopyAllState();
syncChipAccessibility();
applyTheme(localStorage.getItem(THEME_KEY) || "auto");
renderRecent();
activateTab("compose");
updateNetworkStatus();
initNativeAds();
