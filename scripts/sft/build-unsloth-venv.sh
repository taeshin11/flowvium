#!/usr/bin/env bash
# 2026-06-20: Unsloth 전용 venv. 24GB 단일 GPU 30B QLoRA 위해 Unsloth(메모리 최적) 시도.
# 작동 중인 aisvi-train 은 건드리지 않음(격리). Unsloth 가 torch/xformers/triton 을 스스로 resolve.
LOG=/mnt/d/Flowvium/logs/build-unsloth.log
exec > >(tee "$LOG") 2>&1
echo "[unsloth] $(date) venv 생성..."
rm -rf /root/aisvi-unsloth
python3 -m venv /root/aisvi-unsloth
source /root/aisvi-unsloth/bin/activate
pip install -q -U pip wheel
echo "[unsloth] pip install unsloth (의존성 resolve 관찰)..."
pip install unsloth 2>&1 | tail -25
echo "[unsloth] === 설치된 핵심 버전 ==="
pip list 2>/dev/null | grep -iE "^(torch|unsloth|unsloth_zoo|xformers|triton|transformers|peft|trl|bitsandbytes|accelerate) "
echo "[unsloth] === import + cuda 스모크 ==="
python -c "import torch; print('torch', torch.__version__, 'cuda_avail', torch.cuda.is_available(), 'cuda', torch.version.cuda)" 2>&1 | tail -2
python -c "from unsloth import FastLanguageModel; print('unsloth import OK')" 2>&1 | tail -8
echo "[unsloth] DONE $(date)"
