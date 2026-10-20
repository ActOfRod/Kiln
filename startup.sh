#!/bin/sh
set -eu
cd "$(dirname "$0")"
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
if [ -d /proc ]; then
  node scripts/preview.mjs stop || true
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
if [ "${KILN_FOREGROUND:-0}" = "1" ]; then
  exec npm run dev
fi
mkdir -p .grok
npm run dev >>.grok/startup.log 2>&1 &
