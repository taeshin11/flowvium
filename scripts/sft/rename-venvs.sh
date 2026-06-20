#!/usr/bin/env bash
# venv 디렉터리 rename: aits-* → aisvi-*. venv 는 bin/activate·shebang 에 절대경로가 박혀 mv 후 경로수정 필수.
set -u
rename_one() {
  local old="$1" new="$2"
  if [ -d "/root/$old" ]; then
    if [ -d "/root/$new" ]; then echo "[skip] /root/$new 이미 존재"; return; fi
    mv "/root/$old" "/root/$new"
    # 내부 하드코딩 경로 수정 (activate 류 + bin/* shebang + pyvenv.cfg)
    grep -rIl "/root/$old" "/root/$new" 2>/dev/null | while read -r f; do
      sed -i "s|/root/$old|/root/$new|g" "$f"
    done
    echo "[ok] $old → $new (경로수정 완료)"
  else
    echo "[none] /root/$old 없음"
  fi
}
rename_one aits-train aisvi-train
rename_one aits-unsloth aisvi-unsloth
rename_one aits-finance-t-lora aisvi-finance-t-lora
echo "=== 검증: aisvi-train pip 동작 ==="
if [ -f /root/aisvi-train/bin/activate ]; then
  source /root/aisvi-train/bin/activate
  python -c "import transformers; print('aisvi-train OK transformers', transformers.__version__)" 2>&1 | tail -1
  deactivate 2>/dev/null || true
fi
echo "=== 검증: aisvi-unsloth import ==="
if [ -f /root/aisvi-unsloth/bin/activate ]; then
  source /root/aisvi-unsloth/bin/activate
  python -c "import torch; print('aisvi-unsloth OK torch', torch.__version__)" 2>&1 | tail -1
  deactivate 2>/dev/null || true
fi
echo "=== 잔여 aits 디렉터리 ==="
ls -d /root/aits-* 2>/dev/null || echo "aits-* 디렉터리 없음(전부 rename)"
