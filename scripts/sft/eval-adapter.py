#!/usr/bin/env python3
# AISVI SFT 어댑터 품질 실측 — base vs SFT 같은 프롬프트 대조 (2026-06-21).
# 실행: /root/aisvi-unsloth/bin/python eval-adapter.py
import os, glob, torch
from unsloth import FastLanguageModel

snaps = glob.glob("/root/.cache/huggingface/hub/models--Qwen--Qwen3-30B-A3B-Instruct-2507/snapshots/*/")
BASE = snaps[0] if snaps else "Qwen/Qwen3-30B-A3B-Instruct-2507"
ADAPTER = "/root/aisvi-finance-t-lora"
print("BASE =", BASE, "\nADAPTER =", ADAPTER, flush=True)

model, tok = FastLanguageModel.from_pretrained(model_name=BASE, max_seq_length=512, load_in_4bit=True, dtype=None)
from peft import PeftModel
model = PeftModel.from_pretrained(model, ADAPTER)
FastLanguageModel.for_inference(model)
print("로드 완료 (base+adapter)\n", flush=True)

SYS = ('너는 "매수·매도 심판엔진" — 규율 있고 근거 기반인 투자 판단 AI다. 종목의 매수/분할매수/관망/'
       '비중축소/매도/회피를 판단하고, 실시간 데이터·매수매도 룰·구루 원칙을 근거로 인용하며, 리스크와 '
       '진입/손절을 제시한다. 수치를 지어내지 않고, 데이터 없으면 솔직히 말한다.')
PROMPTS = [
    "NVIDIA(NVDA, Technology) 매수해도 될까? 현재가 $178.50.",
    "Coca-Cola(KO, Consumer Staples) 지금 팔아야 할까? 현재가 $68.20.",
    "Eli Lilly(LLY, Healthcare) 매수해도 될까? 현재가 $735.00.",
]

def gen(u):
    msgs = [{"role": "system", "content": SYS}, {"role": "user", "content": u}]
    ids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to("cuda")
    out = model.generate(input_ids=ids, max_new_tokens=220, do_sample=False, pad_token_id=tok.eos_token_id)
    return tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()

for u in PROMPTS:
    print("=" * 70); print("Q:", u, flush=True)
    sft = gen(u)
    with model.disable_adapter():
        base = gen(u)
    print("\n[BASE]\n" + base[:500], flush=True)
    print("\n[SFT/AISVI]\n" + sft[:500], flush=True)
    print(flush=True)
print("=== eval 완료 ===", flush=True)
