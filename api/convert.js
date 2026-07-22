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
  const context = {
    text,
    audience,
    tone,
    format,
    intentHint: inferIntentHint(text),
  };

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
    const payload = normalizeModelResponse(buildFallbackResponse(context), context);

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
      intentHint: context.intentHint,
    });
    const payload = normalizeModelResponse(modelResult, context);

    pruneCache();
    cache.set(cacheKey, payload);

    if (shouldLimit) {
      incrementUsage(visitorKey);
    }

    return sendJson(res, 200, { ...payload, cached: false });
  } catch (error) {
    const payload = normalizeModelResponse(buildFallbackResponse(context), context);

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
  const toneGuide = {
    polite: "정중하고 예의 바른 표현. 존경어 사용.",
    soft: "부드럽고 배려 있는 표현. 상대 감정 고려.",
    firm: "단호하되 공격적이지 않은 표현. 사실 중심.",
    short: "간결하고 명확한 표현. 불필요한 수식어 제거.",
  };

  return [
    "## 역할",
    "너는 한국 직장인을 위한 '회사어 번역기'다.",
    "사용자의 거친 속마음을 회사에서 실제로 보낼 수 있는 문장으로 바꾼다.",
    "결과는 반드시 한국어 JSON만 반환한다. 마크다운, 설명, 코드블록은 쓰지 않는다.",
    "",
    "## 핵심 규칙",
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
    "12. 이름이나 직급이 없다고 '거래처님', '상사님', '동료님', '후배님', '팀장님', '부장님' 같은 호칭을 새로 만들지 않는다.",
    "13. 각 표현은 서로 다른 문장 구조를 사용해야 한다. 5개 결과가 비슷한 패턴이면 안 된다.",
    "14. 자연스러운 한국어 비즈니스 표현을 사용한다. 번역투는 금지.",
    "",
    "## 출력 형식",
    '{"risk":{"level":"low|medium|high","reason":"짧은 이유"},"results":[{"title":"정중한 표현","text":"..."},{"title":"부드러운 표현","text":"..."},{"title":"단호한 표현","text":"..."},{"title":"짧은 표현","text":"..."},{"title":"센스형 표현","text":"..."}]}',
    "",
    "## 입력 정보",
    `원문: ${text}`,
    `상대: ${labels.audience[audience]}`,
    `선택 톤: ${labels.tone[tone]} (${toneGuide[tone] || ""})`,
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

function buildFallbackResponse(input) {
  const context = toContext(input);
  const risk = estimateRisk(context);
  const target = getTargetName(context.text);
  const scenario = detectScenario(context.text);
  const copy = scenarioCopy[scenario] || scenarioCopy.general;

  return {
    risk,
    results: [
      { title: "정중한 표현", text: addTarget(target, copy.polite) },
      { title: "부드러운 표현", text: addTarget(target, copy.soft) },
      { title: "단호한 표현", text: addTarget(target, copy.firm) },
      { title: "짧은 표현", text: addTarget(target, copy.short) },
      { title: "센스형 표현", text: addTarget(target, copy.sense) },
    ],
  };
}

function shouldUseGuidedFallback(text) {
  return detectScenario(text) !== "general";
}

const scenarioCopy = {
  hygiene: {
    polite: "회의 중 대화 환경과 관련해 조심스럽게 말씀드립니다. 서로 집중하기 편한 환경을 위해 개인 위생 부분을 한 번만 신경 써주시면 감사하겠습니다.",
    soft: "말씀드리기 조심스럽지만 가까이 대화할 때 조금 신경 쓰이는 부분이 있었습니다. 서로 편한 회의 분위기를 위해 살짝만 챙겨주시면 좋겠습니다.",
    firm: "대면 회의 시 개인 위생 관련 불편함이 반복되고 있습니다. 원활한 소통을 위해 개선 부탁드립니다.",
    short: "대면 대화 시 개인 위생 부분을 조금만 신경 써주시면 감사하겠습니다.",
    sense: "회의 집중도를 위해 아주 조심스럽게 말씀드립니다. 서로 편하게 이야기할 수 있는 환경부터 맞춰보면 좋겠습니다.",
  },
  long_talk: {
    polite: "논의가 길어지고 있어 핵심 결론과 다음 진행 항목을 한 번 정리해주시면 감사하겠습니다.",
    soft: "말씀해주신 내용은 이해했습니다. 다만 핵심만 한 번 더 정리해주시면 제가 더 정확히 맞춰보겠습니다.",
    firm: "현재 설명만으로는 요점과 결정 사항을 파악하기 어렵습니다. 결론과 요청 사항을 명확히 정리 부탁드립니다.",
    short: "핵심 결론과 요청 사항을 짧게 정리 부탁드립니다.",
    sense: "지금 내용이 회의록보다 장편에 가까워지고 있어, 핵심 장면만 먼저 짚어주시면 바로 움직이겠습니다.",
  },
  repeated: {
    polite: "이전에 논의된 내용과 달라진 부분이 있어, 변경 사유와 최종 기준을 다시 확인 부탁드립니다.",
    soft: "지난번에 정리했던 내용과 조금 달라 보여서요. 이번 기준이 최종인지 한 번만 확인해주시면 좋겠습니다.",
    firm: "동일한 내용이 반복되어 혼선이 생기고 있습니다. 기존 결정 사항과 변경된 내용을 명확히 구분해주시기 바랍니다.",
    short: "기존 결정 사항과 변경 사유를 다시 확인 부탁드립니다.",
    sense: "저희가 같은 파일의 다른 버전을 보고 있는 것 같습니다. 최종본 기준으로 한 번만 맞춰보겠습니다.",
  },
  unnecessary_work: {
    polite: "이번 업무의 목적과 필요 범위를 먼저 확인한 뒤 진행하면 좋겠습니다.",
    soft: "이 업무가 실제로 어떤 결과에 쓰이는지 먼저 맞춰보면 더 효율적으로 진행할 수 있을 것 같습니다.",
    firm: "업무 목적과 산출 기준이 명확하지 않아 바로 진행하기 어렵습니다. 필요성과 범위를 먼저 확정 부탁드립니다.",
    short: "업무 목적과 범위를 먼저 확인 부탁드립니다.",
    sense: "일단 움직이기 전에 목적지를 확인하면 좋겠습니다. 그래야 헛걸음을 줄일 수 있을 것 같습니다.",
  },
  meeting_efficiency: {
    polite: "이 사안은 회의보다 메일로 핵심 내용과 결정 사항을 정리해도 충분할 것 같습니다.",
    soft: "회의 시간을 줄이고 메일로 정리하면 더 빠르게 마무리할 수 있을 것 같습니다.",
    firm: "추가 회의보다 서면 정리와 결정 사항 공유가 더 효율적입니다.",
    short: "이 건은 메일로 정리해도 충분할 것 같습니다.",
    sense: "이 안건은 회의실보다 받은편지함이 더 잘 어울리는 것 같습니다.",
  },
  contradiction: {
    polite: "말씀하신 내용 중 기준이 다르게 이해되는 부분이 있어, 앞뒤 맥락을 한 번 정리해주시면 감사하겠습니다.",
    soft: "제가 이해한 내용이 조금 엇갈리는 것 같아서요. 기준을 한 번만 맞춰보면 좋겠습니다.",
    firm: "현재 설명에는 서로 맞지 않는 부분이 있어 그대로 진행하기 어렵습니다. 기준을 명확히 정리 부탁드립니다.",
    short: "기준이 엇갈리는 부분이 있어 정리 부탁드립니다.",
    sense: "지금 내용은 좌회전과 우회전 안내가 같이 나온 느낌이라, 방향을 한 번만 맞춰보겠습니다.",
  },
  late_change: {
    polite: "진행 중 변경 사항이 반복되면 실무 기준을 맞추기 어렵습니다. 최종 방향을 먼저 확정해주시면 감사하겠습니다.",
    soft: "변경이 계속되면 맞춰가는 쪽도 혼선이 생겨서요. 이번 방향이 최종인지 먼저 확인해보면 좋겠습니다.",
    firm: "결정이 계속 바뀌면 일정과 품질 모두 영향을 받습니다. 최종 기준 확정 후 진행 부탁드립니다.",
    short: "최종 방향을 먼저 확정 부탁드립니다.",
    sense: "기준이 계속 움직이면 골대도 같이 뛰는 상황이라, 먼저 위치를 고정해보면 좋겠습니다.",
  },
  overload: {
    polite: "현재 요청은 제 담당 범위를 넘어서는 부분이 있어, 담당자와 역할을 다시 확인해주시면 좋겠습니다.",
    soft: "제가 도울 수 있는 부분은 확인하겠습니다. 다만 정확한 담당 범위를 먼저 나누면 더 빠르게 처리될 것 같습니다.",
    firm: "해당 업무는 제 담당 범위가 아닙니다. 실제 담당자 확인 후 진행 부탁드립니다.",
    short: "담당 범위와 담당자 확인 부탁드립니다.",
    sense: "제가 만능 창구가 되면 처리 속도가 오히려 느려질 수 있어, 담당 라인을 먼저 맞추겠습니다.",
  },
  urgency: {
    polite: "긴급도와 실제 마감 시점을 명확히 알려주시면 우선순위를 조정해 진행하겠습니다.",
    soft: "급한 건은 이해했습니다. 정확한 마감 시간과 필요한 자료를 함께 주시면 바로 우선순위를 잡겠습니다.",
    firm: "긴급 요청이라면 마감일, 우선순위, 필요 자료가 함께 공유되어야 합니다.",
    short: "정확한 마감일과 필요 자료를 공유 부탁드립니다.",
    sense: "ASAP만으로는 달력에 표시가 안 되어, 실제 마감 시간을 찍어주시면 바로 맞춰보겠습니다.",
  },
  quality: {
    polite: "자료의 완성도를 조금 더 보완한 뒤 검토하면 좋겠습니다.",
    soft: "자료 방향은 이해했습니다. 다만 몇몇 부분은 조금 더 정리되면 훨씬 설득력이 좋아질 것 같습니다.",
    firm: "현재 자료는 검토나 승인 단계로 보기에는 보완이 필요합니다.",
    short: "자료 보완 후 다시 검토하겠습니다.",
    sense: "자료가 아직 초안의 숨결을 강하게 품고 있어서, 한 번 더 다듬으면 좋겠습니다.",
  },
  approval_risk: {
    polite: "현 상태로 승인하기에는 검토 근거와 책임 범위가 부족해 보입니다.",
    soft: "바로 승인하기보다는 근거와 영향도를 조금 더 확인하고 가면 안전할 것 같습니다.",
    firm: "현재 상태로는 승인하기 어렵습니다. 근거와 책임 범위를 보완 부탁드립니다.",
    short: "승인 전 근거와 책임 범위 보완이 필요합니다.",
    sense: "도장을 찍기엔 아직 잉크보다 근거가 먼저 필요한 상황 같습니다.",
  },
  after_hours: {
    polite: "업무 시간 이후 대응이 필요한 경우 사전 공유와 우선순위 조율이 필요합니다.",
    soft: "퇴근 이후 요청은 놓칠 수 있어, 가능한 업무 시간 내에 공유해주시면 더 안정적으로 대응하겠습니다.",
    firm: "업무 시간 외 지시는 긴급 사유가 있을 때만 사전 협의 후 진행 부탁드립니다.",
    short: "업무 시간 외 요청은 사전 협의 부탁드립니다.",
    sense: "퇴근 버튼을 누른 뒤에는 사람도 절전 모드라, 긴급 건은 미리 알려주시면 좋겠습니다.",
  },
  dinner: {
    polite: "회식보다 각자 회복 시간을 확보하는 편이 팀 운영에 더 도움이 될 수 있을 것 같습니다.",
    soft: "팀워크도 중요하지만 이번에는 개인 일정과 컨디션을 고려해주시면 좋겠습니다.",
    firm: "이번 회식은 참여가 어렵습니다. 업무 외 일정은 자율적으로 조율 부탁드립니다.",
    short: "이번 회식은 참석이 어렵습니다.",
    sense: "오늘 팀워크는 회식보다 모두의 빠른 귀가에서 더 잘 지켜질 것 같습니다.",
  },
  feedback_reaction: {
    polite: "의견 요청에 따라 말씀드린 내용이니, 개선 방향 중심으로 논의되면 좋겠습니다.",
    soft: "요청 주신 의견이라 솔직히 말씀드렸습니다. 더 나은 방향으로 같이 맞춰보면 좋겠습니다.",
    firm: "의견을 요청하신 사안이므로, 개인적인 반응보다 논의 내용 중심으로 봐주시면 좋겠습니다.",
    short: "요청하신 의견 기준으로 말씀드린 내용입니다.",
    sense: "의견을 달라고 하셔서 의견을 드린 거라, 이제 의견답게 다뤄주시면 좋겠습니다.",
  },
  review_rebuild: {
    polite: "검토 범위가 단순 확인을 넘어 재작업에 가까워 보여, 요청 범위를 다시 정리해주시면 좋겠습니다.",
    soft: "검토 요청으로 이해했는데 실제로는 수정 범위가 꽤 커 보여서요. 어디까지 반영하면 될지 먼저 맞추면 좋겠습니다.",
    firm: "현재 요청은 검토가 아니라 재작업 범위에 가깝습니다. 범위와 일정을 재협의해야 합니다.",
    short: "검토 범위와 재작업 범위를 구분 부탁드립니다.",
    sense: "이건 검토라기보다 리모델링에 가까워 보여서, 공사 범위부터 정하면 좋겠습니다.",
  },
  risky_direction: {
    polite: "현재 방향은 실행 리스크가 커 보여, 진행 전에 대안과 영향도를 함께 검토하는 편이 안전합니다.",
    soft: "취지는 이해하지만 실제 진행 시 어려움이 예상됩니다. 대안까지 같이 보면 좋겠습니다.",
    firm: "현재 방향은 실패 가능성이 높아 보입니다. 진행 전 재검토가 필요합니다.",
    short: "현재 방향은 리스크 검토가 필요합니다.",
    sense: "지금 방향은 출발 전에 안전벨트를 한 번 더 확인해야 할 것 같습니다.",
  },
  permission: {
    polite: "제가 처리하지 않는 이유는 역량 문제가 아니라 권한 범위 때문입니다. 필요한 권한이나 담당자를 확인 부탁드립니다.",
    soft: "제가 도울 수 있는 부분은 확인하겠습니다. 다만 권한이 필요한 영역이라 담당자 확인이 먼저 필요합니다.",
    firm: "현재 권한으로는 처리할 수 없습니다. 권한 부여 또는 담당자 지정이 필요합니다.",
    short: "권한 확인 또는 담당자 지정 부탁드립니다.",
    sense: "열쇠가 없는 문 앞에서 오래 서 있어도 문은 열리지 않아, 권한부터 확인해야 할 것 같습니다.",
  },
  decision_delay: {
    polite: "결정이 지연되면 실무 진행도 함께 늦어집니다. 검토 항목과 결정 기준을 먼저 확정해주시면 감사하겠습니다.",
    soft: "검토가 필요한 점은 이해했습니다. 다만 결정 기준이 정리되면 실무도 더 빠르게 움직일 수 있을 것 같습니다.",
    firm: "결정 없이 검토만 반복되면 진행이 어렵습니다. 결정 기준과 책임자를 확정 부탁드립니다.",
    short: "결정 기준과 책임자 확정 부탁드립니다.",
    sense: "검토가 계속 공전 중이라, 이제 착륙 지점을 정하면 좋겠습니다.",
  },
  fixed_answer: {
    polite: "의견을 구하는 자리라면 다른 선택지도 함께 검토될 수 있으면 좋겠습니다.",
    soft: "정해진 방향이 있다면 먼저 공유해주시면, 그 기준 안에서 의견을 맞춰보겠습니다.",
    firm: "이미 결론이 정해진 사안이라면 의견 요청 범위를 명확히 해주셔야 합니다.",
    short: "의견 요청 범위를 명확히 부탁드립니다.",
    sense: "답이 정해진 문제라면 객관식인지 주관식인지 먼저 알려주시면 좋겠습니다.",
  },
  impossible_schedule: {
    polite: "현재 일정은 현실적으로 진행 가능성이 낮아 보입니다. 범위나 마감 조정이 필요합니다.",
    soft: "일정 취지는 이해했지만 현재 범위로는 무리가 있어 보여서요. 우선순위를 줄이면 맞춰볼 수 있을 것 같습니다.",
    firm: "현재 일정으로는 품질을 보장하기 어렵습니다. 범위 조정 또는 일정 변경이 필요합니다.",
    short: "현재 일정은 범위 조정이 필요합니다.",
    sense: "이 일정은 AI도 로딩 화면을 오래 띄울 수준이라, 범위를 먼저 줄여야 할 것 같습니다.",
  },
  ad_hoc: {
    polite: "변경이 잦아지면 기획 기준이 흔들릴 수 있어, 최종 방향을 한 번 확정하고 진행하면 좋겠습니다.",
    soft: "아이디어가 계속 나오는 건 좋지만, 실무 기준을 잡기 위해 이번 방향을 먼저 고정하면 좋겠습니다.",
    firm: "즉흥적인 변경이 반복되면 일정과 품질에 영향이 큽니다. 최종 방향 확정 후 진행 부탁드립니다.",
    short: "최종 기획 방향을 먼저 확정 부탁드립니다.",
    sense: "아이디어가 실시간 업데이트 중이라, 이제 버전 하나를 배포판으로 정하면 좋겠습니다.",
  },
  blame: {
    polite: "진행 이력이 남아 있는 만큼, 책임 소재보다 변경 과정과 사실 관계를 기준으로 정리하면 좋겠습니다.",
    soft: "히스토리가 있으니 서로 오해 없게 진행 과정을 먼저 확인해보면 좋겠습니다.",
    firm: "해당 이력상 제 책임으로만 보기 어렵습니다. 사실 관계를 기준으로 정리 부탁드립니다.",
    short: "진행 이력 기준으로 사실 관계 확인 부탁드립니다.",
    sense: "이 건은 기억보다 기록이 더 정확할 것 같아, 히스토리 기준으로 보겠습니다.",
  },
  resource_missing: {
    polite: "급한 건이라면 필요한 자료와 결정 사항도 함께 공유되어야 바로 진행할 수 있습니다.",
    soft: "빠르게 진행하고 싶습니다. 필요한 자료만 같이 주시면 바로 이어가겠습니다.",
    firm: "필요 자료 없이 긴급 처리만 요청하면 진행이 어렵습니다. 자료 공유 후 착수하겠습니다.",
    short: "필요 자료를 먼저 공유 부탁드립니다.",
    sense: "급행 열차도 선로가 있어야 출발해서, 필요한 자료부터 부탁드립니다.",
  },
  responsibility_shift: {
    polite: "현재 구조는 실행 책임과 결정 권한이 분리되어 있어, 책임 범위를 명확히 하고 진행하는 편이 좋겠습니다.",
    soft: "진행은 가능하지만 결정 권한과 책임 범위를 먼저 맞추면 서로 부담이 줄어들 것 같습니다.",
    firm: "책임은 실무가 지고 결정은 다른 곳에서 하는 구조라면 진행 리스크가 큽니다. 권한과 책임을 명확히 부탁드립니다.",
    short: "결정 권한과 책임 범위 확인 부탁드립니다.",
    sense: "운전대와 브레이크가 다른 사람에게 있는 느낌이라, 먼저 역할을 맞추면 좋겠습니다.",
  },
  team_risk: {
    polite: "이 방향으로 진행하면 추후 저희 팀에 리스크가 집중될 수 있어 사전 조율이 필요합니다.",
    soft: "진행은 가능하지만 나중에 저희 팀 부담으로 돌아올 수 있는 부분이 보여서 먼저 조율하면 좋겠습니다.",
    firm: "현재 방향은 추후 저희 팀에 책임이 집중될 가능성이 큽니다. 리스크 조정이 필요합니다.",
    short: "팀 리스크 사전 조율이 필요합니다.",
    sense: "나중에 청구서가 저희 팀으로 올 가능성이 보여서, 지금 계산서를 먼저 맞춰보겠습니다.",
  },
  not_working: {
    polite: "보고용으로는 좋아 보이지만 실제 운영 가능성은 추가 검토가 필요합니다.",
    soft: "겉보기에는 좋아 보이지만 실제로 돌아가는 방식까지 같이 확인하면 더 안전할 것 같습니다.",
    firm: "현재 안은 실제 운영 기준에서는 작동하기 어렵습니다. 실행 가능성 재검토가 필요합니다.",
    short: "실제 운영 가능성 검토가 필요합니다.",
    sense: "자료에서는 잘 달리지만 현장에서는 바퀴를 한 번 더 확인해야 할 것 같습니다.",
  },
  founder_idea: {
    polite: "제안 취지는 이해하지만, 실행 가능성과 현장 영향도는 별도로 검토가 필요합니다.",
    soft: "좋은 방향일 수 있지만 실무 적용 시 영향이 있어 보여서, 실행 관점도 함께 보면 좋겠습니다.",
    firm: "아이디어와 실행 가능성은 별도로 봐야 합니다. 현장 영향도 검토 후 진행해야 합니다.",
    short: "실행 가능성과 현장 영향도 검토가 필요합니다.",
    sense: "아이디어는 위에서 내려왔지만 실행은 현장에서 굴러가니, 바닥 상태도 같이 보겠습니다.",
  },
  judgment_attitude: {
    polite: "이번 판단이나 대응 방식은 납득하기 어려운 부분이 있어, 기준과 이유를 다시 한번 확인 부탁드립니다.",
    soft: "말씀드리기 조심스럽지만 이번 대응은 조금 더 신중하게 봐야 할 부분이 있어 보입니다.",
    firm: "현재 판단이나 대응 방식은 그대로 받아들이기 어렵습니다. 기준과 근거를 명확히 공유 부탁드립니다.",
    short: "이번 판단 기준과 근거를 다시 확인 부탁드립니다.",
    sense: "지금 흐름은 제 상식 버튼이 잠깐 멈춘 상태라, 판단 기준부터 다시 맞춰보겠습니다.",
  },
  rigid_attitude: {
    polite: "기준을 지키는 것도 중요하지만, 이번 건은 상황에 맞춘 유연한 조율도 함께 필요해 보입니다.",
    soft: "원칙은 이해합니다. 다만 이번 상황에서는 조금 더 유연하게 조율하면 서로 부담이 줄어들 것 같습니다.",
    firm: "현재 대응은 지나치게 경직되어 보입니다. 상황을 고려한 조정이 필요합니다.",
    short: "이번 건은 조금 더 유연한 조율이 필요합니다.",
    sense: "원칙은 안전벨트처럼 필요하지만, 지금은 핸들도 같이 돌려야 할 것 같습니다.",
  },
  smile_not_agree: {
    polite: "제가 바로 동의한 것은 아니며, 우려되는 부분은 별도로 정리해서 말씀드리겠습니다.",
    soft: "제가 웃으며 들었지만 아직 동의까지 한 것은 아닙니다. 걱정되는 부분은 정리해서 공유드리겠습니다.",
    firm: "제 반응을 동의로 해석하지는 말아주시면 좋겠습니다. 이견은 별도로 전달드리겠습니다.",
    short: "동의 여부는 별도로 말씀드리겠습니다.",
    sense: "미소는 자동 응답이고, 동의 버튼은 아직 누르지 않았습니다.",
  },
  general: {
    polite: "이 부분은 조금 더 신중하게 조율이 필요해 보입니다. 가능하실 때 다시 한번 확인 부탁드립니다.",
    soft: "서로 오해 없이 맞춰가면 좋을 것 같습니다. 편하실 때 한 번 더 확인 부탁드립니다.",
    firm: "현재 내용은 그대로 진행하기 어렵습니다. 기준에 맞게 다시 조정 부탁드립니다.",
    short: "이 부분은 재확인이 필요해 보입니다. 다시 검토 부탁드립니다.",
    sense: "서로 다른 방향을 보고 있는 것 같아 한 번만 좌표를 맞춰보면 좋겠습니다.",
  },
};

function toContext(input) {
  if (input && typeof input === "object" && typeof input.text === "string") {
    return {
      text: input.text,
      audience: labels.audience[input.audience] ? input.audience : "boss",
      tone: labels.tone[input.tone] ? input.tone : "polite",
      format: labels.format[input.format] ? input.format : "general",
      intentHint: input.intentHint || inferIntentHint(input.text),
    };
  }

  const text = String(input || "");
  return {
    text,
    audience: "boss",
    tone: "polite",
    format: "general",
    intentHint: inferIntentHint(text),
  };
}

function addTarget(target, text) {
  return target ? `${target}, ${text}` : text;
}

function getTargetName(text) {
  const name = extractRecipientName(text);
  return name ? `${name}님` : "";
}

const SCENARIO_PATTERNS = [
  { scenario: "hygiene", patterns: ["입냄새", "구강", "악취", "위생", "냄새난다", "몸냄새"], weight: 3 },
  { scenario: "judgment_attitude", patterns: ["왜사", "뭐하러사", "생각을하", "생각이있", "뇌가있", "뇌있", "정신있", "제정신"], weight: 3 },
  { scenario: "long_talk", patterns: ["말이너무길", "요점이뭔지", "핵심이뭔지", "같은얘기세번째", "길게만"], weight: 2 },
  { scenario: "repeated", patterns: ["지난주에도", "또까먹", "저번에결정", "그렇게하지말자고", "몇번째야", "또모르", "또까먹", "말귀", "못알아", "또말", "몇번말"], weight: 2 },
  { scenario: "unnecessary_work", patterns: ["시키고싶어서", "시키는일", "목적없이", "왜하는건지"], weight: 2 },
  { scenario: "meeting_efficiency", patterns: ["회의는메일", "메일한통", "회의만계속", "일할시간이없"], weight: 2 },
  { scenario: "contradiction", patterns: ["앞뒤안맞", "설명이부족", "이해를못한게아니라", "앞말뒷말"], weight: 2 },
  { scenario: "late_change", patterns: ["지금와서바꾸", "계속바뀌", "자꾸말이바뀌", "기획이아니라즉흥", "자주바뀌면", "또바뀌"], weight: 2 },
  { scenario: "overload", patterns: ["만능해결사", "왜다저한테", "제일이아니", "담당자한테", "떠넘기기", "다제가"], weight: 2 },
  { scenario: "urgency", patterns: ["ASAP", "정확한마감", "본인이늦게", "급한게아니라", "퇴근10분전", "왜이제말씀", "진작말", "아직", "안됐", "언제됐", "지연", "마감"], weight: 1 },
  { scenario: "quality", patterns: ["자료대충", "대충만든티", "퀄리티가"], weight: 2 },
  { scenario: "approval_risk", patterns: ["보고승인", "승인하라는건", "무책임", "책임지고승인"], weight: 2 },
  { scenario: "after_hours", patterns: ["퇴근이라는걸", "야근확정", "새벽에업무", "사람살려", "퇴근후"], weight: 2 },
  { scenario: "dinner", patterns: ["회식보다", "팀워크에좋", "회식강요"], weight: 2 },
  { scenario: "feedback_reaction", patterns: ["의견달라고", "왜삐지", "의견을묻", "피드백달라고"], weight: 2 },
  { scenario: "review_rebuild", patterns: ["검토요청", "다시만들라는", "수정이아니라새프로젝트"], weight: 2 },
  { scenario: "risky_direction", patterns: ["망할가능성", "이방향은망", "실제로는안돌아", "보고용으로예뻐", "아닌것같", "문제", "반려", "위험"], weight: 1 },
  { scenario: "permission", patterns: ["권한이없어서", "몰라서못하는게아니라", "권한없"], weight: 2 },
  { scenario: "decision_delay", patterns: ["결정은안하시고", "검토만", "결정을못", "결정지연"], weight: 2 },
  { scenario: "fixed_answer", patterns: ["답정너", "답은정해", "결론있"], weight: 2 },
  { scenario: "impossible_schedule", patterns: ["정신승리", "불가능", "AI한테시켜도힘", "일정말이안"], weight: 2 },
  { scenario: "blame", patterns: ["히스토리", "제탓으로돌리", "책임전가"], weight: 2 },
  { scenario: "resource_missing", patterns: ["필요한자료부터", "자료부터", "자료없이"], weight: 2 },
  { scenario: "responsibility_shift", patterns: ["책임은제가", "결정은다른분", "책임결정"], weight: 2 },
  { scenario: "team_risk", patterns: ["저희팀만욕", "팀만욕먹", "팀에책임"], weight: 2 },
  { scenario: "founder_idea", patterns: ["대표님아이디어", "아무도반대못", "위에서내려"], weight: 2 },
  { scenario: "smile_not_agree", patterns: ["웃고는있지만", "동의한다는뜻은아"], weight: 2 },
  { scenario: "rigid_attitude", patterns: ["쫌생", "좀생", "쩨쩨", "좁쌀", "빡빡", "융통성"], weight: 2 },
  { scenario: "not_working", patterns: ["실제론안돌아", "보고용으로만", "발표용"], weight: 2 },
  { scenario: "ad_hoc", patterns: ["즉흥", "매번바뀌", "기획없이"], weight: 2 },
];

function detectScenario(text) {
  const normalized = String(text || "").replace(/\s+/g, "");
  if (!normalized) return "general";

  const scores = new Map();

  for (const rule of SCENARIO_PATTERNS) {
    let score = 0;
    for (const pat of rule.patterns) {
      if (normalized.includes(pat)) {
        score += rule.weight;
      }
    }
    if (score > 0) {
      scores.set(rule.scenario, (scores.get(rule.scenario) || 0) + score);
    }
  }

  if (scores.size === 0) return "general";

  let bestScenario = "general";
  let bestScore = 0;
  for (const [scenario, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestScenario = scenario;
    }
  }

  return bestScenario;
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

function normalizeModelResponse(parsed, input) {
  const context = toContext(input);
  const estimatedRisk = estimateRisk(context);
  const risk = parsed?.risk && typeof parsed.risk === "object" ? parsed.risk : {};
  const modelLevel = ["low", "medium", "high"].includes(risk.level) ? risk.level : estimatedRisk.level;
  const level = pickHigherRisk(modelLevel, estimatedRisk.level);
  const reason = typeof risk.reason === "string" && risk.reason.trim() ? risk.reason.trim() : estimatedRisk.reason;
  const recipientName = extractRecipientName(context.text);

  const sourceResults = Array.isArray(parsed?.results) ? parsed.results : [];
  const defaults = buildFallbackResponse(context).results;

  const results = defaults.map((fallback, index) => {
    const item = sourceResults[index];
    const candidateText = typeof item?.text === "string" && item.text.trim() ? item.text.trim() : "";
    const repairedText = repairAwkwardVocatives(candidateText, context);
    const text = isUsableKoreanResult(repairedText) && isIntentAlignedResult(repairedText, context, recipientName) ? repairedText : fallback.text;
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
  if (hasBannedVocative(text)) return false;
  const unexpectedLatin = text.match(/[A-Za-z]{3,}/g) || [];
  const allowed = new Set(["AI", "API", "URL", "PDF", "Excel"]);
  return unexpectedLatin.every((word) => allowed.has(word));
}

function repairAwkwardVocatives(text, context) {
  const source = String(text || "").trim();
  if (!source) return "";

  const withoutBadVendor = source
    .replace(/^거래처님,?\s*/g, "")
    .replace(/^거래처\s*담당자님,?\s*/g, "담당자님, ")
    .replace(/^상사님,?\s*/g, "")
    .replace(/^동료님,?\s*/g, "")
    .replace(/^후배님,?\s*/g, "")
    .replace(/^직원님,?\s*/g, "");
  const withoutInventedTitle = removeInventedTitlePrefix(withoutBadVendor, context.text);

  if (context.audience !== "customer") {
    return withoutInventedTitle.replace(/^고객님,?\s*/g, "");
  }

  return withoutInventedTitle;
}

function removeInventedTitlePrefix(text, original) {
  const titlePattern = /^(대표|사장|부사장|전무|상무|이사|실장|본부장|센터장|팀장|부장|차장|과장|대리|주임|선배)님,?\s*/;
  const match = text.match(titlePattern);
  if (!match) return text;

  const source = String(original || "").replace(/\s+/g, "");
  if (source.includes(match[1])) return text;
  return text.replace(titlePattern, "");
}

function hasBannedVocative(text) {
  return /(^|[\s"'“”‘’])(?:거래처|상사|동료|후배|직원|해당\s*내용|해당\s*부분)님(?:,|\s|$)/.test(text);
}

function isIntentAlignedResult(text, input, recipientName) {
  const context = toContext(input);
  const original = context.text.replace(/\s+/g, "");
  const result = text.replace(/\s+/g, "");
  const scenario = detectScenario(context.text);

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

  if (scenario === "late_change") {
    return /(변경|최종|방향|기준|확정|조율|결정)/.test(result);
  }

  if (scenario === "urgency") {
    return /(마감|우선순위|긴급|자료|공유|시점|일정)/.test(result);
  }

  if (scenario === "overload") {
    return /(담당|범위|역할|확인|조율)/.test(result);
  }

  if (scenario === "meeting_efficiency") {
    return /(회의|메일|서면|정리|결정|효율)/.test(result);
  }

  return true;
}

function inferIntentHint(text) {
  const normalized = text.replace(/\s+/g, "");
  const scenario = detectScenario(text);

  if (scenario !== "general") {
    return `분류된 상황: ${scenario}. 상대 유형을 호칭으로 쓰지 말고 원문의 핵심 불만만 업무 문장으로 바꿔라.`;
  }

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

function estimateRisk(input) {
  const text = toContext(input).text;
  const normalized = text.replace(/\s+/g, "");

  const highPatterns = [
    { re: /씨발|병신|미친|꺼져|죽|뒤져|엠창/, label: "심한 욕설" },
    { re: /왜사|뭐하러사|뇌있|뇌가|정신있|제정신/, label: "인신공격성 표현" },
    { re: /입냄새|냄새|구강|악취|위생/, label: "개인 위생 관련 지적" },
    { re: /말귀|멍청|한심|바보|등신/, label: "지능 비하" },
    { re: /쫌생|좀생|쩨쩨|좁쌀/, label: "성격 모욕" },
  ];

  for (const { re, label } of highPatterns) {
    if (re.test(normalized)) {
      return { level: "high", reason: `${label}이 포함되어 있어 상대가 공격으로 받아들일 수 있습니다.` };
    }
  }

  const mediumPatterns = [
    { re: /왜아직|아직안|언제/, label: "독촉성 표현" },
    { re: /말이안|무리|불가|안됨|안돼/, label: "부정적 압박" },
    { re: /아닌|제일아닌/, label: "강한 부정" },
    { re: /짜증|답답|빡빡|융통성/, label: "감정적 불만" },
    { re: /또바뀌|자꾸|계속/, label: "반복적 불만" },
  ];

  let mediumCount = 0;
  let mediumLabel = "";
  for (const { re, label } of mediumPatterns) {
    if (re.test(normalized)) {
      mediumCount++;
      mediumLabel = label;
    }
  }

  if (mediumCount >= 2) {
    return { level: "medium", reason: "여러 불만 표현이 겹쳐 압박감이 큰 문장입니다." };
  }
  if (mediumCount === 1) {
    return { level: "medium", reason: `${mediumLabel}으로 읽혀 표현을 조정하는 편이 좋습니다.` };
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
