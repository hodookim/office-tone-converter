process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";
process.env.DAILY_LIMIT = "999";

global.fetch = async () => ({
  ok: false,
  status: 503,
  json: async () => ({}),
});

const handler = require("../api/convert");

const cases = [
  "부장님, 입냄새 때문에 회의 집중이 안 됩니다.",
  "팀장님, 말이 너무 길어서 요점이 뭔지 모르겠습니다.",
  "이거 지난주에도 말했는데 또 까먹으신 건가요?",
  "죄송한데 이건 그냥 시키고 싶어서 시키는 일 아닌가요?",
  "이 회의는 메일 한 통이면 끝날 것 같습니다.",
  "방금 하신 말씀은 앞뒤가 하나도 안 맞습니다.",
  "이걸 지금 와서 바꾸자는 건 좀 양심 없는 것 같습니다.",
  "제가 만능 해결사도 아니고 왜 다 저한테 오나요?",
  "이건 급한 게 아니라 본인이 늦게 말한 겁니다.",
  "계속 ASAP이라고만 하지 말고 정확한 마감일을 주세요.",
  "이 자료는 대충 만든 티가 너무 납니다.",
  "이걸 보고 승인하라는 건 너무 무책임한 것 같습니다.",
  "저도 퇴근이라는 걸 하고 싶습니다.",
  "오늘도 야근 확정인가요? 사람 살려주세요.",
  "회식보다 집에 가는 게 더 팀워크에 좋을 것 같습니다.",
  "그건 제 일이 아니라 진짜 담당자한테 물어보셔야 합니다.",
  "이걸 왜 이제 말씀하시나요? 진작 말했어야죠.",
  "의견 달라고 해서 말했는데 왜 삐지시나요?",
  "검토 요청이라고 쓰셨지만 사실상 다시 만들라는 뜻 아닌가요?",
  "이 정도면 수정이 아니라 새 프로젝트입니다.",
  "죄송한데 이 방향은 망할 가능성이 높아 보입니다.",
  "저번에 그렇게 하지 말자고 결정한 거 아니었나요?",
  "이건 제가 몰라서 못 하는 게 아니라 권한이 없어서 못 하는 겁니다.",
  "자꾸 말이 바뀌면 저도 어떻게 맞춰야 할지 모르겠습니다.",
  "이 요청은 급한 척하지만 사실 중요하지 않은 것 같습니다.",
  "카톡으로 새벽에 업무 지시하지 말아주세요.",
  "퇴근 10분 전에 이걸 주시면 저는 어떻게 하라는 건가요?",
  "이건 대표님 아이디어라서 아무도 반대 못 하는 분위기인 것 같습니다.",
  "솔직히 이 일정은 사람이 아니라 AI한테 시켜도 힘듭니다.",
  "제가 웃고는 있지만 동의한다는 뜻은 아닙니다.",
  "부장님, 같은 얘기를 세 번째 하고 계십니다.",
  "팀장님, 결정은 안 하시고 왜 계속 검토만 하시나요?",
  "이건 의견을 묻는 게 아니라 답정너 아닌가요?",
  "죄송한데 이 일정은 정신승리로도 불가능합니다.",
  "이 정도로 자주 바뀌면 기획이 아니라 즉흥입니다.",
  "지금 문제는 실무가 아니라 위에서 결정을 못 하는 겁니다.",
  "이걸 제 탓으로 돌리기엔 히스토리가 너무 많이 남아 있습니다.",
  "말로만 급하다고 하지 마시고 필요한 자료부터 주세요.",
  "회의만 계속하면 일할 시간이 없습니다.",
  "제가 이해를 못 한 게 아니라 설명이 부족한 것 같습니다.",
  "이건 협업이 아니라 떠넘기기 같습니다.",
  "지금 말씀은 책임은 제가 지고 결정은 다른 분이 하겠다는 뜻인가요?",
  "이렇게 하면 나중에 분명 저희 팀만 욕먹을 것 같습니다.",
  "이건 보고용으로 예뻐 보일 뿐 실제로는 안 돌아갑니다.",
  "죄송하지만 이 요청은 급한 사람만 급한 상황입니다.",
  "대희야 진짜 너 왜 사냐",
  "원훈아 진짜 쫌생이같이굴래?",
];

const bannedVocatives = /(거래처님|상사님|동료님|후배님|직원님)/;
const bannedRawWords = /(입냄새|까먹|양심 없는|만능 해결사|사람 살려|삐지|망할|답정너|정신승리|떠넘기기|욕먹|쫌생)/;

function request(text) {
  return new Promise((resolve) => {
    const req = {
      method: "POST",
      headers: { host: "localhost:8787" },
      socket: { remoteAddress: "127.0.0.1" },
      body: {
        text,
        audience: "vendor",
        tone: "soft",
        format: "general",
      },
    };

    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(payload) {
        resolve({ statusCode: this.statusCode, payload: JSON.parse(payload || "{}") });
      },
    };

    handler(req, res);
  });
}

function expectedName(text) {
  const match = text.trim().match(/^([가-힣]{2,6}?)(?:아|야|님|씨)(?:\s|,|!|\.|$|진짜|너|혹시|이거|저거)/);
  if (!match) return "";
  return `${match[1]}님`;
}

(async () => {
  const failures = [];

  for (const [index, text] of cases.entries()) {
    const { statusCode, payload } = await request(text);
    const resultTexts = (payload.results || []).map((item) => item.text || "");
    const joined = resultTexts.join("\n");
    const name = expectedName(text);

    if (statusCode !== 200) {
      failures.push(`${index + 1}. HTTP ${statusCode}: ${text}`);
    }

    if (!Array.isArray(payload.results) || payload.results.length < 5) {
      failures.push(`${index + 1}. results missing: ${text}`);
    }

    if (bannedVocatives.test(joined)) {
      failures.push(`${index + 1}. banned generic vocative: ${text}\n${joined}`);
    }

    if (bannedRawWords.test(joined)) {
      failures.push(`${index + 1}. raw spicy word leaked: ${text}\n${joined}`);
    }

    if (name && !joined.includes(name)) {
      failures.push(`${index + 1}. recipient name not preserved (${name}): ${text}\n${joined}`);
    }
  }

  if (failures.length) {
    console.error(`FAIL ${failures.length} issue(s)`);
    console.error(failures.join("\n\n"));
    process.exit(1);
  }

  console.log(`PASS ${cases.length}/${cases.length} office tone cases`);
})();
