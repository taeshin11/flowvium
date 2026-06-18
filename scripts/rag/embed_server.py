#!/usr/bin/env python3
"""embed-server.py — bge-m3 임베딩 HTTP 서비스 (2026-06-18)
POST /embed {"texts":[...]} -> {"embeddings":[[...]], "dim":1024}
GPU 는 vLLM 점유 → CPU. 질문 1건 임베딩이라 수백 ms. node(judge-engine rag.ts)가 EMBED_URL 로 호출.
"""
import os
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
app = FastAPI()
_model = SentenceTransformer(MODEL)

class Req(BaseModel):
    texts: list[str]

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "dim": _model.get_sentence_embedding_dimension()}

@app.post("/embed")
def embed(req: Req):
    embs = _model.encode(req.texts, normalize_embeddings=True, batch_size=16)
    return {"embeddings": [[float(x) for x in e] for e in embs], "dim": len(embs[0]) if len(embs) else 0}
