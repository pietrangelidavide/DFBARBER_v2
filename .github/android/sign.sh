#!/usr/bin/env bash
# Firma l'APK di DF Barbershop. La chiave di firma si crea la prima volta e resta nella release privata "chiave-firma":
# serve sempre la stessa chiave, altrimenti Android non permette di aggiornare l'app già installata.
set -euo pipefail

OUT="build-out"
KEYDIR="${RUNNER_TEMP:-/tmp}/chiave"
mkdir -p "$OUT" "$KEYDIR"

UNSIGNED="$(ls .build/android/app/build/outputs/apk/release/*.apk | head -n 1)"
echo "File da firmare: $UNSIGNED"

if gh release download chiave-firma -R "$GITHUB_REPOSITORY" -D "$KEYDIR" -p dfbarber.keystore -p dfbarber.pass 2>/dev/null; then
  echo "Uso la chiave di firma già creata"
else
  echo "Creo la chiave di firma (succede solo la prima volta)"
  PASS="$(openssl rand -hex 16)"
  keytool -genkeypair -keystore "$KEYDIR/dfbarber.keystore" -alias dfbarber -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=DF Barbershop, O=DF Barbershop, C=IT"
  printf '%s' "$PASS" > "$KEYDIR/dfbarber.pass"
  gh release create chiave-firma "$KEYDIR/dfbarber.keystore" "$KEYDIR/dfbarber.pass" -R "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" --prerelease --title "Chiave di firma - non cancellare" \
    --notes "Serve a firmare l'app Android di DF Barbershop. Se la cancelli, per installare gli aggiornamenti dovrai prima disinstallare l'app."
fi

PASS="$(cat "$KEYDIR/dfbarber.pass")"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -n 1)"
echo "Strumenti di firma: $BT"

# Gradle firma già l'APK con la chiave di prova: tolgo quella firma e metto la nostra
cp "$UNSIGNED" "$OUT/da-firmare.apk"
zip -q -d "$OUT/da-firmare.apk" 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/*.DSA' 'META-INF/*.EC' 'META-INF/MANIFEST.MF' || true

"$BT/zipalign" -p -f 4 "$OUT/da-firmare.apk" "$OUT/allineato.apk"
"$BT/apksigner" sign --ks "$KEYDIR/dfbarber.keystore" --ks-key-alias dfbarber --ks-pass "pass:$PASS" --key-pass "pass:$PASS" \
  --out "$OUT/DFBarbershop.apk" "$OUT/allineato.apk"
rm -f "$OUT/da-firmare.apk" "$OUT/allineato.apk" "$OUT"/*.idsig
"$BT/apksigner" verify --print-certs "$OUT/DFBarbershop.apk" | head -n 3
ls -la "$OUT"
