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
    code=$(curl -s -A "$UA" --max-time 30 -o "$out" -w "%{http_code}" "$url" || echo "000")
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
