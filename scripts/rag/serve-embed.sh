#!/usr/bin/env bash
# serve-embed.sh — bge-m3 임베딩 서비스 기동.
#
# 경로를 박지 않는다. 스크립트 위치에서 자기 디렉터리를 유도하고, 나머지는 환경변수로 덮는다.
#   EMBED_VENV  기본 $HOME/rag-venv     (python 이 있는 venv)
#   EMBED_HOST  기본 127.0.0.1          (로컬 전용. 외부 노출하려면 0.0.0.0)
#   EMBED_PORT  기본 8100               (src/lib/rag.ts 의 EMBED_URL 기본값과 일치)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${EMBED_VENV:-$HOME/rag-venv}"
HOST="${EMBED_HOST:-127.0.0.1}"
PORT="${EMBED_PORT:-8100}"

if [ ! -x "$VENV/bin/uvicorn" ]; then
  echo "serve-embed: uvicorn 없음 — $VENV. setup-rag-svc.sh 를 먼저 실행하라." >&2
  exit 1
fi

cd "$HERE"
exec "$VENV/bin/uvicorn" embed_server:app --host "$HOST" --port "$PORT" --workers 1
