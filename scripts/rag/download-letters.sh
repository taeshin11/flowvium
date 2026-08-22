#!/usr/bin/env bash
# download-letters.sh — 버크셔 해서웨이 주주서한(공개·무료) 코퍼스 수집 (2026-06-18)
#   1977-1997: {year}.html / 1998-2024: {year}ltr.pdf (연도별 패턴 변동 → 둘 다 시도, 404 skip)
set -e
DIR=~/rag-data/letters
mkdir -p "$DIR"
UA="Mozilla/5.0 (FlowVium RAG ingester)"
got=0
for y in $(seq 1977 2024); do
  for url in "https://www.berkshirehathaway.com/letters/${y}ltr.pdf" "https://www.berkshirehathaway.com/letters/${y}.html"; do
    ext="${url##*.}"
    out="$DIR/${y}.${ext}"
    # --compressed 필수: Sucuri/Cloudproxy 가 Brotli(content-encoding: br)로 응답 → 미지정 시
    #   압축 원본(바이너리)이 저장돼 추출 깨짐(2026-06-18 옛 서한 119청크 garbage 사건).
    code=$(curl -s --compressed -A "$UA" --max-time 30 -o "$out" -w "%{http_code}" "$url" || echo "000")
    if [ "$code" = "200" ] && [ -s "$out" ]; then
      sz=$(stat -c%s "$out")
      echo "[dl] ${y}.${ext} ${sz}B"
      got=$((got+1))
      break
    else
      rm -f "$out"
    fi
  done
done
echo "[dl] total files: $got"
ls -la "$DIR" | tail -5
