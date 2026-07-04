const cache = new Map();
const usageByVisitor = new Map();

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const MAX_TEXT_LENGTH = 500;
const MAX_CACHE_ITEMS = 200;

const labels = {
  audience: {
    boss: "상사",
    coworker: "동료",
    junior: "후배/직원",
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
    general: "일반 업무 문장",
    mail: "메일 문장",
    chat: "메신저 문장",
    report: "보고 문장",
  },
};

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST 요청만 가능합니다." });
  }

  if (!process.env.GEMINI_API_KEY && !process.env.NVIDIA_API_KEY) {
    return sendJson(res, 503, { error: "AI 설정이 아직 연결되지 않았습니다." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { error: "요청 형식이 올바르지 않습니다." });
  }

  const text = String(body.text || "").trim().slice(0, MAX_TEXT_LENGTH);
  const audience = labels.audience[body.audience] ? body.audience : "boss";
  const tone = labels.tone[body.tone] ? body.tone : "polite";
  const format = labels.format[body.format] ? body.format : "general";

  if (!text) {
    return sendJson(res, 400, { error: "변환할 문장이 없습니다." });
  }

  const cacheKey = JSON.stringify({ text, audience, tone, format });
  if (cache.has(cacheKey)) {
    return sendJson(res, 200, { ...cache.get(cacheKey), cached: true });
  }

  const shouldLimit = !isLocalRequest(req);
  const visitorKey = getVisitorKey(req);
  if (shouldLimit && isLimitExceeded(visitorKey)) {
    return sendJson(res, 429, {
      error: "오늘 무료 AI 변환 횟수를 모두 사용했습니다.",
      code: "DAILY_LIMIT",
    });
  }

  if (shouldUseGuidedFallback(text)) {
    const payload = normalizeModelResponse(buildFallbackResponse(text), text);

    pruneCache();
    cache.set(cacheKey, payload);

    if (shouldLimit) {
      incrementUsage(visitorKey);
    }

    return sendJson(res, 200, { ...payload, cached: false, guided: true });
  }

  try {
    const modelResult = await convertWithAvailableModel({
      text,
      audience,
      tone,
      format,
      intentHint: inferIntentHint(text),
    });
    const payload = normalizeModelResponse(modelResult, text);

    pruneCache();
    cache.set(cacheKey, payload);

    if (shouldLimit) {
      incrementUsage(visitorKey);
    }

    return sendJson(res, 200, { ...payload, cached: false });
  } catch (error) {
    const payload = normalizeModelResponse(buildFallbackResponse(text), text);

    pruneCache();
    cache.set(cacheKey, payload);

    if (shouldLimit) {
      incrementUsage(visitorKey);
    }

    return sendJson(res, 200, {
      ...payload,
      cached: false,
      fallback: true,
      warning: "AI 응답이 지연되어 안전 변환 결과로 대신 제공했습니다.",
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

async function convertWithAvailableModel(payload) {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await convertWithGemini(payload);
    } catch (error) {
      if (!process.env.NVIDIA_API_KEY) {
        throw error;
      }
    }
  }

  if (process.env.NVIDIA_API_KEY) {
    return convertWithNvidia(payload);
  }

  throw new Error("No AI provider configured");
}

async function convertWithGemini(payload) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(payload) }],
          },
        ],
        generationConfig: {
          temperature: 0.68,
          maxOutputTokens: 720,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return parseModelJson(data.candidates?.[0]?.content?.parts?.[0]?.text || "", payload.text);
}

async function convertWithNvidia(payload) {
  const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [
        {
          role: "user",
          content: buildPrompt(payload),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.68,
      max_tokens: 780,
    }),
  });

  if (!response.ok) {
    throw new Error(`NVIDIA API error: ${response.status}`);
  }

  const data = await response.json();
  return parseModelJson(data.choices?.[0]?.message?.content || "", payload.text);
}

