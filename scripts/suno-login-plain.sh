#!/bin/bash
# suno-login-plain.sh — Suno 로그인용 크롬을 **자동화 없이** 띄운다.
#
# 왜 (2026-09-08 사용자 "로그인중에 자꾸 첫화면으로 돌아간다"):
#   Playwright 로 띄운 창은 CDP 가 붙어 있어 구글이 "안전하지 않은 브라우저"로 보고
#   로그인을 되돌려 보낸다. 프로필은 같고 브라우저만 평범하게 띄우면 통과한다.
#   로그인이 끝나면 그 프로필에 세션이 남고, 이후 Playwright 가 그대로 쓴다.
PROFILE="$(cd "$(dirname "$0")/.." && pwd)/secrets/suno-profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "크롬을 못 찾았다: $CHROME"; exit 1; }
echo "프로필: $PROFILE"
echo "이 창에서 taeshinkim11 구글 계정으로 로그인해 주세요."
echo "끝나면 창을 닫으셔도 됩니다 — 세션은 프로필에 남습니다."
"$CHROME" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check \
  "https://suno.com/" >/dev/null 2>&1 &
echo "창을 띄웠습니다 (PID $!)"
