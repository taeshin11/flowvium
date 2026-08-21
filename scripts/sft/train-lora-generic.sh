#!/usr/bin/env bash
# train-lora-generic.sh — Unsloth QLoRA 범용 러너 (2026-07-06). BASE/DATA/OUT/MAXSEQ/EPOCHS env 구동.
#   9B(Qwen3.5-9B-BF16) 및 30B-A3B(merged 이어학습) 공용. prod-down 창에서 실행(GPU 독점).
set -e
source /root/aisvi-unsloth/bin/activate
BASE="${BASE:?BASE 필요}"; DATA="${DATA:?DATA 필요}"; OUT="${OUT:?OUT 필요}"
MAXSEQ="${MAXSEQ:-2048}"; EPOCHS="${EPOCHS:-2}"; TARGET_MODE="${TARGET_MODE:-all}"; MAX_STEPS="${MAX_STEPS:-0}"
echo "[train] BASE=$BASE DATA=$DATA OUT=$OUT MAXSEQ=$MAXSEQ EPOCHS=$EPOCHS TARGET=$TARGET_MODE MAX_STEPS=$MAX_STEPS $(date)"
PYTHONUNBUFFERED=1 BASE="$BASE" DATA="$DATA" OUT="$OUT" MAXSEQ="$MAXSEQ" EPOCHS="$EPOCHS" TARGET_MODE="$TARGET_MODE" MAX_STEPS="$MAX_STEPS" python - <<'PY'
import os, time, torch
from unsloth import FastLanguageModel
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
from transformers import TrainerCallback
BASE=os.environ["BASE"]; DATA=os.environ["DATA"]; OUT=os.environ["OUT"]
MAXSEQ=int(os.environ["MAXSEQ"]); EPOCHS=float(os.environ["EPOCHS"])
TARGET_MODE=os.environ["TARGET_MODE"]; MAX_STEPS=int(os.environ["MAX_STEPS"])
TARGETS = (["q_proj","k_proj","v_proj","o_proj"] if TARGET_MODE=="attn"
    else ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"])
print("=== 로드", BASE, "target=", TARGETS, flush=True)
model, tok = FastLanguageModel.from_pretrained(model_name=BASE, max_seq_length=MAXSEQ, load_in_4bit=True, dtype=None)
model = FastLanguageModel.get_peft_model(model, r=16, lora_alpha=32, lora_dropout=0,
    target_modules=TARGETS, use_gradient_checkpointing="unsloth", random_state=42)
ds = load_dataset("json", data_files=DATA, split="train")
def fmt(ex):
    return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds = ds.map(fmt)
print("=== 예시", len(ds), "| 학습 시작", flush=True)
class StepTimer(TrainerCallback):
    def __init__(self): self.t=None; self.times=[]
    def on_step_begin(self,a,s,c,**k): self.t=time.time()
    def on_step_end(self,a,s,c,**k):
        if self.t: dt=time.time()-self.t; self.times.append(dt); print(f"[steptime] step {s.global_step} = {dt:.1f}s", flush=True)
kw = dict(output_dir=OUT, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    warmup_steps=5, learning_rate=2e-4, logging_steps=5,
    optim="adamw_8bit", weight_decay=0.01, lr_scheduler_type="linear", seed=42,
    max_seq_length=MAXSEQ, dataset_text_field="text", report_to="none", save_strategy="no")
if MAX_STEPS>0: kw["max_steps"]=MAX_STEPS
else: kw["num_train_epochs"]=EPOCHS
cfg = SFTConfig(**kw)
tr = SFTTrainer(model=model, train_dataset=ds, args=cfg, callbacks=[StepTimer()])
tr.train()
if MAX_STEPS==0: model.save_pretrained(OUT); tok.save_pretrained(OUT); print("=== LoRA 저장 →", OUT, flush=True)
else: print("=== 타이밍 테스트 완료(저장 안 함) ===", flush=True)
PY
echo "[train] DONE $(date)"
