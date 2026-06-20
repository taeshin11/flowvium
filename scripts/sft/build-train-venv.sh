#!/usr/bin/env bash
# 2026-06-20: 검증된 QLoRA 스택의 독립 venv(aisvi-train2). 기존 aisvi-train(torch2.12+transformers5.12)은
#   transformers 5.x 병렬 로딩이 30B 4bit staging 을 24GB 에서 안 비워 OOM → 성숙한 4.x 세대로 격리.
#   torch 2.5.1+cu124 (cu130 드라이버 backward-compat) + bnb 0.44.1(cu124 wheel) + expandable_segments 호환.
set -e
LOG=/mnt/d/Flowvium/logs/build-venv.log
exec > >(tee "$LOG") 2>&1
echo "[build] $(date) venv 생성..."
python3 -m venv /root/aisvi-train2
source /root/aisvi-train2/bin/activate
pip install -q -U pip wheel
echo "[build] torch 2.5.1+cu124 설치..."
pip install -q torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124
echo "[build] QLoRA 스택 설치..."
pip install -q "transformers==4.46.3" "peft==0.13.2" "trl==0.12.1" "accelerate==1.1.1" "bitsandbytes==0.44.1" "datasets==3.1.0"
echo "[build] 버전 확인:"
pip list | grep -iE "^(torch|transformers|peft|trl|accelerate|bitsandbytes|datasets) "
echo "[build] torch CUDA 가용 확인:"
python -c "import torch; print('torch', torch.__version__, 'cuda_avail', torch.cuda.is_available(), 'cuda', torch.version.cuda)"
echo "[build] DONE $(date)"
