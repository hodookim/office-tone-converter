const usageByVisitor = new Map();
const cache = new Map();

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5);
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const MAX_TEXT_LENGTH = 300;
const MAX_CACHE_ITEMS = 200;

const reasonLabels = {
  annual: "연차",
  half: "반차",
  sick: "병가",
  late: "지각",
  remote: "재택근무",
  early: "조퇴",
};

const styleLabels = {
  normal: "기본",
  polite: "정중",
  short: "짧게",
  messenger: "메신저",
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST 요청만 지원합니다." });
  }

  if (!process.env.GEMINI_API_KEY) {
    return sendJson(res, 503, { error: "AI 설정이 아직 연결되지 않았습니다." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { error: "요청 형식이 올바르지 않습니다." });
  }

  const text = String(body.text || "").trim().slice(0, MAX_TEXT_LENGTH);
  const reasonType = reasonLabels[body.reasonType] ? body.reasonType : "annual";
  const style = styleLabels[body.style] ? body.style : "normal";

  if (!text) {
    return sendJson(res, 400, { error: "상황을 입력해 주세요." });
  }

  const visitorKey = getVisitorKey(req);
  const cacheKey = `${reasonType}:${style}:${text}`;
  if (cache.has(cacheKey)) {
    return sendJson(res, 200, { results: cache.get(cacheKey), cached: true });
  }

  const usage = getUsage(visitorKey);
  if (usage.count >= DAILY_LIMIT) {
    return sendJson(res, 429, {
      error: "오늘 무료 생성 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요.",
    });
  }

  try {
    const results = await generateWithGemini({ text, reasonType, style });
    pruneCache();
    cache.set(cacheKey, results);
    incrementUsage(visitorKey);
    return sendJson(res, 200, {
      results,
      remaining: Math.max(DAILY_LIMIT - getUsage(visitorKey).count, 0),
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: "AI 문장 생성 중 오류가 발생했습니다." });
  }
};

async function generateWithGemini({ text, reasonType, style }) {
  const prompt = `
너는 한국 회사 문화에 맞는 근태 보고 문장을 작성하는 도우미다.

입력 상황: ${text}
종류: ${reasonLabels[reasonType]}
표현: ${styleLabels[style]}

규칙:
- 한국어로만 답한다.
- 회사에 바로 보낼 수 있는 자연스러운 문장 2개를 만든다.
- 과장, 거짓말, 허위 진단명, 구체적 병명 날조는 하지 않는다.
- 개인정보, 병명, 가족 신상 등 민감 정보는 넣지 않는다.
- 날짜나 시간은 사용자가 입력한 경우에만 반영한다.
- 사용자가 입력한 날짜, 시간, 오전/오후, 지각 시간은 절대 바꾸지 않는다.
- 입력에 없는 복귀 시간, 업무 조치, 승인 완료, 증빙 제출 여부를 지어내지 않는다.
- 같은 상황에 맞는 표현만 만든다. 예를 들어 오전 반차 입력이면 오후 반차 문장을 만들지 않는다.
- "업무에 차질 없도록", "미리 조치", "복귀하겠습니다" 같은 문장은 사용자가 직접 말한 경우에만 쓴다.
- 상사/팀장/담당자에게 보내는 무난한 문장으로 작성한다.
- 각 결과는 120자 이내로 쓴다.
- JSON만 반환한다. 설명 문장, 마크다운, 코드블록은 쓰지 않는다.

반환 형식:
{"results":[{"title":"문장 제목","text":"작성 문장"},{"title":"문장 제목","text":"작성 문장"}]}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.45,
          topP: 0.9,
          maxOutputTokens: 600,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed: ${response.status}`);
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
    .map((item, index) => ({
      title: String(item.title || `문장 ${index + 1}`).trim().slice(0, 30),
      text: preserveUserTiming(text, String(item.text || "").trim()).slice(0, 180),
    }))
    .filter((item) => item.text)
    .slice(0, 2);
}

function preserveUserTiming(source, generated) {
  let result = generated;
  const hasTomorrow = source.includes("내일");
  const hasDayAfterTomorrow = source.includes("모레");

  if (hasDayAfterTomorrow) {
    result = result.replace(/오늘|금일|내일/g, "모레");
  } else if (hasTomorrow) {
    result = result.replace(/오늘|금일/g, "내일");
  }

  return result;
}

function getVisitorKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket?.remoteAddress || "local");
  return ip.split(",")[0].trim();
}

function getUsage(visitorKey) {
  const today = new Date().toISOString().slice(0, 10);
  const current = usageByVisitor.get(visitorKey);
  if (!current || current.date !== today) {
    const fresh = { date: today, count: 0 };
    usageByVisitor.set(visitorKey, fresh);
    return fresh;
  }
  return current;
}

function incrementUsage(visitorKey) {
  const usage = getUsage(visitorKey);
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
