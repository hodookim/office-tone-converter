# 회사어 번역기

말하기 애매한 문장을 회사에서 바로 보낼 수 있는 업무 문장으로 바꿔주는 AI 웹·Android 도구입니다.

## 프로젝트 구성

- 공개 웹: `index.html`, `site-v2.css`, `app.js`
- Android 앱 화면: `app-mobile.html`, `mobile-app.css`, `app.js`
- 서버 API: `api/convert.js`
- Android 프로젝트: `android/`

공개 웹은 검색과 가이드 콘텐츠를 포함하고, Android 앱은 입력, 변환, 복사에 집중한 별도 화면을 사용합니다. `npm run mobile:sync`를 실행하면 앱 전용 화면이 `mobile-web/`을 거쳐 Android 프로젝트에 동기화됩니다.

## 배포 전 설정

Vercel 환경변수에 아래 값을 추가합니다.

```text
GEMINI_API_KEY=your_gemini_api_key
DAILY_LIMIT=5
GEMINI_MODEL=gemini-3.1-flash-lite
NVIDIA_API_KEY=your_nvidia_api_key
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
```

API 키는 브라우저 코드에 넣지 말고 Vercel 환경변수에만 넣어야 합니다. Gemini 호출이 실패하면 NVIDIA API가 설정된 경우 자동으로 대체 호출합니다.

## Android 빌드

```powershell
npm.cmd run mobile:sync
powershell -ExecutionPolicy Bypass -File scripts\build-android-debug.ps1
powershell -ExecutionPolicy Bypass -File scripts\build-android-release.ps1
```

Play Console 업로드 파일은 `android/app/build/outputs/bundle/release/app-release.aab`에 생성됩니다.

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
