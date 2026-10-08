#!/usr/bin/env bash
# Prepara il progetto Android di DF Barbershop in una cartella a parte (.build), senza toccare i file del repository.
# Copia l'app, installa le librerie Expo nelle versioni giuste per l'SDK, genera il progetto nativo e imposta numero di build.
set -euo pipefail

BUILD_NUMBER="${1:-1}"
ROOT="$PWD"
B="$ROOT/.build"

rm -rf "$B"
mkdir -p "$B"
cp -r App.tsx app.json assets lib "$B/"
cp .github/android/index.ts .github/android/package.json "$B/"
cd "$B"

export EXPO_NO_TELEMETRY=1
export CI=1

npm install
# expo install sceglie per ogni libreria la versione compatibile con l'SDK di Expo
npx expo install react react-native expo-constants expo-device expo-notifications expo-image-picker \
  expo-linear-gradient expo-blur expo-status-bar expo-font expo-splash-screen expo-system-ui \
  @expo/vector-icons react-native-safe-area-context @react-native-async-storage/async-storage \
  react-native-url-polyfill @supabase/supabase-js

npx expo prebuild --platform android --no-install --clean

GRADLE="android/app/build.gradle"
VERSION="$(node -p "require('./app.json').expo.version")"
# Il numero di build deve crescere a ogni versione, altrimenti Android rifiuta l'aggiornamento
sed -i -E "s/versionCode[ =]+[0-9]+/versionCode ${BUILD_NUMBER}/; s/versionName[ =]+\"[^\"]*\"/versionName \"${VERSION}\"/" "$GRADLE"
if ! grep -q "versionCode ${BUILD_NUMBER}" "$GRADLE"; then
  echo "::warning::Non sono riuscito a impostare il numero di build in ${GRADLE}"
fi
echo "DF Barbershop ${VERSION} (build ${BUILD_NUMBER}) pronta per Gradle"
