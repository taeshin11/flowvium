#!/usr/bin/env bash
for i in $(seq 1 32); do
  sleep 5
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://localhost:8000/v1/models 2>/dev/null)
  if [ "$code" = "200" ]; then echo "vLLM UP at $((i*5))s"; break; fi
done
code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://localhost:8000/v1/models 2>/dev/null)
if [ "$code" = "200" ]; then
  echo "--- 모델 목록 ---"
  curl -s -m 5 http://localhost:8000/v1/models | python3 -c "import json,sys;print([m['id'] for m in json.load(sys.stdin)['data']])"
else
  echo "=== vLLM 안뜸 (code=$code) — LoRA 에러 로그 ==="
  tail -20 /var/log/flowvium-vllm.log 2>/dev/null | grep -iE 'lora|error|fail|traceback|valueerror' | tail -8
fi
