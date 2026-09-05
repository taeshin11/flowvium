#!/bin/bash
# 다음 발행 슬롯이 실제로 나갔는지 지켜본다.
#   왜 필요한가(2026-09-05): 감시기는 20분마다 결함을 찍고 있었는데 조치하는 손이 없어
#   정오 보고서가 통째로 날아갔다. 자가치유를 붙였지만 **처음 몇 회차는 눈으로 확인해야** 한다.
# 사용: bash scripts/slot-watch.sh <HH:MM> [마감유예분]
set -u
SLOT="${1:?슬롯 시각(HH:MM)}"
GRACE="${2:-12}"
VLOG=/Users/spinai-mini/flowvium_runtime/video.log
OUT=logs/slot-watch.log
: > "$OUT"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT"; }

target=$(date -j -f "%Y-%m-%d %H:%M" "$(date +%Y-%m-%d) $SLOT" +%s 2>/dev/null) || exit 1
deadline=$(( target + GRACE * 60 ))
say "슬롯 $SLOT 감시 시작 (마감 $(date -r $deadline +%H:%M))"

# 슬롯 시각까지 기다린다
while [ "$(date +%s)" -lt "$target" ]; do sleep 30; done
say "슬롯 시각 도달 — 결과를 기다린다"

while [ "$(date +%s)" -lt "$deadline" ]; do
  line=$(grep "$(date +%Y-%m-%d) $SLOT" -A40 "$VLOG" 2>/dev/null | grep -m1 -E "✅ https|건너뜀|❌")
  if [ -n "$line" ]; then
    say "결과: $line"
    grep "$(date +%Y-%m-%d) $SLOT" -A40 "$VLOG" 2>/dev/null | grep -E "\[이슈\]|\[화면\] [0-9]" | head -8 >> "$OUT"
    exit 0
  fi
  sleep 30
done
say "⚠ 마감까지 결과 없음 — video.log 확인 필요"
tail -20 "$VLOG" >> "$OUT"
exit 2
