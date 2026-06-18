#!/usr/bin/env bash
# AITS_FINANCE_T — Qwen3-30B-A3B 에 QLoRA 학습 (vLLM 정지 윈도우에서 실행).
# 선행: scripts/sft/prep-base.sh 완료(venv+베이스), data/sft/aits-finance-t.jsonl 생성(build-sft-dataset.mjs).
# 주의: vLLM 가 GPU 24GB 점유 → 실행 전 'schtasks /end' 또는 WSL vLLM 정지 필수. 학습 후 재기동.
set -e
VENV="$HOME/aits-train"; source "$VENV/bin/activate"
pip install -q -U "transformers>=4.44" peft trl datasets bitsandbytes accelerate
DATA="/mnt/d/Flowvium/data/sft/aits-finance-t.jsonl"
OUT="$HOME/aits-finance-t-lora"
python - <<'PY'
import json, torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig
BASE="Qwen/Qwen3-30B-A3B-Instruct-2507"
tok=AutoTokenizer.from_pretrained(BASE)
bnb=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
model=AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, device_map="auto", trust_remote_code=True)
lora=LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"], task_type="CAUSAL_LM")
ds=load_dataset("json", data_files="/mnt/d/Flowvium/data/sft/aits-finance-t.jsonl", split="train")
def fmt(ex): return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds=ds.map(fmt)
cfg=SFTConfig(output_dir="$HOME/aits-finance-t-lora", per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=3, learning_rate=1e-4, bf16=True, gradient_checkpointing=True, logging_steps=10,
    save_strategy="epoch", max_seq_length=2048, packing=False)
tr=SFTTrainer(model=get_peft_model(model,lora), train_dataset=ds, args=cfg)
tr.train(); tr.save_model("$HOME/aits-finance-t-lora")
print("LoRA saved")
PY
echo "[train] done → merge & vLLM serve as AITS_FINANCE_T (다음 단계)"
