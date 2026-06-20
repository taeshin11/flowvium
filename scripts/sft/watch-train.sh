#!/usr/bin/env bash
# One-shot snapshot of LoRA training health: GPU, RAM, swap, process, last log line.
GPU=$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits | head -1)
RAM=$(free -m | awk '/Mem:/{print $3"/"$2"MB"}')
SW=$(free -m | awk '/Swap:/{print $3"/"$2"MB"}')
PY=$(ps aux | grep '[p]ython -' | awk '{print "pid="$2" cpu="$3"% rss="int($6/1024)"MB"}' | head -1)
TR=$(ps aux | grep -c '[t]rain-lora')
echo "GPU=${GPU}MiB RAM=${RAM} SWAP=${SW} | $PY | train-lora_alive=$TR"
