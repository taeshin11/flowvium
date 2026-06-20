#!/usr/bin/env bash
# AISVI_FINANCE_T — Qwen3-30B-A3B QLoRA via Unsloth (24GB 단일 GPU 메모리 최적).
# 2026-06-20: standard transformers+peft+bnb 는 24GB VRAM 포화로 util 0% 페이징(~46h, 비실용).
#   Unsloth(venv aisvi-unsloth, torch2.10+cu128)는 prequant 4bit 직접로드 + MoE-aware + 메모리 최적으로
#   30B 을 24GB 에 학습 여유 있게 적재 목표. import 순서: unsloth 먼저(transformers/trl 패치).
# 주의: vLLM GPU 점유 → 실행 전 정지 필수. 학습 후 재기동.
set -e
VENV="$HOME/aisvi-unsloth"
if [ ! -f "$VENV/bin/activate" ]; then echo "[unsloth] FATAL: $VENV 없음 — build-unsloth-venv.sh 먼저"; exit 1; fi
source "$VENV/bin/activate"
export HF_HUB_ENABLE_HF_TRANSFER=1
DATA="/mnt/d/Flowvium/data/sft/aisvi-finance-t.jsonl"
OUT="$HOME/aisvi-finance-t-lora"
# 2026-06-20: Unsloth 는 "Qwen/..." 를 자체 repo(unsloth/qwen3-30b)로 remap→재다운로드(60G) 한다.
#   로컬 Qwen/ 캐시 스냅샷을 *경로로 직접* 지정해 remap·재다운로드 회피(이미 받은 57G bf16 재사용).
BASE=$(ls -d "$HOME"/.cache/huggingface/hub/models--Qwen--Qwen3-30B-A3B-Instruct-2507/snapshots/*/ 2>/dev/null | head -1)
[ -z "$BASE" ] && BASE="Qwen/Qwen3-30B-A3B-Instruct-2507"   # 캐시 없으면 hub fallback
echo "[unsloth] BASE=$BASE"

echo "[unsloth] GPU 해제 대기 (vLLM 종료 후)..."
for i in $(seq 1 30); do
  USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  if [ -n "$USED" ] && [ "$USED" -lt 3000 ]; then echo "[unsloth] GPU 해제됨 (${USED}MiB)"; break; fi
  echo "[unsloth] GPU ${USED:-?}MiB 점유 중 — 대기 ${i}/30"; sleep 4
done

PYTHONUNBUFFERED=1 BASE="$BASE" OUT="$OUT" DATA="$DATA" python - <<'PY'
import os
from unsloth import FastLanguageModel   # 반드시 최초 import (transformers/trl 패치)
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
OUT=os.environ["OUT"]; DATA=os.environ["DATA"]; BASE=os.environ["BASE"]
MAXLEN=320   # 데이터 max=293 토큰 → 320 이면 무손실 + NEFTune/fused-CE 헤드룸 확보(384보다 활성화 메모리↓).
# 로컬 캐시된 bf16 base 사용(unsloth 4bit repo ~16GB 다운로드 회피 — Qwen/ 는 aisvi-train 런에서 캐시됨).
#   Unsloth 가 on-the-fly 4bit 양자화(메모리 최적 경로). 다운로드 후 unsloth/ prequant 로 전환 가능.
model, tok = FastLanguageModel.from_pretrained(
    model_name=BASE,   # 로컬 Qwen/ 스냅샷 경로(remap·재다운로드 회피) 또는 hub fallback
    max_seq_length=MAXLEN, load_in_4bit=True, dtype=None,
)
# 2026-06-20: r=16(642M trainable). r=32 는 24GB 초과(Unsloth fused CE "no GPU memory"). dropout 0=Unsloth 최적.
#   품질강화는 메모리 거의 안 드는 cosine/warmup/NEFTune/weight_decay 로(아래 SFTConfig).
model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=32, lora_dropout=0,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    use_gradient_checkpointing="unsloth", random_state=42,
)
ds=load_dataset("json", data_files=DATA, split="train")
def fmt(ex): return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds=ds.map(fmt)
# 품질: cosine 스케줄 + warmup(수렴) + NEFTune(neftune_noise_alpha=5, instruction tuning 정확도↑) + weight_decay.
cfg=SFTConfig(output_dir=OUT, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=3, learning_rate=1e-4, bf16=True, logging_steps=1,
    lr_scheduler_type="cosine", warmup_ratio=0.05, weight_decay=0.01, neftune_noise_alpha=5,
    optim="adamw_8bit", save_strategy="epoch", max_length=MAXLEN, packing=False)
tr=SFTTrainer(model=model, train_dataset=ds, args=cfg)
tr.train(); tr.save_model(OUT)
print("LoRA saved ->", OUT, flush=True)
PY
echo "[unsloth] done → merge & vLLM serve as AISVI_FINANCE_T (다음 단계)"
