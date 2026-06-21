#!/usr/bin/env python3
# AISVI LoRA 어댑터를 base 에 merge → bf16 병합모델 저장 (라이브 서빙용, 2026-06-21).
# 실행: /root/aisvi-train/bin/python merge-adapter.py
# device_map=auto 로 24GB GPU + 48GB WSL RAM 에 30B bf16(~60GB) 분산 적재 후 merge.
import glob, torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

snaps = glob.glob("/root/.cache/huggingface/hub/models--Qwen--Qwen3-30B-A3B-Instruct-2507/snapshots/*/")
BASE = snaps[0]
ADAPTER = "/root/aisvi-finance-t-lora"
OUT = "/root/aisvi-finance-t-merged"
print("BASE =", BASE, "\nADAPTER =", ADAPTER, "\nOUT =", OUT, flush=True)

tok = AutoTokenizer.from_pretrained(BASE)
print("base bf16 로딩(GPU23+CPU46=69GB, disk offload 없음 → 버그회피, vLLM down)...", flush=True)
model = AutoModelForCausalLM.from_pretrained(
    BASE, dtype=torch.bfloat16, device_map="auto",
    max_memory={0: "23GiB", "cpu": "46GiB"}, low_cpu_mem_usage=True, trust_remote_code=True)
print("어댑터 적용 + merge...", flush=True)
model = PeftModel.from_pretrained(model, ADAPTER)
model = model.merge_and_unload()
print("병합모델 저장(~60GB, ~15-20분)...", flush=True)
model.save_pretrained(OUT, safe_serialization=True, max_shard_size="5GB")
tok.save_pretrained(OUT)
print("=== merge 완료 ->", OUT, "===", flush=True)
