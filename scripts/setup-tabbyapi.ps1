# TabbyAPI + ExLlamaV2 ?먮룞 ?ㅼ튂 ?ㅽ겕由쏀듃 (Windows native)
#
# 紐⑹쟻: 6GB VRAM ?먯꽌 14B EXL2 3.5bpw 紐⑤뜽??OpenAI-?명솚 endpoint 濡??댁슜.
# vLLM 蹂대떎 媛踰쇱슦硫?Windows native 吏??(Docker/WSL 遺덊븘??.
#
# ?ъ슜:
#   PowerShell 愿由ъ옄 沅뚰븳 ?먮뒗 ?ъ슜??沅뚰븳
#   cd C:\Flowvium
#   .\scripts\setup-tabbyapi.ps1
#
# ?ъ쟾 ?붽뎄: Python 3.10/3.11/3.12, NVIDIA driver 525+, ~10GB ?붿뒪??
# ?ㅼ튂 ???쒖옉: .\.tabbyapi\start.bat
# Endpoint: http://localhost:5000/v1 (OpenAI-compatible)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host ""
Write-Host "=== TabbyAPI + ExLlamaV2 setup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Python ?뺤씤
$pyVer = python --version 2>&1
if ($pyVer -notmatch "Python 3\.(10|11|12)") {
    Write-Host "ERROR: Python 3.10/3.11/3.12 ?꾩슂. ?꾩옱: $pyVer" -ForegroundColor Red
    exit 1
}
Write-Host "[1/5] Python OK: $pyVer" -ForegroundColor Green

# 2. TabbyAPI clone
$tabbyDir = Join-Path $root ".tabbyapi"
if (Test-Path $tabbyDir) {
    Write-Host "[2/5] TabbyAPI ?붾젆?곕━ 議댁옱 ??git pull ?쒕룄..."
    Push-Location $tabbyDir; git pull 2>&1 | Out-Null; Pop-Location
} else {
    Write-Host "[2/5] TabbyAPI clone..."
    git clone --depth 1 https://github.com/theroyallab/tabbyAPI $tabbyDir
}

# 3. venv ?앹꽦
$venvDir = Join-Path $root ".tabby-venv"
if (-not (Test-Path $venvDir)) {
    Write-Host "[3/5] venv ?앹꽦..."
    python -m venv $venvDir
} else {
    Write-Host "[3/5] venv 議댁옱"
}

# 4. ?섏〈???ㅼ튂 (CUDA 12.x wheel)
Write-Host "[4/5] ExLlamaV2 + TabbyAPI ?섏〈???ㅼ튂 (5-10遺??뚯슂)..."
$activate = Join-Path $venvDir "Scripts\Activate.ps1"
& $activate

Push-Location $tabbyDir
pip install --upgrade pip 2>&1 | Out-Null
# requirements.txt 媛 cu121 wheel ?먮룞 ?좏깮
pip install -r requirements.txt 2>&1 | Tee-Object -FilePath ..\tabbyapi-install.log
Pop-Location

# 5. 紐⑤뜽 ?ㅼ슫濡쒕뱶 ?덈궡 (??⑸웾?대씪 ?먮룞??X)
Write-Host ""
Write-Host "[5/5] 紐⑤뜽 ?ㅼ슫濡쒕뱶 ?덈궡" -ForegroundColor Yellow
Write-Host ""
Write-Host "  HuggingFace ?먯꽌 EXL2 紐⑤뜽 ?ㅼ슫濡쒕뱶:" -ForegroundColor White
Write-Host "    異붿쿇: turboderp/Qwen2.5-14B-Instruct-exl2 (revision=3.5bpw)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  諛⑸쾿 A) huggingface-cli (?먮룞, 沅뚯옣):" -ForegroundColor White
Write-Host '    pip install huggingface_hub' -ForegroundColor Gray
Write-Host '    huggingface-cli download turboderp/Qwen2.5-14B-Instruct-exl2 --revision 3.5bpw --local-dir .tabbyapi\models\Qwen2.5-14B-3.5bpw' -ForegroundColor Gray
Write-Host ""
Write-Host "  諛⑸쾿 B) 吏곸젒 ?ㅼ슫濡쒕뱶: https://huggingface.co/turboderp/Qwen2.5-14B-Instruct-exl2/tree/3.5bpw" -ForegroundColor Gray
Write-Host ""
Write-Host "?ㅼ쓬 ?④퀎:" -ForegroundColor Cyan
Write-Host "  1. ??紐⑤뜽 ?ㅼ슫濡쒕뱶"
Write-Host "  2. .tabbyapi\config.yml ?먯꽌 model.model_name = 'Qwen2.5-14B-3.5bpw' ?ㅼ젙"
Write-Host "  3. .tabbyapi\start.bat ?ㅽ뻾 ??http://localhost:5000/v1 listen"
Write-Host "  4. setx VLLM_URL http://localhost:5000/v1"
Write-Host "  5. ??PowerShell 李쎌뿉??generate-report-local.mjs ?ㅽ뻾 ??vLLM ?곗꽑 ?몄텧"
Write-Host ""
Write-Host "=== TabbyAPI ?ㅼ튂 ?꾨즺 ===" -ForegroundColor Green
