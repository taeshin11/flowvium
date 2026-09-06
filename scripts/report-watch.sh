#!/bin/bash
# 보고서 생성이 끝났는지, DB 에 실제로 적재됐는지 지켜본다.
#   "생성 시작" 로그만 보고 됐다고 말하지 않는다 — 오늘 정오는 시작도 못 했다.
set -u
LOG="${1:?로그 경로}"
MAXMIN="${2:-120}"
OUT=logs/report-watch.log
: > "$OUT"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT"; }
deadline=$(( $(date +%s) + MAXMIN * 60 ))
say "보고서 감시 시작 (상한 ${MAXMIN}분)"
while [ "$(date +%s)" -lt "$deadline" ]; do
  if grep -qE "\[SUCCESS\]|\[ERROR\]" "$LOG" 2>/dev/null; then
    say "결과: $(grep -E '\[SUCCESS\]|\[ERROR\]' "$LOG" | tail -1)"
    node -e '
    import("./scripts/lib/db.mjs").then(m=>{
      const d=m.openDb();
      const r=d.prepare("SELECT session,generated_at FROM reports ORDER BY generated_at DESC LIMIT 2").all();
      for(const x of r) console.log("  DB:",x.session,new Date(x.generated_at).toLocaleString("sv-SE",{timeZone:"Asia/Seoul"}).slice(5,16));
    });' >> "$OUT" 2>&1
    exit 0
  fi
  pgrep -f "generate-report-local" >/dev/null || { say "⚠ 생성 프로세스가 사라졌는데 결과 줄이 없다"; tail -8 "$LOG" >> "$OUT"; exit 2; }
  sleep 60
done
say "⚠ ${MAXMIN}분 초과 — 멈춤 의심"
exit 3
