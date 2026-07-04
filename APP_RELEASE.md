# 회사어 번역기 앱 출시 준비

## 현재 상태

- Capacitor Android 프로젝트가 `android/`에 생성되어 있습니다.
- 웹 번들은 `npm run mobile:prepare`로 `mobile-web/`에 생성됩니다.
- 앱에서는 `https://office-tone-converter.vercel.app/api/convert`를 호출합니다.
- Android 패키지명은 `ai.its.office.toneconverter`입니다.
- 앱 이름은 `회사어 번역기`입니다.
- Google Play 등록 정보 초안은 `store-assets/play-store-listing-ko.md`에 있습니다.
- 데이터 보안 답변 초안은 `store-assets/data-safety-ko.md`에 있습니다.
- 스크린샷 제작 계획은 `store-assets/screenshot-plan-ko.md`에 있습니다.

## 로컬 빌드 결과

디버그 APK 빌드는 성공했습니다.

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

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
- 릴리스용 서명 키 생성 후 AAB 빌드

## 주의

현재는 웹앱을 Capacitor로 감싼 MVP 형태입니다. 첫 버전은 Android부터 출시하고, 반응을 본 뒤 공유하기, 클립보드, 즐겨찾기, AdMob 보상형 광고 같은 앱 전용 기능을 붙이는 방향이 현실적입니다.
