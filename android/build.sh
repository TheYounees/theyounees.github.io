#!/usr/bin/env bash
# JARVIS APK build — Gradle tələb etmir.
# İstifadə:
#   bash android/build.sh              # release (öz imzanızla)
#   bash android/build.sh debug        # debug imzası ilə sürətli test
# Dəyişənlər: VERSION_CODE, VERSION_NAME, ANDROID_SDK_ROOT, JAVA_HOME
set -euo pipefail

MODE="${1:-release}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$ROOT/.." && pwd)"
SDK="${ANDROID_SDK_ROOT:-/tmp/android}"
JAVA_HOME="${JAVA_HOME:-/tmp/jdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
BUILD="$ROOT/build"
ESBUILD="$ROOT/optimize/node_modules/.bin/esbuild"

VERSION_CODE="${VERSION_CODE:-2}"
VERSION_NAME="${VERSION_NAME:-1.1}"

export PATH="$JAVA_HOME/bin:$PATH"

for f in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$PLATFORM"; do
  if [ ! -e "$f" ]; then
    echo "Çatışmır: $f" >&2
    exit 1
  fi
done

if [ "$MODE" = "release" ]; then
  OUT="$PROJECT/jarvis-release.apk"
  SIGN_PROPS="$ROOT/keystore/signing.properties"
  if [ ! -f "$SIGN_PROPS" ]; then
    echo "Release açarı yoxdur. Əvvəlcə işə salın: bash android/make-release-key.sh" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$SIGN_PROPS"
else
  OUT="$PROJECT/jarvis.apk"
  SIGN_PROPS=""
  DEBUG_KEYSTORE="${JARVIS_KEYSTORE:-/tmp/jarvis-debug.keystore}"
fi

echo "== 1/7 Veb tətbiq kopyalanır =="
rm -rf "$BUILD" "$ROOT/assets"
mkdir -p "$BUILD/obj" "$ROOT/assets/www"
(cd "$PROJECT" && cp -r index.html manifest.webmanifest assets "$ROOT/assets/www/")
# Native qabıqda service worker işləmir — APK-ya salınmır.
rm -f "$ROOT/assets/www/sw.js"

echo "== 2/7 JS/CSS minifikasiyası =="
if [ -x "$ESBUILD" ]; then
  for f in "$ROOT"/assets/www/assets/js/*.js; do
    "$ESBUILD" "$f" --minify --format=esm --legal-comments=none --allow-overwrite --outfile="$f" >/dev/null
  done
  "$ESBUILD" "$ROOT/assets/www/assets/styles.css" --minify --legal-comments=none \
    --allow-overwrite --outfile="$ROOT/assets/www/assets/styles.css" >/dev/null
  echo "   esbuild ilə minifikasiya edildi"
else
  echo "   esbuild tapılmadı — minifikasiya atlanır"
fi

echo "== 3/7 Resurslar =="
"$BT/aapt2" compile --dir "$ROOT/res" -o "$BUILD/res.zip"

echo "== 4/7 APK skeleti =="
"$BT/aapt2" link \
  -o "$BUILD/base.apk" \
  -I "$PLATFORM" \
  --manifest "$ROOT/AndroidManifest.xml" \
  "$BUILD/res.zip" \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  --auto-add-overlay

echo "== 5/7 Java → DEX (optimallaşdırılmış) =="
find "$ROOT/src" -name '*.java' > "$BUILD/sources.txt"
if ! javac -g:none -source 11 -target 11 -encoding UTF-8 -classpath "$PLATFORM" \
    -d "$BUILD/obj" @"$BUILD/sources.txt" > "$BUILD/javac.log" 2>&1; then
  cat "$BUILD/javac.log" >&2
  exit 1
fi
jar cf "$BUILD/classes.jar" -C "$BUILD/obj" .

# R8 varsa (build-tools daxilindədir) kiçiltmə + obfuscation tətbiq olunur.
# Söndürmək üçün: USE_R8=0 bash android/build.sh release
R8_JAR="$BT/lib/d8.jar"
HAS_R8=""
if [ -f "$R8_JAR" ]; then
  unzip -l "$R8_JAR" > "$BUILD/r8check.txt" 2>/dev/null || true
  if grep -q 'com/android/tools/r8/R8.class' "$BUILD/r8check.txt"; then HAS_R8=1; fi
fi

if [ "${USE_R8:-1}" = "1" ] && [ -n "$HAS_R8" ]; then
  java -cp "$R8_JAR" com.android.tools.r8.R8 \
    --release \
    --lib "$PLATFORM" \
    --min-api 26 \
    --pg-conf "$ROOT/proguard-rules.pro" \
    --pg-map-output "$BUILD/mapping.txt" \
    --output "$BUILD" \
    "$BUILD/classes.jar"
  echo "   R8 tətbiq olundu (mapping: android/build/mapping.txt)"
else
  "$BT/d8" --release --lib "$PLATFORM" --min-api 26 --output "$BUILD" "$BUILD/classes.jar"
  echo "   R8 yoxdur — yalnız d8 istifadə olundu"
fi

echo "== 6/7 Paketləmə və imzalama ($MODE) =="
cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
(cd "$BUILD" && zip -q -9 unsigned.apk classes.dex)
(cd "$ROOT" && zip -qr -9 -X "$BUILD/unsigned.apk" assets)
"$BT/zipalign" -f 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

if [ "$MODE" = "release" ]; then
  "$BT/apksigner" sign \
    --ks "$STORE_FILE" \
    --ks-key-alias "$KEY_ALIAS" \
    --ks-pass "pass:$STORE_PASSWORD" \
    --key-pass "pass:$KEY_PASSWORD" \
    --out "$OUT" \
    "$BUILD/aligned.apk"
  "$BT/apksigner" verify --print-certs "$OUT" | head -3
else
  if [ ! -f "$DEBUG_KEYSTORE" ]; then
    keytool -genkeypair \
      -keystore "$DEBUG_KEYSTORE" \
      -storepass android -keypass android \
      -alias androiddebugkey \
      -keyalg RSA -keysize 2048 -validity 10000 \
      -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
  fi
  "$BT/apksigner" sign \
    --ks "$DEBUG_KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --out "$OUT" \
    "$BUILD/aligned.apk"
fi

echo "== 7/7 Yoxlama =="
"$BT/apksigner" verify "$OUT" && echo "   imza etibarlıdır"
"$BT/aapt2" dump badging "$OUT" | grep -E "^package:|application-label:|sdkVersion|targetSdkVersion" || true
echo "   veb fayl sayı: $(unzip -l "$OUT" | grep -c 'assets/www')"
echo "   dex: $(unzip -l "$OUT" | grep 'classes.dex' | awk '{print $1}') bayt"
ls -lh "$OUT"
echo "Hazırdır: $OUT"
