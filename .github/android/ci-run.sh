#!/usr/bin/env bash
# Esegue un comando e, se fallisce, scrive le ultime righe dell'output come errore in evidenza
# nella pagina della build (così il motivo si legge senza aprire il registro completo).
set -uo pipefail

LOG="$(mktemp)"
"$@" 2>&1 | tee "$LOG"
code="${PIPESTATUS[0]}"

if [ "$code" -ne 0 ]; then
  tail -n 40 "$LOG" | sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | python3 -c "
import sys
t = sys.stdin.read()
print('::error title=Comando fallito::' + t.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A'))
"
fi
exit "$code"
