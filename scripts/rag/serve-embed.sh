#!/usr/bin/env bash
# serve-embed.sh — bge-m3 임베딩 서비스 기동 (WSL). Windows 스케줄러 FlowVium-Embed 가 로그온 시 호출.
# vLLM(:8000, GPU) 와 별개. 임베딩은 CPU :8100. node(rag.ts)가 EMBED_URL=http://127.0.0.1:8100/embed.
source ~/rag-svc/bin/activate
# 2026-07-06: C: 이관 후 경로 정정 (/mnt/d → /mnt/c). 구머신 D:\Flowvium 참조가 신규머신에서 기동 실패 근원.
cd /mnt/c/Flowvium/scripts/rag
exec uvicorn embed_server:app --host 0.0.0.0 --port 8100 --workers 1