function buildPrompt({ text, audience, tone, format, intentHint }) {
  return [
    "너는 한국 직장인을 위한 '회사어 번역기'다.",
    "사용자의 거친 속마음을 회사에서 실제로 보낼 수 있는 문장으로 바꾼다.",
    "결과는 반드시 한국어 JSON만 반환한다. 마크다운, 설명, 코드블록은 쓰지 않는다.",
    "",
    "핵심 규칙:",
    "1. 원문에 있는 사람 이름, 호칭, 직급은 삭제하지 말고 자연스럽게 존칭으로 유지한다. 상대가 고객이나 거래처여도 이름이 있으면 '이름님'으로 살린다.",
    "2. 원문에 없는 회사명, 계약명, 일정, 업무 지연, 자료 요청 같은 사실을 새로 만들지 않는다.",
    "3. 욕설이나 인신공격은 제거하되, 사용자가 말하려던 핵심 불만은 유지한다.",
    "4. 너무 무난한 '확인 부탁드립니다'로 도망가지 말고 상황별로 구체적인 표현을 만든다.",
    "5. 결과는 실제 복사해서 보내도 되는 수준이어야 한다.",
    "6. 다섯 번째 결과는 살짝 센스 있게 만들되, 상대를 조롱하거나 비꼬는 문장은 금지한다.",
    "7. '왜 사냐', '생각은 하냐', '뇌 있냐' 같은 말은 업무 지연이 아니라 상대 판단/태도에 대한 강한 불만으로 해석한다.",
    "8. '입냄새', '냄새', '위생'은 구강/개인 위생 관련 불편으로 해석한다.",
    "9. '말귀 못 알아듣냐', '몇 번을 말하냐'는 전달 내용이 제대로 반영되지 않았다는 불만으로 해석한다.",
    "10. 원문이 공격적일수록 사실을 새로 만들지 말고, '판단 기준', '소통 방식', '업무 태도', '회의 환경'처럼 원문의 불만 축을 유지한다.",
    "11. 예: '대희야 진짜 너 왜 사냐'는 '대희님, 이번 판단이나 대응 방식은 납득하기 어려운 부분이 있습니다'처럼 바꾼다. 절대 업무 지연, 일정 지연, 자료 요청으로 바꾸지 않는다.",
    "",
    "출력 형식:",
    '{"risk":{"level":"low|medium|high","reason":"짧은 이유"},"results":[{"title":"정중한 표현","text":"..."},{"title":"부드러운 표현","text":"..."},{"title":"단호한 표현","text":"..."},{"title":"짧은 표현","text":"..."},{"title":"센스형 표현","text":"..."}]}',
    "",
    `원문: ${text}`,
    `상대: ${labels.audience[audience]}`,
    `톤: ${labels.tone[tone]}`,
    `형식: ${labels.format[format]}`,
    `분석 힌트: ${intentHint}`,
  ].join("\n");
}

function parseModelJson(raw, originalText) {
  const cleaned = String(raw)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return buildFallbackResponse(originalText);
  }

  try {
    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  } catch {
    return buildFallbackResponse(originalText);
  }
}

