const cache = new Map();
const usageByVisitor = new Map();

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const MAX_TEXT_LENGTH = 500;
const MAX_CACHE_ITEMS = 200;

const labels = {
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
  const tone = labels.tone[body.tone] ? body.tone : "polite";
  const format = labels.format[body.format] ? body.format : "general";

  if (!text) {
    return sendJson(res, 400, { error: "변환할 문장이 없습니다." });
  }

  const cacheKey = JSON.stringify({ text, tone, format });
  if (cache.has(cacheKey)) {
    return sendJson(res, 200, { results: cache.get(cacheKey), cached: true });
  }

  const shouldLimit = !isLocalRequest(req);
  const visitorKey = getVisitorKey(req);
  if (shouldLimit && isLimitExceeded(visitorKey)) {
    return sendJson(res, 429, {
      error: "오늘 무료 AI 변환 횟수를 모두 사용했습니다.",
      code: "DAILY_LIMIT",
    });
  }

  try {
    const results = await convertWithAvailableModel({ text, tone, format, intentHint: inferIntentHint(text) });
    pruneCache();
    cache.set(cacheKey, results);

    if (shouldLimit) {
      incrementUsage(visitorKey);
    }

    return sendJson(res, 200, { results, cached: false });
  } catch (error) {
    return sendJson(res, 502, {
      error: "AI 변환이 잠시 불안정합니다.",
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

async function convertWithGemini({ text, tone, format, intentHint }) {
  const prompt = [
    "너는 한국 회사에서 바로 보낼 수 있는 업무 문장 변환기다.",
    "사용자의 거친 표현, 애매한 표현, 감정 섞인 표현을 실무적인 한국어로 바꿔라.",
    "원문의 핵심 의미와 대상은 반드시 유지하라. 재촉, 거절, 일정 불가, 반박, 책임 범위, 자료 요청 같은 의도를 일반적인 확인 요청으로 뭉개지 마라.",
    "원문에 사람 이름, 직급, 팀명, 제품명, 프로젝트명, 날짜, 시간, 숫자 같은 고유 대상이 있으면 절대 삭제하거나 익명화하거나 일반화하지 마라.",
    "사람 이름과 호칭은 회사에서 자연스러운 형태로 유지하라. 예: '대희야'는 '대희님,'으로, '김부장아'는 '김 부장님,' 또는 '김부장님,'으로 바꿔 문장에 포함하라.",
    "입력에 없는 성씨, 이름, 직급은 절대 붙이지 마라. 예: '부장아'는 '부장님,'으로 바꾸고 '김 부장님'처럼 성씨를 만들어내지 마라.",
    "이름이 포함된 문장은 결과 2개 모두에 해당 이름을 포함해야 한다. 이름을 '담당자님', '관계자분', '팀원분'처럼 바꾸지 마라.",
    "원문에 일정, 자료, 담당 범위, 완료 여부처럼 구체적인 대상이 있으면 결과에도 그 대상을 반영하라.",
    "원문의 의도를 먼저 판단하되, 사용자에게 상황을 묻지 말고 스스로 추론하라.",
    "선택된 톤과 형식을 가장 중요하게 반영하라.",
    "원문의 말맛, 농담, 짜증, 민망함, 억울함 같은 캐릭터를 완전히 지우지 마라. 무색무취한 확인 요청이나 교과서 문장으로 만들지 마라.",
    "입냄새, 체취, 소음, 지각, 실수처럼 민감하거나 불편한 핵심을 환기, 분위기, 컨디션 같은 다른 문제로 돌려 말하지 마라. 공격적이지 않은 업무 표현으로 바꾸되 무엇을 말하는지는 분명해야 한다.",
    "결과 1은 실제 회사에서 바로 보낼 수 있는 무난한 실전형으로 작성하라.",
    "결과 2는 회사에서 보낼 수 있는 선을 지키면서 원문의 웃긴 핵심과 솔직한 뉘앙스를 살린 센스형으로 작성하라.",
    "센스형에는 원문의 감정을 보여주는 짧은 업무용 비유나 펀치라인을 반드시 하나 넣어라. 예: '제 상식이 잠시 로그아웃했습니다', '이 판단은 결재선에서 길을 잃은 것 같습니다'. 매번 상황에 맞게 새로 만들고 무난형을 단순히 바꿔 쓰지 마라.",
    "강한 욕설이나 인신공격은 센스형에서 상대를 공격하지 않는 재치 있는 비유로 치환하되, 불만의 강도는 약하게 만들지 마라.",
    "센스형도 비꼼, 모욕, 공격, 성희롱으로 보이면 안 된다. 유머는 표현의 재치로 만들고 상대를 깎아내리지 마라.",
    "과장된 사과, 비굴한 표현, 이모지, 마크다운은 쓰지 마라.",
    "회사 기밀처럼 보이는 세부 정보는 새로 만들거나 추측하지 마라.",
    "아래 분석 힌트가 있으면 그 힌트를 우선하라. 단, 원문에 없는 내용을 지어내지 마라.",
    "결과는 JSON만 반환한다. 다른 설명은 하지 마라.",
    "",
    `원문: ${text}`,
    `분석 힌트: ${intentHint}`,
    `톤: ${labels.tone[tone]}`,
    `형식: ${labels.format[format]}`,
    "",
    "첫 번째 제목은 '무난하게 보내기', 두 번째 제목은 '센스 있게 보내기'로 정확히 써라.",
    '형식: {"results":[{"title":"무난하게 보내기","text":"..."},{"title":"센스 있게 보내기","text":"..."}]}',
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 320,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
  const results = Array.isArray(parsed.results) ? parsed.results : [];

  return results
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .slice(0, 2)
    .map((item, index) => ({
      title: item.title || ["바로 보내기", "조금 더 다듬기"][index],
      text: item.text.trim(),
    }));
}

async function convertWithNvidia({ text, tone, format, intentHint }) {
  const prompt = [
    "너는 한국 회사에서 바로 보낼 수 있는 업무 문장 변환기다.",
    "사용자의 거친 말, 반말, 짜증, 농담, 민망한 표현을 회사에서 보낼 수 있는 표현으로 바꿔라.",
    "사람 이름, 직급, 팀명, 제품명, 프로젝트명, 날짜, 시간, 숫자는 삭제하거나 일반화하지 말고 유지하라.",
    "예: '대희야'는 '대희님,'으로 바꾼다. 입력에 없는 성씨나 직급은 만들지 마라.",
    "결과는 2개만 만든다.",
    "1번은 실제로 바로 보낼 수 있는 무난하고 안전한 문장이다.",
    "2번은 회사에서 보낼 수 있는 선을 지키되, 원문의 감정과 말맛을 살린 센스 있는 문장이다.",
    "센스형에는 짧은 업무용 비유나 펀치라인을 하나 넣어라. 상대를 모욕하지 말고 상황을 재치 있게 표현하라.",
    "원문이 욕설이나 인신공격이어도 업무 지연, 자료 요청처럼 엉뚱한 주제로 바꾸지 마라. 원문의 실제 의도를 파악하라.",
    "'왜사냐', '왜 살아', '생각은 하냐' 같은 표현은 생존 질문이 아니라 상대의 판단이나 행동을 이해하기 어렵다는 강한 비판이다. 절대 진행 상황 확인, 업무 지연, 자료 요청으로 바꾸지 마라.",
    "'눈 없냐', '안 보이냐' 같은 표현은 시력 문제가 아니라 누락된 검토 사항을 다시 확인해 달라는 뜻이다.",
    "'말귀 못 알아듣냐', '몇 번을 말하냐' 같은 표현은 전달 내용이 반영되지 않았다는 불만이다.",
    "마크다운, 설명, 코드블록 없이 JSON만 반환하라.",
    "",
    `원문: ${text}`,
    `분석 힌트: ${intentHint}`,
    `톤: ${labels.tone[tone]}`,
    `형식: ${labels.format[format]}`,
    "",
    '형식: {"results":[{"title":"무난하게 보내기","text":"..."},{"title":"센스 있게 보내기","text":"..."}]}',
  ].join("\n");

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
          content: prompt,
        },
      ],
      temperature: 0.55,
      max_tokens: 360,
    }),
  });

  if (!response.ok) {
    throw new Error(`NVIDIA API error: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("NVIDIA returned invalid JSON");
  }

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return results
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .slice(0, 2)
    .map((item, index) => ({
      title: item.title || ["무난하게 보내기", "센스 있게 보내기"][index],
      text: item.text.trim(),
    }));
}

function inferIntentHint(text) {
  const normalized = text.replace(/\s+/g, "");

  if (/왜사냐|왜살아|뭐하러사냐|제정신이냐|생각이있냐|생각은하냐/.test(normalized)) {
    return "상대의 존재나 생존을 묻는 질문이 아니라, 상대의 행동이나 판단을 도저히 이해하기 어렵다는 강한 비판이다. 업무 지연이나 진행 상황 확인으로 바꾸지 말고, 해당 행동의 판단 배경 설명과 재검토를 요구하는 문장으로 변환하라";
  }

  if (/눈이없|안보이냐|눈뜨고|똑바로안보/.test(normalized)) {
    return "상대가 중요한 내용이나 오류를 놓쳤다는 강한 지적이다. 시력 이야기가 아니라 누락된 검토 사항을 다시 확인해 달라는 문장으로 변환하라";
  }

  if (/귀가없|말귀|말을못알아|몇번을말/.test(normalized)) {
    return "이미 전달한 내용을 상대가 이해하거나 반영하지 않았다는 강한 불만이다. 전달 내용의 재확인과 정확한 반영을 요구하는 문장으로 변환하라";
  }

  if (/일정|기한|마감|데드라인/.test(text) && /말이안|무리|어렵|불가능|안됩니다|안돼/.test(normalized)) {
    return "일정이 비현실적이거나 진행이 어려워 일정 조정 또는 현실성 검토를 요청하는 문장";
  }

  if (/제\s*일|내\s*일|담당|업무\s*범위/.test(text) && /아닌|아니|모르|왜/.test(text)) {
    return "담당 범위가 아니거나 담당자 확인이 필요한 문장";
  }

  if (/왜|아직|언제|안됐|안되|지연/.test(text)) {
    return "진행 상황 확인 또는 지연 사유 확인을 요청하는 문장";
  }

  if (/못|어렵|불가|안\s*됩니다|안\s*돼/.test(text)) {
    return "일정 변경, 거절, 또는 진행 어려움을 알리는 문장";
  }

  if (/자료|파일|문서|공유|보내/.test(text)) {
    return "자료 요청 또는 공유 요청 문장";
  }

  if (/아닌|리스크|문제|이상|틀린|반대/.test(text)) {
    return "반박, 우려 제기, 또는 대안 검토 요청 문장";
  }

  return "원문을 읽고 의도를 직접 판단";
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

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
