#!/usr/bin/env bash
# Watch phase-1 (4bit save) -> phase-2 (load+train) transition for up to ~5min.
LOG=/mnt/d/Flowvium/logs/lora-isolated.log
for i in $(seq 1 20); do
  sleep 15
  GPU=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
  RAM=$(free -m | awk '/Mem:/{print $3}')
  Q4=$(ls -1 /root/qwen3-30b-a3b-bnb4/*.safetensors 2>/dev/null | wc -l)
  ALIVE=$(ps aux | grep -c '[t]rain-lora')
  LAST=$(tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -1 | cut -c1-74)
  echo "[$((i*15))s] gpu=${GPU}MiB ram=${RAM}MB q4files=$Q4 alive=$ALIVE :: $LAST"
  if tr '\r' '\n' < "$LOG" | grep -qiE "'loss':|LoRA saved|OutOfMemory|Error|Traceback"; then
    echo "  >> 신호 감지 (loss/완료/에러)"; break
  fi
  if [ "$ALIVE" -eq 0 ]; then echo "  >> train-lora 프로세스 종료됨"; break; fi
done
echo "=== tail ==="
tr '\r' '\n' < "$LOG" | grep -vE '^[[:space:]]*$' | tail -8