function buildFallbackResponse(originalText) {
  const risk = estimateRisk(originalText);
  const name = extractRecipientName(originalText);

  if (/왜\s*사|뭐하러\s*사|생각.*하|뇌.*있/.test(originalText.replace(/\s+/g, ""))) {
    const target = name ? `${name}님` : "해당 부분";
    return {
      risk,
      results: [
        {
          title: "정중한 표현",
          text: `${target}, 이번 판단 기준이 조금 더 명확히 공유되면 좋겠습니다. 제가 이해한 방향과 차이가 있어 다시 한번 확인 부탁드립니다.`,
        },
        {
          title: "부드러운 표현",
          text: `${target}, 이 부분은 제 머릿속 결재선이 잠시 멈춘 느낌이라 판단 배경을 한 번만 더 설명 부탁드립니다.`,
        },
        {
          title: "단호한 표현",
          text: `${target}, 현재 방향은 납득하기 어려운 부분이 있습니다. 진행 전에 판단 근거와 기준을 다시 확인해 주시면 감사하겠습니다.`,
        },
        {
          title: "짧은 표현",
          text: `${target}, 이번 판단 기준과 근거를 다시 한번 설명 부탁드립니다.`,
        },
        {
          title: "센스형 표현",
          text: `${target}, 제 머릿속 업무 나침반이 잠시 방향을 잃었습니다. 이번 판단 배경을 한 번만 더 공유해주시면 맞춰보겠습니다.`,
        },
      ],
    };
  }

  if (/쫌생|좀생|쩨쩨|좁쌀|빡빡|융통성/.test(originalText.replace(/\s+/g, ""))) {
    const target = name ? `${name}님` : "고객님";
    return {
      risk,
      results: [
        {
          title: "정중한 표현",
          text: `${target}, 이번 건은 원활한 진행을 위해 조금 더 유연한 방향으로 검토해주시면 감사하겠습니다.`,
        },
        {
          title: "부드러운 표현",
          text: `${target}, 세부 기준도 중요하지만 이번 건은 전체 흐름을 보며 조금 더 유연하게 논의해보면 좋겠습니다.`,
        },
        {
          title: "단호한 표현",
          text: `${target}, 현재 기준만으로는 진행이 다소 어려워질 수 있습니다. 현실적인 조율 방안을 함께 검토 부탁드립니다.`,
        },
        {
          title: "짧은 표현",
          text: `${target}, 원활한 진행을 위해 조금 더 유연한 검토 부탁드립니다.`,
        },
        {
          title: "센스형 표현",
          text: `${target}, 이번 건은 줄자보다 나침반이 필요한 상황 같습니다. 큰 방향 안에서 유연하게 맞춰보면 좋겠습니다.`,
        },
      ],
    };
  }

  if (/입냄새|냄새|구강|위생|악취/.test(originalText.replace(/\s+/g, ""))) {
    const target = name ? `${name}님` : "말씀드리기 조심스럽지만";
    return {
      risk,
      results: [
        {
          title: "정중한 표현",
          text: `${target}, 회의 중 개인 위생과 관련해 다소 민감한 부분이 느껴져 조심스럽게 말씀드립니다. 서로 편한 회의 환경을 위해 한 번만 신경 써주시면 감사하겠습니다.`,
        },
        {
          title: "부드러운 표현",
          text: `${target}, 말씀드리기 민망하지만 회의 때 가까이 대화하다 보니 조금 신경 쓰이는 부분이 있었습니다. 기분 나쁘지 않게 받아주시면 좋겠습니다.`,
        },
        {
          title: "단호한 표현",
          text: `${target}, 대면 회의 시 개인 위생 관련해 불편함이 반복되고 있습니다. 원활한 소통을 위해 개선 부탁드립니다.`,
        },
        {
          title: "짧은 표현",
          text: `${target}, 대면 대화 시 개인 위생 관련해 조금만 신경 써주시면 감사하겠습니다.`,
        },
        {
          title: "센스형 표현",
          text: `${target}, 회의 집중도를 위해 아주 조심스럽게 말씀드립니다. 가까이 대화할 때 서로 편한 환경이 되도록 조금만 신경 써주시면 좋겠습니다.`,
        },
      ],
    };
  }

  const target = name ? `${name}님` : "해당 내용";
  return {
    risk,
    results: [
      {
        title: "정중한 표현",
        text: `${target}, 이 부분은 조금 더 신중하게 조율이 필요해 보입니다. 가능하실 때 다시 한번 확인 부탁드립니다.`,
      },
      {
        title: "부드러운 표현",
        text: `${target}, 서로 오해 없이 맞춰가면 좋을 것 같습니다. 편하실 때 한 번 더 확인 부탁드립니다.`,
      },
      {
        title: "단호한 표현",
        text: `${target}, 현재 내용은 그대로 진행하기 어렵습니다. 기준에 맞게 다시 조정 부탁드립니다.`,
      },
      {
        title: "짧은 표현",
        text: `${target}, 이 부분은 재확인이 필요해 보입니다. 다시 검토 부탁드립니다.`,
      },
      {
        title: "센스형 표현",
        text: `${target}, 서로 다른 방향을 보고 있는 것 같아 한 번만 좌표를 맞춰보면 좋겠습니다.`,
      },
    ],
  };
}

