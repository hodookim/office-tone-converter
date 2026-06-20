# 연차 사유 생성기

연차, 반차, 병가, 지각, 재택, 조퇴처럼 말하기 애매한 근태 문장을 회사에 바로 보낼 수 있는 표현으로 바꿔주는 AI 문장 도구입니다.

## 배포 전 설정

Vercel 환경변수에 아래 값을 추가합니다.

```txt
GEMINI_API_KEY=your_gemini_api_key
DAILY_LIMIT=5
GEMINI_MODEL=gemini-3.1-flash-lite
```

`GEMINI_API_KEY`는 브라우저 코드에 넣지 말고 Vercel 환경변수에만 넣어야 합니다.

## Vercel 배포

1. Vercel에서 `New Project`를 누릅니다.
2. GitHub 저장소를 선택합니다.
3. `Root Directory`를 `annual-leave-reason-generator`로 지정합니다.
4. Framework Preset은 `Other` 또는 기본값으로 둡니다.
5. Build Command와 Output Directory는 비워둡니다.
6. 환경변수 3개를 추가합니다.
7. Deploy를 누릅니다.

## 검색/광고 준비

- `robots.txt`
- `sitemap.xml`
- `ads.txt`
- `about.html`
- `privacy.html`
- `terms.html`
- `contact.html`

위 파일을 포함합니다.
