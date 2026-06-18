# 회사어 번역기

대충 쓴 문장을 회사에서 바로 보낼 수 있는 업무 문장으로 바꿔주는 AI 웹툴입니다.

## 배포 전 설정

Vercel 환경변수에 아래 값을 추가합니다.

```text
GEMINI_API_KEY=your_gemini_api_key
DAILY_LIMIT=5
GEMINI_MODEL=gemini-3.1-flash-lite
```

`GEMINI_API_KEY`는 브라우저 코드에 넣지 말고 Vercel 환경변수에만 넣어야 합니다.

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 `New Project`를 누르고 저장소를 선택합니다.
3. Framework Preset은 `Other` 또는 기본값으로 둡니다.
4. Build Command는 비워둡니다.
5. Output Directory도 비워둡니다.
6. 환경변수 3개를 추가합니다.
7. Deploy를 누릅니다.

## AdSense 준비

AdSense 사이트 추가 전 최소한 아래 페이지가 공개 URL에서 열려야 합니다.

- `/`
- `/about.html`
- `/privacy.html`
- `/terms.html`
- `/contact.html`
- `/robots.txt`

사이트 도메인이 정해지면 `sitemap.xml`의 `https://example.com`을 실제 도메인으로 바꿉니다.
