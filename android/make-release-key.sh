#!/usr/bin/env bash
# JARVIS release imzalama açarı — yalnız bir dəfə işə salınır.
# Açar və şifrə android/keystore/ qovluğunda saxlanılır və .gitignore ilə repodan kənardadır.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
KEYDIR="$ROOT/keystore"
KS="$KEYDIR/jarvis-release.jks"
PROPS="$KEYDIR/signing.properties"

JAVA_HOME="${JAVA_HOME:-/tmp/jdk}"
export PATH="$JAVA_HOME/bin:$PATH"

if [ -f "$KS" ] && [ -f "$PROPS" ]; then
  echo "Artıq mövcuddur: $KS"
  echo "Yenidən yaratmaq üçün əvvəlcə həmin faylları silin (köhnə imza ilə buraxılmış APK yenilənməyəcək)."
  exit 0
fi

command -v keytool >/dev/null || { echo "keytool tapılmadı (JDK lazımdır)" >&2; exit 1; }

mkdir -p "$KEYDIR"
chmod 700 "$KEYDIR"

# Təsadüfi, yalnız hərf-rəqəmdən ibarət 24 simvollu şifrə.
PASS="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"

keytool -genkeypair \
  -keystore "$KS" \
  -storepass "$PASS" -keypass "$PASS" \
  -alias jarvis \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=JARVIS, O=Personal, C=AZ" >/dev/null

cat > "$PROPS" <<EOF
STORE_FILE=$KS
STORE_PASSWORD=$PASS
KEY_ALIAS=jarvis
KEY_PASSWORD=$PASS
EOF

chmod 600 "$KS" "$PROPS"

echo "Release açarı yaradıldı."
echo "  keystore: $KS"
echo "  şifrə faylı: $PROPS (600 icazə, git-ə düşmür)"
echo
echo "VACİB: bu iki faylı təhlükəsiz yerə (menecerinizə) köçürün."
echo "İtsə, eyni imza ilə yeni versiya buraxa bilməyəcəksiniz."
