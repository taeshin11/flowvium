#!/usr/bin/env bash
# Remove leftover cu12 nvidia packages from aisvi-train2 (torch cu124 잔재) so only cu13 remains,
# matching the working aisvi-train venv → bnb finds libnvJitLink.so.13.
source /root/aisvi-train2/bin/activate
mapfile -t CU12 < <(pip list 2>/dev/null | grep -iE 'cu12' | awk '{print $1}')
echo "제거 대상(${#CU12[@]}): ${CU12[*]}"
if [ "${#CU12[@]}" -gt 0 ]; then
  pip uninstall -y "${CU12[@]}" 2>&1 | tail -2
fi
echo "=== 잔여 nvidia ==="
pip list 2>/dev/null | grep -iE 'nvidia' | grep -i cu12 && echo "(cu12 잔존!)" || echo "cu12 전부 제거됨"
echo "=== bnb quantize smoke ==="
python - <<'PY'
import torch, bitsandbytes.functional as F
x=torch.randn(256,256,dtype=torch.float16,device="cuda")
q,s=F.quantize_4bit(x,quant_type="nf4")
print("quantize_4bit OK", tuple(q.shape), q.dtype)
PY
