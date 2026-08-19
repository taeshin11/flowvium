#!/usr/bin/env python3
"""embed_server.py — bge-m3 임베딩 HTTP 서비스.

계약(변경 금지): POST /embed {"texts":[...]} -> {"embeddings":[[...]], "dim":N}
  · 소비자는 node 측 src/lib/rag.ts:60 (EMBED_URL, 기본 http://127.0.0.1:8100/embed).
  · data/rag/corpus.ndjson 은 BAAI/bge-m3 · 1024차원 · normalize_embeddings=True 로 색인돼 있다.
    모델/정규화/차원을 바꾸면 코퍼스와 벡터공간이 어긋나 재색인(ingest-corpus.py)이 필수다.
    → 기본값을 바꾸지 말 것. 바꾸려면 재색인까지 같이 할 것.

설정은 전부 환경변수. 경로·호스트·포트를 코드에 박지 않는다.
  EMBED_MODEL   기본 BAAI/bge-m3
  EMBED_DEVICE  기본 auto (mps > cuda > cpu). 명시 지정 가능
  EMBED_BATCH   기본 16
"""
import os
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
BATCH = int(os.environ.get("EMBED_BATCH", "16"))


def _resolve_device() -> str:
    want = os.environ.get("EMBED_DEVICE", "auto").lower()
    if want != "auto":
        return want
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


DEVICE = _resolve_device()
app = FastAPI()
_model = SentenceTransformer(MODEL, device=DEVICE)
_DIM = _model.get_sentence_embedding_dimension()


class Req(BaseModel):
    texts: list[str]


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "device": DEVICE, "dim": _DIM}


@app.post("/embed")
def embed(req: Req):
    if not req.texts:
        # 빈 입력은 오류가 아니라 빈 결과. dim 은 계속 알려 준다(소비자가 차원 검증에 쓴다).
        return {"embeddings": [], "dim": _DIM}
    embs = _model.encode(req.texts, normalize_embeddings=True, batch_size=BATCH)
    return {"embeddings": [[float(x) for x in e] for e in embs], "dim": len(embs[0])}
