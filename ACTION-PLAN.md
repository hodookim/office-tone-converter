# 회사어 번역기 액션 플랜

## Immediate

1. Deploy the current SEO/PWA/app packaging updates.
2. Confirm these URLs after deployment:
   - `https://office-tone-converter.vercel.app/manifest.webmanifest`
   - `https://office-tone-converter.vercel.app/llms.txt`
   - `https://office-tone-converter.vercel.app/assets/office-tone-icon-nvidia.jpg`
   - `https://office-tone-converter.vercel.app/sitemap.xml`
3. In Google Search Console, request indexing for the homepage again after deployment.

## Quick Wins

1. Install JDK 17 or later and Android Studio.
2. Run `npm run mobile:sync`.
3. Open Android Studio with `npm run mobile:open`.
4. Build a debug APK and install it on a real Android phone.
5. Capture Play Store screenshots from the app flow.

## Strategic

1. Add app-only features before public Play Store release:
   - share-to-app flow
   - clipboard paste helper
   - saved favorite expressions
2. Add AdMob only after the app flow is stable.
3. Keep web AdSense and app AdMob policies separate.
4. Add one new guide article when AdSense review requests more content.

## Maintenance

1. Keep sitemap dates current after meaningful page changes.
2. Rotate generated store images if the brand direction changes.
3. Review data safety answers whenever analytics or ad SDKs are added.