function shouldUseGuidedFallback(text) {
  const normalized = String(text).replace(/\s+/g, "");
  return /왜사|뭐하러사|생각.*하|뇌.*있|정신.*있|쫌생|좀생|쩨쩨|좁쌀|빡빡|융통성|입냄새|냄새|구강|위생|악취|말귀|몇번.*말|못알아|또말/.test(normalized);
}

function extractRecipientName(text) {
  const trimmed = String(text).trim();
  const addressed = trimmed.match(/^([가-힣]{2,6}?)(?:아|야|님|씨)(?:\s|,|!|\.|$|진짜|너|혹시|이거|저거)/);
  const token = addressed || trimmed.match(/^([가-힣]{2,6})(?:에게|한테)(?:\s|,|!|\.|$)/);
  if (!token) return "";

  const candidate = token[1];
  if (/^(오늘|내일|이번|자료|회의|업무|일정|메일|문서|파일)$/.test(candidate)) return "";
  return candidate;
}

function normalizeModelResponse(parsed, originalText) {
  const estimatedRisk = estimateRisk(originalText);
  const risk = parsed?.risk && typeof parsed.risk === "object" ? parsed.risk : {};
  const modelLevel = ["low", "medium", "high"].includes(risk.level) ? risk.level : estimatedRisk.level;
  const level = pickHigherRisk(modelLevel, estimatedRisk.level);
  const reason = typeof risk.reason === "string" && risk.reason.trim() ? risk.reason.trim() : estimatedRisk.reason;
  const recipientName = extractRecipientName(originalText);

  const sourceResults = Array.isArray(parsed?.results) ? parsed.results : [];
  const defaults = buildFallbackResponse(originalText).results;

  const results = defaults.map((fallback, index) => {
    const item = sourceResults[index];
    const candidateText = typeof item?.text === "string" && item.text.trim() ? item.text.trim() : "";
    const text = isUsableKoreanResult(candidateText) && isIntentAlignedResult(candidateText, originalText, recipientName) ? candidateText : fallback.text;
    const title = typeof item?.title === "string" && item.title.trim() ? item.title.trim() : fallback.title;
    return { title, text };
  });

  return { risk: { level, reason }, results };
}

function pickHigherRisk(a, b) {
  const score = { low: 0, medium: 1, high: 2 };
  return score[a] >= score[b] ? a : b;
}

function isUsableKoreanResult(text) {
  if (!text) return false;
  const unexpectedLatin = text.match(/[A-Za-z]{3,}/g) || [];
  const allowed = new Set(["AI", "API", "URL", "PDF", "Excel"]);
  return unexpectedLatin.every((word) => allowed.has(word));
}

function isIntentAlignedResult(text, originalText, recipientName) {
  const original = originalText.replace(/\s+/g, "");
  const result = text.replace(/\s+/g, "");

  if (recipientName && !result.includes(recipientName)) {
    return false;
  }

  if (/왜사|뭐하러사|생각.*하|뇌.*있|정신.*있/.test(original)) {
    if (/업무.*지연|진행.*지연|일정.*지연|자료.*요청|자료.*공유|완료.*시점|기다려야/.test(result)) {
      return false;
    }

    return /(판단|기준|근거|방향|대응|납득|이해|설명|확인|소통|태도)/.test(result);
  }

  if (/입냄새|냄새|구강|위생|악취/.test(original)) {
    if (/업무.*지연|진행.*지연|일정.*지연|자료.*요청|완료.*시점/.test(result)) {
      return false;
    }

    return /(위생|회의|대화|불편|신경|환경|조심스럽|민감)/.test(result);
  }

  if (/말귀|몇번.*말|못알아|이해.*못|또말/.test(original)) {
    return !/자료.*요청|일정.*지연|업무.*지연/.test(result);
  }

  return true;
}

