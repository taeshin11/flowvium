#!/usr/bin/env bash
LOG=/mnt/d/Flowvium/logs/build-unsloth.log
for i in $(seq 1 60); do
  sleep 15
  if grep -q '\[unsloth\] DONE' "$LOG" 2>/dev/null; then
    echo "=== DONE at ~$((i*15))s ==="; tail -22 "$LOG"; exit 0
  fi
  if grep -qiE 'No matching distribution|ERROR: Could not|ResolutionImpossible|incompatible' "$LOG" 2>/dev/null; then
    echo "=== install 충돌 at ~$((i*15))s ==="; tail -22 "$LOG"; exit 1
  fi
  LAST=$(tail -1 "$LOG" 2>/dev/null | cut -c1-70)
  echo "[$((i*15))s] $LAST"
done
echo "=== timeout ==="; tail -15 "$LOG"
