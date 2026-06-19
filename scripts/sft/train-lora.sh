#!/usr/bin/env bash
# AITS_FINANCE_T — Qwen3-30B-A3B 에 QLoRA 학습 (vLLM 정지 윈도우에서 실행).
# 선행: scripts/sft/prep-base.sh 완료(venv+베이스), data/sft/aits-finance-t.jsonl 생성(build-sft-dataset.mjs).
# 주의: vLLM 가 GPU 24GB 점유 → 실행 전 'schtasks /end' 또는 WSL vLLM 정지 필수. 학습 후 재기동.
set -e
VENV="$HOME/aits-train"; source "$VENV/bin/activate"
pip install -q -U "transformers>=4.44" peft trl datasets bitsandbytes accelerate
DATA="/mnt/d/Flowvium/data/sft/aits-finance-t.jsonl"
OUT="$HOME/aits-finance-t-lora"

# 2026-06-19: vLLM 정지 후 GPU 메모리가 *실제로* 해제될 때까지 대기. 12s sleep 으론 부족해 train 로드 시
#   GPU 가 아직 점유돼 device_map 이 일부 expert 를 CPU 로 dispatch → bnb 4bit 거부(exit 1) 하던 원인 중 하나.
echo "[train] GPU 해제 대기 (vLLM 종료 후)..."
for i in $(seq 1 30); do
  USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  if [ -n "$USED" ] && [ "$USED" -lt 3000 ]; then echo "[train] GPU 해제됨 (${USED}MiB free-ish)"; break; fi
  echo "[train] GPU ${USED:-?}MiB 점유 중 — 대기 ${i}/30"; sleep 4
done
python - <<'PY'
import os, json, torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig
BASE="Qwen/Qwen3-30B-A3B-Instruct-2507"
tok=AutoTokenizer.from_pretrained(BASE)
bnb=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
# device_map={"":0}: 전체를 GPU0 에 강제(자동 CPU offload 금지) — QLoRA 30B 4bit(~16GB) 는 24GB 에 적재 가능.
#   "auto" 는 학습 헤드룸을 보수적으로 잡아 일부 expert 를 CPU 로 보내 bnb 4bit 가 거부하던 원인.
model=AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, device_map={"": 0}, trust_remote_code=True)
lora=LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"], task_type="CAUSAL_LM")
ds=load_dataset("json", data_files="/mnt/d/Flowvium/data/sft/aits-finance-t.jsonl", split="train")
def fmt(ex): return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds=ds.map(fmt)
OUT=os.path.expanduser("~/aits-finance-t-lora")   # quoted heredoc 라 bash $HOME 미확장 → python 에서 해석(기존 버그)
cfg=SFTConfig(output_dir=OUT, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=3, learning_rate=1e-4, bf16=True, gradient_checkpointing=True, logging_steps=10,
    save_strategy="epoch", max_seq_length=2048, packing=False)
tr=SFTTrainer(model=get_peft_model(model,lora), train_dataset=ds, args=cfg)
tr.train(); tr.save_model(OUT)
print("LoRA saved ->", OUT)
PY
echo "[train] done → merge & vLLM serve as AITS_FINANCE_T (다음 단계)"