function inferIntentHint(text) {
  const normalized = text.replace(/\s+/g, "");

  if (/왜사|뭐하러사|생각.*하|뇌.*있|정신.*있/.test(normalized)) {
    return "상대의 판단이나 태도에 대한 강한 불만이다. 업무 지연이나 자료 요청으로 바꾸지 말고, 의사결정 과정과 판단 기준을 다시 확인해 달라는 표현으로 바꿔라.";
  }

  if (/입냄새|냄새|구강|위생|악취/.test(normalized)) {
    return "상대의 위생 문제로 불편함을 느끼는 상황이다. 모욕하지 말고 개인 위생이나 회의 환경을 조심스럽게 언급해라.";
  }

  if (/말귀|몇번.*말|못알아|이해.*못|또말/.test(normalized)) {
    return "전달한 내용이 제대로 반영되지 않았다는 불만이다. 반복 안내와 핵심 내용 재확인을 요청하는 표현으로 바꿔라.";
  }

  if (/일정|기한|마감|데드라인/.test(text) && /말이안|무리|어려|불가|안됨|안돼/.test(normalized)) {
    return "일정이 비현실적이거나 진행이 어렵다는 뜻이다. 일정 조정 또는 우선순위 재검토를 요청해라.";
  }

  if (/담당|제일|내일|업무범위/.test(text) && /아닌|아니|모르|왜나/.test(normalized)) {
    return "담당 범위가 아니거나 담당자 확인이 필요한 상황이다. 책임 회피처럼 보이지 않게 담당 범위 확인을 요청해라.";
  }

  if (/아직|언제|됐|안됐|지연/.test(text)) {
    return "진행 상황 또는 지연 사유 확인이 필요한 상황이다.";
  }

  if (/자료|파일|문서|공유|보내/.test(text)) {
    return "자료 공유 또는 재전달 요청이다.";
  }

  if (/아닌|이상|문제|다시|반려/.test(text)) {
    return "내용에 대한 우려, 반박, 수정 요청이다.";
  }

  return "원문을 읽고 의도를 직접 판단해라.";
}

function estimateRisk(text) {
  const normalized = text.replace(/\s+/g, "");
  if (/씨발|병신|미친|꺼져|죽|왜사|입냄새|냄새|뇌|말귀|멍청|한심|쫌생|좀생|쩨쩨|좁쌀/.test(normalized)) {
    return { level: "high", reason: "상대가 공격이나 모욕으로 받아들일 수 있는 표현이 포함되어 있습니다." };
  }
  if (/왜|아직|안됐|말이안|무리|아닌|제일아닌|짜증|답답|빡빡|융통성/.test(normalized)) {
    return { level: "medium", reason: "불만이나 압박으로 읽힐 수 있어 표현을 조정하는 편이 좋습니다." };
  }
  return { level: "low", reason: "큰 충돌 없이 전달할 수 있는 문장입니다." };
}

function getVisitorKey(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || req.socket?.remoteAddress || "unknown");
  return ip.split(",")[0].trim();
}

function isLocalRequest(req) {
  const host = String(req.headers.host || "");
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host.startsWith("[::1]:");
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isLimitExceeded(visitorKey) {
  const usage = usageByVisitor.get(visitorKey);
  return usage?.date === getTodayKey() && usage.count >= DAILY_LIMIT;
}

function incrementUsage(visitorKey) {
  const date = getTodayKey();
  const usage = usageByVisitor.get(visitorKey);

  if (!usage || usage.date !== date) {
    usageByVisitor.set(visitorKey, { date, count: 1 });
    return;
  }

  usage.count += 1;
}

function pruneCache() {
  if (cache.size < MAX_CACHE_ITEMS) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, data) {
  res.statusCode = status;
  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
