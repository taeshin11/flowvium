#!/usr/bin/env bash
# AITS_FINANCE_T LoRA 준비 — venv + 학습 의존성 + 베이스 모델(non-AWQ) 다운로드 (비파괴적, 라이브 무영향)
set -e
VENV="$HOME/aits-train"
BASE="Qwen/Qwen3-30B-A3B-Instruct-2507"
LOG="$HOME/aits-prep.log"
echo "[prep] $(date) start" | tee -a "$LOG"
python3 -m venv "$VENV" 2>>"$LOG" || true
source "$VENV/bin/activate"
pip install -q -U pip huggingface_hub 2>>"$LOG"
echo "[prep] hf_hub installed, downloading base $BASE ..." | tee -a "$LOG"
# safetensors + config 만 (학습용). 진행상황 로그.
hf download "$BASE" --exclude "*.gguf" "*.pth" >>"$LOG" 2>&1
echo "[prep] $(date) base download DONE" | tee -a "$LOG"
