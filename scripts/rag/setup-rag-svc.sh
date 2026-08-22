#!/usr/bin/env bash
# setup-rag-svc.sh — 임베딩 서비스 의존성 설치 (macOS / Apple Silicon).
#
# 원본은 WSL 전용이었다(apt-get, torch CPU wheel index, ~/rag-svc 고정). 맥에서는 전부 무효라 다시 썼다.
#   EMBED_VENV  기본 $HOME/rag-venv
#   PY_VERSION  기본 3.12
# sudo 를 쓰지 않는다. uv 가 있으면 uv, 없으면 python3 -m venv 로 떨어진다.
set -euo pipefail
LOG() { echo "[setup-rag $(date +%H:%M:%S)] $*"; }

VENV="${EMBED_VENV:-$HOME/rag-venv}"
PYV="${PY_VERSION:-3.12}"

if command -v uv >/dev/null 2>&1; then
  LOG "uv 로 venv 생성: $VENV (python $PYV)"
  uv venv "$VENV" --python "$PYV"
  PIP=(uv pip install --python "$VENV/bin/python")
else
  LOG "python3 -m venv: $VENV"
  python3 -m venv "$VENV"
  PIP=("$VENV/bin/pip" install -q)
fi

# sentencepiece·protobuf 는 선택이 아니다. 없으면 bge-m3 토크나이저가
# "Unrecognized processing class" 로 로드 실패한다(2026-07-06 실증, 원본 스크립트 20~21행 기록).
LOG "의존성 설치 (torch/sentence-transformers/fastapi/uvicorn + sentencepiece·protobuf)"
"${PIP[@]}" torch sentence-transformers fastapi "uvicorn[standard]" sentencepiece protobuf

LOG "bge-m3 워밍업 (최초 다운로드 ~2GB)"
"$VENV/bin/python" - <<'PY'
import os
from sentence_transformers import SentenceTransformer
dev = "cpu"
try:
    import torch
    if torch.backends.mps.is_available(): dev = "mps"
    elif torch.cuda.is_available(): dev = "cuda"
except Exception:
    pass
m = SentenceTransformer(os.environ.get("EMBED_MODEL", "BAAI/bge-m3"), device=dev)
v = m.encode(["워밍업 문장"], normalize_embeddings=True)
print(f"[setup-rag] bge-m3 ready device={dev} dim={len(v[0])}")
PY
LOG "DONE"
