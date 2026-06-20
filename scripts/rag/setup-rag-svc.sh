#!/usr/bin/env bash
# setup-rag-svc.sh — 심판엔진 AISVI+RAG 로컬 인프라 (2026-06-18)
#   ① 임베딩 서비스 venv (sentence-transformers + bge-m3, CPU) + FastAPI
#   ② PaddleOCR (사용자 선호) + poppler-utils(pdftotext, 텍스트레이어 PDF 우선)
# GPU 는 vLLM(30B) 점유 → 임베딩/OCR 은 CPU. 단발 질문이라 수용가능.
set -e
LOG() { echo "[setup-rag $(date +%H:%M:%S)] $*"; }

VENV=~/rag-svc
LOG "venv $VENV"
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install -q --upgrade pip

LOG "apt poppler-utils (pdftotext/pdfinfo)"
apt-get install -y -q poppler-utils >/dev/null 2>&1 || LOG "apt poppler failed (continue)"

LOG "torch CPU + sentence-transformers (bge-m3 임베딩)"
pip install -q torch --index-url https://download.pytorch.org/whl/cpu
pip install -q sentence-transformers fastapi "uvicorn[standard]" pdf2image

LOG "PaddleOCR (이미지/스캔 PDF fallback)"
pip install -q paddlepaddle || LOG "paddlepaddle install failed (OCR fallback disabled, pdftotext still works)"
pip install -q paddleocr || LOG "paddleocr install failed"

LOG "warm bge-m3 (최초 다운로드 ~2GB)"
python3 - <<'PY'
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('BAAI/bge-m3')
v = m.encode(['워밍업 문장'])
print('[setup-rag] bge-m3 ready dim=', len(v[0]))
PY
LOG "DONE"
