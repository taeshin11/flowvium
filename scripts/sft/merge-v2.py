#!/usr/bin/env python3
# AISVI_FINANCE_T_2.0.0 — v2 LoRA를 base에 merge (Unsloth save_pretrained_merged, PEFT offload버그 회피).
# load_in_4bit base + LoRA → dequant+merge → merged_16bit 저장(스트리밍, OOM 회피). 이후 AWQ→vLLM.
from unsloth import FastLanguageModel

print("=== v2 LoRA 로드(base+adapter) ===", flush=True)
model, tok = FastLanguageModel.from_pretrained(
    model_name="/root/aisvi-finance-t-v2-lora",   # LoRA dir → Unsloth가 base+adapter 로드
    max_seq_length=2048, load_in_4bit=True, dtype=None,
)
print("=== merge + 16bit 저장 (~61GB 스트리밍, ~20-40분) ===", flush=True)
model.save_pretrained_merged("/root/AISVI_FINANCE_T_2.0.0-merged", tok, save_method="merged_16bit")
print("=== MERGE DONE -> /root/AISVI_FINANCE_T_2.0.0-merged ===", flush=True)
