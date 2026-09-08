#!/bin/bash
# suno-open.sh — Suno 작업용 크롬을 띄운다. **자동화가 붙지 않은 평범한 크롬**이되
#   디버깅 포트를 열어 두어, 나중에 스크립트가 그 창에 그대로 붙는다.
#
# 왜 이렇게 하나 (2026-09-08):
#   ① Playwright 가 띄운 창은 구글이 "안전하지 않은 브라우저"로 보고 로그인을 되돌려 보낸다.
#   ② 평범한 크롬으로 로그인하면 되지만, 그 프로필을 나중에 Playwright 가 다시 열면
#      쿠키를 못 읽는다 — 크롬이 키체인 키로 암호화해 두기 때문이다.
#   그래서 **같은 브라우저 프로세스에 붙는다.** 로그인한 그 창을 그대로 쓴다.
# 2026-09-08: 포트를 9222 에서 9333 으로 옮겼다.
#   **9222 는 Flow 자동화(~/.pni-chrome-flow)가 쓰는 포트**다.
#   내가 먼저 잡는 바람에, 그쪽이 자기 프로필인 줄 알고 붙었다가
#   내 창(다른 구글 계정으로 로그인된)을 잡아 작업이 막혔다.
#   같은 기계에서 여러 자동화가 도는 이상, 포트는 겹치지 않게 잡아야 한다.
PROFILE="$(cd "$(dirname "$0")/.." && pwd)/secrets/suno-profile"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT="${SUNO_CDP_PORT:-9333}"
[ -x "$CHROME" ] || { echo "크롬을 못 찾았다: $CHROME"; exit 1; }
if lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "이미 :$PORT 에 크롬이 떠 있습니다 — 그 창을 씁니다."; exit 0
fi
echo "프로필: $PROFILE · 디버깅 포트 :$PORT"
echo "창이 뜨면 suno.com 에 로그인해 주세요. **창은 닫지 마세요** — 이 창에 붙어서 작업합니다."
"$CHROME" --user-data-dir="$PROFILE" --remote-debugging-port=$PORT \
  --no-first-run --no-default-browser-check "https://suno.com/" >/dev/null 2>&1 &
sleep 4
lsof -nP -iTCP:$PORT -sTCP:LISTEN -t >/dev/null 2>&1 && echo "  준비됨 (PID $!)" || echo "  ⚠ 포트가 안 열렸습니다"
