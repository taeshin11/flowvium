# TabbyAPI + ExLlamaV2 자동 설치 스크립트 (Windows native)
#
# 목적: 6GB VRAM 에서 14B EXL2 3.5bpw 모델을 OpenAI-호환 endpoint 로 운용.
# vLLM 보다 가벼우며 Windows native 지원 (Docker/WSL 불필요).
#
# 사용:
#   PowerShell 관리자 권한 또는 사용자 권한
#   cd C:\Flowvium
#   .\scripts\setup-tabbyapi.ps1
#
# 사전 요구: Python 3.10/3.11/3.12, NVIDIA driver 525+, ~10GB 디스크
# 설치 후 시작: .\.tabbyapi\start.bat
# Endpoint: http://localhost:5000/v1 (OpenAI-compatible)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

Write-Host ""
Write-Host "=== TabbyAPI + ExLlamaV2 setup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Python 확인
$pyVer = python --version 2>&1
if ($pyVer -notmatch "Python 3\.(10|11|12)") {
    Write-Host "ERROR: Python 3.10/3.11/3.12 필요. 현재: $pyVer" -ForegroundColor Red
    exit 1
}
Write-Host "[1/5] Python OK: $pyVer" -ForegroundColor Green

# 2. TabbyAPI clone
$tabbyDir = Join-Path $root ".tabbyapi"
if (Test-Path $tabbyDir) {
    Write-Host "[2/5] TabbyAPI 디렉터리 존재 — git pull 시도..."
    Push-Location $tabbyDir; git pull 2>&1 | Out-Null; Pop-Location
} else {
    Write-Host "[2/5] TabbyAPI clone..."
    git clone --depth 1 https://github.com/theroyallab/tabbyAPI $tabbyDir
}

# 3. venv 생성
$venvDir = Join-Path $root ".tabby-venv"
if (-not (Test-Path $venvDir)) {
    Write-Host "[3/5] venv 생성..."
    python -m venv $venvDir
} else {
    Write-Host "[3/5] venv 존재"
}

# 4. 의존성 설치 (CUDA 12.x wheel)
Write-Host "[4/5] ExLlamaV2 + TabbyAPI 의존성 설치 (5-10분 소요)..."
$activate = Join-Path $venvDir "Scripts\Activate.ps1"
& $activate

Push-Location $tabbyDir
pip install --upgrade pip 2>&1 | Out-Null
# requirements.txt 가 cu121 wheel 자동 선택
pip install -r requirements.txt 2>&1 | Tee-Object -FilePath ..\tabbyapi-install.log
Pop-Location

# 5. 모델 다운로드 안내 (대용량이라 자동화 X)
Write-Host ""
Write-Host "[5/5] 모델 다운로드 안내" -ForegroundColor Yellow
Write-Host ""
Write-Host "  HuggingFace 에서 EXL2 모델 다운로드:" -ForegroundColor White
Write-Host "    추천: turboderp/Qwen2.5-14B-Instruct-exl2 (revision=3.5bpw)" -ForegroundColor Cyan
Write-Host ""
Write-Host "  방법 A) huggingface-cli (자동, 권장):" -ForegroundColor White
Write-Host '    pip install huggingface_hub' -ForegroundColor Gray
Write-Host '    huggingface-cli download turboderp/Qwen2.5-14B-Instruct-exl2 --revision 3.5bpw --local-dir .tabbyapi\models\Qwen2.5-14B-3.5bpw' -ForegroundColor Gray
Write-Host ""
Write-Host "  방법 B) 직접 다운로드: https://huggingface.co/turboderp/Qwen2.5-14B-Instruct-exl2/tree/3.5bpw" -ForegroundColor Gray
Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Cyan
Write-Host "  1. 위 모델 다운로드"
Write-Host "  2. .tabbyapi\config.yml 에서 model.model_name = 'Qwen2.5-14B-3.5bpw' 설정"
Write-Host "  3. .tabbyapi\start.bat 실행 → http://localhost:5000/v1 listen"
Write-Host "  4. setx VLLM_URL http://localhost:5000/v1"
Write-Host "  5. 새 PowerShell 창에서 generate-report-local.mjs 실행 → vLLM 우선 호출"
Write-Host ""
Write-Host "=== TabbyAPI 설치 완료 ===" -ForegroundColor Green
