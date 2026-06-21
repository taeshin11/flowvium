#!/usr/bin/env bash
# AISVI v2 — Qwen3-30B-A3B QLoRA via Unsloth, 데이터=Qwen3.5-122B teacher distillation(이중언어 KO+EN).
# v1과 차이: (1) DATA=v2 distilled, (2) MAXLEN 동적측정(122B 추론출력이 v1 간결포맷보다 길 수 있음),
#   (3) OUT=v2-lora(v1 보존). 나머지(r16/cosine/NEFTune/adamw_8bit)는 v1 검증경로 유지.
# 주의: teacher llama-server + 이 학습은 GPU 배타 → 데이터생성 끝나고 teacher 정지 후 실행.
set -e
VENV="$HOME/aisvi-unsloth"
[ ! -f "$VENV/bin/activate" ] && { echo "[v2] FATAL: $VENV 없음"; exit 1; }
source "$VENV/bin/activate"
export HF_HUB_ENABLE_HF_TRANSFER=1
# ★torch.compile 비활성 — v2 데이터 길이 가변(2~496)이라 매 step 재컴파일로 9분/step(40x 느림).
#   끄면 ~69s/step. (v1은 길이 변동 적어 안 걸렸음.) MAXLEN 449 무손실 + 빠름 양립.
export TORCHDYNAMO_DISABLE=1
DATA="${DATA:-/mnt/d/llama/aisvi-finance-t-v2.jsonl}"
OUT="${OUT:-$HOME/aisvi-finance-t-v2-lora}"
[ ! -f "$DATA" ] && { echo "[v2] FATAL: DATA 없음 $DATA — distill-gen 먼저"; exit 1; }
BASE=$(ls -d "$HOME"/.cache/huggingface/hub/models--Qwen--Qwen3-30B-A3B-Instruct-2507/snapshots/*/ 2>/dev/null | head -1)
[ -z "$BASE" ] && BASE="Qwen/Qwen3-30B-A3B-Instruct-2507"
echo "[v2] BASE=$BASE DATA=$DATA OUT=$OUT"

echo "[v2] GPU 해제 대기 (teacher llama-server 종료 후)..."
for i in $(seq 1 30); do
  USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  if [ -n "$USED" ] && [ "$USED" -lt 3000 ]; then echo "[v2] GPU 해제됨 (${USED}MiB)"; break; fi
  echo "[v2] GPU ${USED:-?}MiB 점유 — 대기 ${i}/30"; sleep 4
done

PYTHONUNBUFFERED=1 BASE="$BASE" OUT="$OUT" DATA="$DATA" python - <<'PY'
import os
from unsloth import FastLanguageModel   # 최초 import
import torch
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
OUT=os.environ["OUT"]; DATA=os.environ["DATA"]; BASE=os.environ["BASE"]

# MAXLEN 동적측정 — 122B 추론출력 길이에 맞춤(truncate 방지). 99%ile+여유, [320,2048] 클램프.
import json
_tmp, _tok = FastLanguageModel.from_pretrained(model_name=BASE, max_seq_length=2048, load_in_4bit=True, dtype=None)
lens=[]
with open(DATA) as f:
    for ln in f:
        try: lens.append(len(_tok.apply_chat_template(json.loads(ln)["messages"], tokenize=True)))
        except: pass
lens.sort()
p99 = lens[int(len(lens)*0.99)] if lens else 512
MAXLEN = max(320, min(2048, p99 + 16))
print(f"[v2] 토큰길이 max={lens[-1] if lens else 0} p99={p99} → MAXLEN={MAXLEN}", flush=True)
model, tok = _tmp, _tok   # 재사용

model = FastLanguageModel.get_peft_model(
    model, r=16, lora_alpha=32, lora_dropout=0,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    use_gradient_checkpointing="unsloth", random_state=42,
)
ds=load_dataset("json", data_files=DATA, split="train")
def fmt(ex): return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds=ds.map(fmt)
cfg=SFTConfig(output_dir=OUT, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=3, learning_rate=1e-4, bf16=True, logging_steps=1,
    lr_scheduler_type="cosine", warmup_ratio=0.05, weight_decay=0.01, neftune_noise_alpha=5,
    optim="adamw_8bit", save_strategy="epoch", max_length=MAXLEN, packing=False)
tr=SFTTrainer(model=model, train_dataset=ds, args=cfg)
tr.train(); tr.save_model(OUT)
print("[v2] LoRA saved ->", OUT, flush=True)
PY
echo "[v2] done → eval vs v1 (eval-adapter.py) 로 능가 확인"
