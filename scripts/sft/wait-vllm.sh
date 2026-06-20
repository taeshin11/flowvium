#!/usr/bin/env bash
for i in $(seq 1 30); do
  sleep 5
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 4 http://localhost:8000/v1/models 2>/dev/null)
  if [ "$code" = "200" ]; then echo "vLLM UP at $((i*5))s"; break; fi
  echo "  ...$((i*5))s code=$code"
done
echo "--- models ---"
curl -s -m 5 http://localhost:8000/v1/models | head -c 300
echo ""
nvidia-smi --query-gpu=memory.used --format=csv,noheader
