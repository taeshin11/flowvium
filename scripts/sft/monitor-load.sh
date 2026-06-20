#!/usr/bin/env bash
# Track RAM peak + load progress for ~130s to confirm the 30B load passes 96% into training.
LOG=/mnt/d/Flowvium/logs/lora-isolated.log
PEAK=0
for i in $(seq 1 26); do
  USED=$(free -m | awk '/Mem:/{print $3}')
  [ "$USED" -gt "$PEAK" ] && PEAK=$USED
  GPU=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
  ALIVE=$(ps aux | grep -c '[t]rain-lora')
  LAST=$(tr '\r' '\n' < "$LOG" | tail -1 | cut -c1-70)
  echo "[$((i*5))s] ram=${USED}MB peak=${PEAK}MB gpu=${GPU}MiB alive=$ALIVE :: $LAST"
  [ "$ALIVE" -eq 0 ] && { echo "=== train-lora DIED at $((i*5))s, peak RAM=${PEAK}MB ==="; break; }
  sleep 5
done
echo "=== monitor end: peak RAM=${PEAK}MB ==="
