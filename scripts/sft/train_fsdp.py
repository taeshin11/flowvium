#!/usr/bin/env python3
# SERA 클러스터 FSDP(ZeRO-3 동등) distillation — torch FSDP full_shard + CPU offload.
# deepspeed/nvcc 불필요(torch 내장). 멀티노드 torchrun 으로 구동.
# env: MODEL(기본 14B), DATA(jsonl), LAYER_CLS(모델 decoder layer 클래스)
import os, torch
from transformers import (AutoModelForCausalLM, AutoTokenizer, TrainingArguments,
                          Trainer, DataCollatorForSeq2Seq)
from datasets import load_dataset

MODEL = os.environ.get("MODEL", "Qwen/Qwen2.5-14B-Instruct")
DATA  = os.environ.get("DATA", "/root/aisvi-finance-t.jsonl")
LAYER = os.environ.get("LAYER_CLS", "Qwen2DecoderLayer")   # 30B-A3B 면 Qwen3MoeDecoderLayer
print(f"MODEL={MODEL} DATA={DATA} LAYER={LAYER}", flush=True)

tok = AutoTokenizer.from_pretrained(MODEL)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token
model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.bfloat16, use_cache=False)

ds = load_dataset("json", data_files=DATA, split="train")
def fmt(ex):
    ids = tok.apply_chat_template(ex["messages"], tokenize=True, truncation=True, max_length=1024)
    return {"input_ids": ids, "labels": ids}
ds = ds.map(fmt, remove_columns=ds.column_names)

args = TrainingArguments(
    output_dir="/root/sera-out", per_device_train_batch_size=1,
    gradient_accumulation_steps=16, num_train_epochs=1, learning_rate=1e-5,
    bf16=True, logging_steps=2, gradient_checkpointing=True,
    fsdp="full_shard auto_wrap",
    fsdp_config={"transformer_layer_cls_to_wrap": [LAYER], "offload_params": True,
                 "use_orig_params": True, "sync_module_states": True},
    save_strategy="no", report_to="none",
)
Trainer(model=model, args=args, train_dataset=ds,
        data_collator=DataCollatorForSeq2Seq(tok, padding=True)).train()
print("=== FSDP 학습 완료 ===", flush=True)
