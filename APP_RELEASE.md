# 회사어 번역기 앱 출시 준비

## 현재 상태

- Capacitor Android 프로젝트가 `android/`에 생성되어 있습니다.
- 웹 번들은 `npm run mobile:prepare`로 `mobile-web/`에 생성됩니다.
- 앱에서는 `https://office-tone-converter.vercel.app/api/convert`를 호출합니다.
- Android 패키지명은 `ai.its.office.toneconverter`입니다.
- 앱 이름은 `회사어 번역기`입니다.
- 현재 버전은 `1.1.0`이고 버전 코드는 `4`입니다.
- 공개 웹과 Android 앱은 화면을 분리하며, 앱은 `app-mobile.html`과 `mobile-app.css`를 사용합니다.
- AdMob 앱 ID는 `ca-app-pub-6063034290894650~3543932834`로 설정되어 있습니다.
- 현재 앱 배너 광고는 Google 테스트 광고 단위 ID로 연결되어 있습니다. 실제 출시 전 AdMob에서 배너 광고 단위 ID를 만든 뒤 `app.js`의 `ADMOB_BANNER_ID`를 교체해야 합니다.
- Google Play 등록 정보 초안은 `store-assets/play-store-listing-ko.md`에 있습니다.
- 데이터 보안 답변 초안은 `store-assets/data-safety-ko.md`에 있습니다.
- 스크린샷 제작 계획은 `store-assets/screenshot-plan-ko.md`에 있습니다.

## 로컬 빌드 결과

디버그 APK와 Play Console 업로드용 릴리즈 AAB 빌드는 성공했습니다.

```text
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/bundle/release/app-release.aab
```

## 1.1.0 변경사항

- Android 전용 모바일 UI로 전면 개편
- 변환, 템플릿, 기록, 설정의 하단 탭 구조 적용
- 5개 상대, 4개 톤, 4개 형식을 작은 화면에서도 한눈에 선택하도록 개선
- 선택한 톤과 센스형 표현 두 가지 결과, 위험도, 복사와 공유 제공
- 네트워크 오류, 요청 시간 초과, 재시도 안내 개선
- 시스템, 밝게, 어둡게 테마 선택과 기기 안전 영역 대응

현재 PC의 기본 Java는 Java 26이라 Gradle과 맞지 않습니다. Android Studio 내장 JBR을 사용하면 빌드됩니다.

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd android
.\gradlew.bat assembleDebug
```

프로젝트 경로에 한글이 포함되어 있어 `android/gradle.properties`에 아래 옵션을 추가했습니다.

```properties
android.overridePathCheck=true
```

## 자주 쓰는 명령

디버그 APK 한 번에 빌드:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-android-debug.ps1
```

업로드 키 생성:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\create-android-upload-key.ps1
```

Play Console 업로드용 릴리즈 AAB 빌드:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-android-release.ps1
```

웹 번들 동기화:

```bash
npm run mobile:sync
```

Android Studio로 열기:

```bash
npm run mobile:open
```

디버그 APK 빌드:

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd android
.\gradlew.bat assembleDebug
```

## 출시 전 체크리스트

- 실제 Android 기기에서 입력, 변환, 복사, 다크모드 테스트
- 앱 아이콘과 스플래시 화면 최종 확인
- 개인정보처리방침 URL 확인
- AdMob 적용 여부 결정
- 하루 무료 사용량 정책 결정
- Play Console 개발자 계정 준비
- 내부 테스트 트랙 업로드
- 릴리스용 업로드 키 백업
- 실제 AdMob 배너 광고 단위 ID 발급 후 테스트 광고 ID 교체
- AAB 업로드

## 주의

현재는 Capacitor 기반 Android 앱이며 웹과 앱이 동일한 변환 API를 공유합니다. 앱 화면은 공개 웹과 분리되어 있으므로 웹 콘텐츠를 수정해도 앱 전용 사용 흐름이 불필요하게 바뀌지 않습니다.
