#!/usr/bin/env bash
# Poll build-venv.log until DONE/error, up to ~14min.
LOG=/mnt/d/Flowvium/logs/build-venv.log
for i in $(seq 1 56); do
  sleep 15
  if grep -q '\[build\] DONE' "$LOG" 2>/dev/null; then
    echo "=== BUILD DONE at ~$((i*15))s ==="; tail -10 "$LOG"; exit 0
  fi
  if grep -qiE 'ERROR|No matching distribution|could not|failed' "$LOG" 2>/dev/null; then
    echo "=== BUILD ERROR at ~$((i*15))s ==="; tail -15 "$LOG"; exit 1
  fi
  LAST=$(tail -1 "$LOG" 2>/dev/null | cut -c1-60)
  echo "[$((i*15))s] $LAST"
done
echo "=== timeout, tail ==="; tail -8 "$LOG"
