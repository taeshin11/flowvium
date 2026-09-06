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

# 2026-09-05: 처음엔 tail 로 봤다가 **예전 회차의 완료 줄**을 이번 결과로 착각해 즉시 끝났다.
#   이번 슬롯이 찍은 줄 이후만 본다.
# 그리고 보고서와 GPU 가 겹치면 최대 75분 대기한다("보고서 파이프라인이 도는 중").
#   그건 고장이 아니라 설계다 — 대기 중이면 마감을 늘린다.
while [ "$(date +%s)" -lt "$deadline" ]; do
  if awk "/$(date +%Y-%m-%d) $SLOT/,0" "$VLOG" 2>/dev/null | grep -q "보고서 파이프라인이 도는 중"; then
    if [ "$deadline" -lt $(( target + 80 * 60 )) ]; then
      deadline=$(( target + 80 * 60 ))
      say "GPU 경합으로 대기 중 — 마감을 $(date -r $deadline +%H:%M) 로 늘린다(설계된 대기, 고장 아님)"
    fi
  fi
  line=$(awk "/$(date +%Y-%m-%d) $SLOT/,0" "$VLOG" 2>/dev/null | grep -m1 -E "✅ https|건너뜀 —|❌ ")
  if [ -n "$line" ]; then
    say "결과: $line"
    awk "/$(date +%Y-%m-%d) $SLOT/,0" "$VLOG" 2>/dev/null | grep -E "\[이슈\]|\[화면\] [0-9]" | head -8 >> "$OUT"
    exit 0
  fi
  sleep 30
done
say "⚠ 마감까지 결과 없음 — video.log 확인 필요"
tail -20 "$VLOG" >> "$OUT"
exit 2
