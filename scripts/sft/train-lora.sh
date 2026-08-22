#!/usr/bin/env bash
# AISVI_FINANCE_T — Qwen3-30B-A3B 에 QLoRA 학습 (vLLM 정지 윈도우에서 실행).
# 선행: aisvi-train venv(torch2.12+cu130 / transformers4.57 / bnb0.49 / peft0.19 / trl1.6),
#   data/sft/aisvi-finance-t.jsonl(build-sft-dataset.mjs).
# 주의: vLLM 가 GPU 24GB 점유 → 실행 전 vLLM 정지 필수(run-lora-window.bat 가 처리). 학습 후 재기동.
#
# 2026-06-20 환경(중대 — 장시간 디버깅 결론):
#   - 드라이버는 cu130. torch 는 *반드시 cu130 매칭*(cu124 torch 는 bnb quantize_4bit 에서 cudaErrorNot
#     ready 간헐 크래시 — 드라이버 minor 불일치). 별도 cu124 venv 는 nvjitlink 누락+cu12 잔재로 오염, 폐기.
#   - transformers 는 4.57(qwen3_moe 지원 + 5.0 이전 *순차* 로딩). 5.12 는 병렬 로딩이 bf16 staging 을
#     24GB 에서 안 비워 로드후 GPU 23.9GB→학습OOM. 4.57 은 shard 별 staging 즉시 해제 → at-rest ~16GB.
#   - expandable_segments 금지: 이 bnb0.49+cu130 조합서 "!handles_.at(i) INTERNAL ASSERT(CUDA IPC)" 유발.
#     기본 allocator 사용(4.57 순차 로딩이 단편화 없이 적재).
set -e
VENV="$HOME/aisvi-train"
if [ ! -f "$VENV/bin/activate" ]; then echo "[train] FATAL: $VENV 없음"; exit 1; fi
source "$VENV/bin/activate"
DATA="/mnt/d/Flowvium/data/sft/aisvi-finance-t.jsonl"
OUT="$HOME/aisvi-finance-t-lora"

echo "[train] GPU 해제 대기 (vLLM 종료 후)..."
for i in $(seq 1 30); do
  USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
  if [ -n "$USED" ] && [ "$USED" -lt 3000 ]; then echo "[train] GPU 해제됨 (${USED}MiB free-ish)"; break; fi
  echo "[train] GPU ${USED:-?}MiB 점유 중 — 대기 ${i}/30"; sleep 4
done

OUT="$OUT" DATA="$DATA" python - <<'PY'
import os, torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer, SFTConfig
BASE="Qwen/Qwen3-30B-A3B-Instruct-2507"; OUT=os.environ["OUT"]; DATA=os.environ["DATA"]
tok=AutoTokenizer.from_pretrained(BASE)
bnb=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
# transformers 4.57 순차 로딩이 shard 별 bf16 staging 을 즉시 해제 → at-rest ~16GB, {"":0} 전부 GPU 적재.
model=AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, device_map={"":0}, trust_remote_code=True)
model.config.use_cache=False
model=prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
lora=LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"], task_type="CAUSAL_LM")
ds=load_dataset("json", data_files=DATA, split="train")
def fmt(ex): return {"text": tok.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)}
ds=ds.map(fmt)
# 2026-06-20 성능: 1024+paged_adamw_8bit 는 GPU 24GB 초과→PCIe 페이징(util 0%, 5min/step, 46h ETA).
#   max_length 512 + 비페이징 adamw_8bit 로 ~20GB 안에 수용 → 페이징 제거 목표.
cfg=SFTConfig(output_dir=OUT, per_device_train_batch_size=1, gradient_accumulation_steps=8,
    num_train_epochs=3, learning_rate=1e-4, bf16=True, gradient_checkpointing=True, logging_steps=10,
    optim="adamw_8bit", save_strategy="epoch", max_length=512, packing=False)  # trl1.6: max_seq_length→max_length
tr=SFTTrainer(model=get_peft_model(model,lora), train_dataset=ds, args=cfg)
tr.train(); tr.save_model(OUT)
print("LoRA saved ->", OUT, flush=True)
PY
echo "[train] done → merge & vLLM serve as AISVI_FINANCE_T (다음 단계)"
