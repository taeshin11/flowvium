#!/usr/bin/env python3
# AISVI v2 품질 실측 — base vs v1 vs v2 같은 KO/EN 금융프롬프트 대조 (2026-06-23).
# v2가 v1을 능가하는지(포맷준수·근거·언어·무환각) 확인. 실행: /root/aisvi-unsloth/bin/python eval-v2.py
import os, glob, torch
from unsloth import FastLanguageModel
from peft import PeftModel

# MoE(target_parameters) 모델은 어댑터 1개만 → ADAPTER env로 단일 로드, v2/v1 순차 실행해 비교.
snaps = glob.glob("/root/.cache/huggingface/hub/models--Qwen--Qwen3-30B-A3B-Instruct-2507/snapshots/*/")
BASE = snaps[0] if snaps else "Qwen/Qwen3-30B-A3B-Instruct-2507"
ADAPTER = os.environ.get("ADAPTER", "/root/aisvi-finance-t-v2-lora")
LABEL = os.environ.get("LABEL", "V2")
print("BASE =", BASE, "\nADAPTER =", ADAPTER, "(", LABEL, ")", flush=True)

model, tok = FastLanguageModel.from_pretrained(model_name=BASE, max_seq_length=640, load_in_4bit=True, dtype=None)
model = PeftModel.from_pretrained(model, ADAPTER)
FastLanguageModel.for_inference(model)
print("로드 완료 (base +", LABEL, ")\n", flush=True)

KO_SYS = '너는 "매수·매도 심판엔진"이다. 규율·근거 기반으로 매수/분할매수/관망/비중축소/매도/회피를 판단한다. 주어진 데이터만 인용하고 수치를 지어내지 않는다. 6줄 이내 간결: 판단/근거/진입·손절·목표/면책.'
EN_SYS = 'You are the "Buy/Sell Judgment Engine". Judge buy/scale-in/hold/trim/sell/avoid on evidence. Cite only given data; never fabricate. 6 lines max: Verdict/Grounds/Entry-Stop-Target/disclaimer.'
CASES = [
    (KO_SYS, "삼성전자(005930.KS, Technology) 매수 판단? 현재가 ₩71,200. 데이터: 50MA 위(₩68,400), RSI 61, 거래량+12%, 52주:₩49,900-₩88,800."),
    (KO_SYS, "Tesla(TSLA, Auto) 지금 팔아야 할까? 현재가 $412.30. 데이터: 50MA 하향 교차, RSI 38, 거래량-9%."),
    (EN_SYS, "Judge (buy?) NVIDIA (NVDA, Technology). Current price $178.50. Data: above 50MA ($165.20), RSI 58, volume +18%, 52w range $86.60-$195.00."),
    (EN_SYS, "Judge (sell?) Eli Lilly (LLY, Healthcare). Current price $735.00. Data: RSI 74 overbought, near 52w high $740.00."),
]

def gen(u, sys):
    msgs = [{"role": "system", "content": sys}, {"role": "user", "content": u}]
    ids = tok.apply_chat_template(msgs, tokenize=True, add_generation_prompt=True, return_tensors="pt").to("cuda")
    out = model.generate(input_ids=ids, max_new_tokens=240, do_sample=False, pad_token_id=tok.eos_token_id)
    return tok.decode(out[0][ids.shape[1]:], skip_special_tokens=True).strip()

for sys, u in CASES:
    print("=" * 78); print("Q:", u[:90], flush=True)
    out = gen(u, sys)
    with model.disable_adapter():
        base = gen(u, sys)
    print("\n[BASE]\n" + base[:420], flush=True)
    print(f"\n[{LABEL}]\n" + out[:420], flush=True)
    print(flush=True)
print("=== eval 완료 ===", flush=True)
