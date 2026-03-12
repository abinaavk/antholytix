# SpectraSense – Android App

Food freshness detection via anthocyanin pH color indicator analysis.
Backend: https://antholytix.gaiasentinel.online

## Android Studio Setup

1. File → Open → select this SpectraSense folder
2. Let Gradle sync and download dependencies

## Google Sign-In (Required)

1. Go to https://console.cloud.google.com
2. Create OAuth 2.0 credentials:
   - Android client ID (needs your SHA-1 debug key)
   - Web client ID (needed for backend verification)
3. Get SHA-1:
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
4. Replace YOUR_WEB_CLIENT_ID_HERE in res/values/strings.xml
5. Download google-services.json → place in app/ folder
6. In app/build.gradle, add at top:
   id 'com.google.gms.google-services'
7. In build.gradle (project), add:
   id 'com.google.gms.google-services' version '4.4.0' apply false

## Build APK

Build → Build Bundle(s)/APK(s) → Build APK(s)
Output: app/build/outputs/apk/debug/app-debug.apk

## Flask Backend

cd flask_backend
pip install -r requirements.txt
export SECRET_KEY="your-secret"
export SMTP_USER="your@gmail.com"
export SMTP_PASS="your-app-password"   # Gmail App Password, not regular password
export GOOGLE_CLIENT_ID="your-web-client-id"
python app.py

## Anthocyanin Color Classification

| Indicator Color | pH Range | Freshness |
|-----------------|----------|-----------|
| Red / Pink      | 1 – 4    | FRESH     |
| Purple          | 5 – 6    | FRESH     |
| Blue            | 7 – 8    | CAUTION   |
| Green           | 9 – 10   | SPOILED   |
| Yellow          | 11+      | SPOILED   |
