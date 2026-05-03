# FlowVium AI 리포트 자동 생성 - Windows 작업 스케줄러 설정
# 실행 방법: PowerShell을 관리자 권한으로 열고 아래 실행
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\setup-scheduler.ps1

$ProjectDir = "C:\NoAddsMakingApps\FlowVium"
$NodePath = (Get-Command node).Source
$Script = "$ProjectDir\scripts\generate-report-local.mjs"
$Model = "ollama/qwen3:8b"
$LogDir = "$ProjectDir\logs"
$TaskName = "FlowVium-AI-Report"

# 로그 디렉토리 생성
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 실행 스크립트 내용 (Ollama 서버 확인 포함)
$RunScript = @"
@echo off
cd /d "$ProjectDir"
ollama list >nul 2>&1 || (echo Ollama not running, skipping & exit /b 1)
echo [%date% %time%] Starting report generation... >> "$LogDir\report.log"
"$NodePath" "$Script" --model=$Model >> "$LogDir\report.log" 2>&1
echo [%date% %time%] Done. >> "$LogDir\report.log"
"@

$BatchFile = "$ProjectDir\scripts\run-report.bat"
$RunScript | Out-File -FilePath $BatchFile -Encoding ASCII

Write-Host "배치 파일 생성: $BatchFile" -ForegroundColor Green

# 3개 스케줄 등록 (크론 후 5분 뒤 실행 — 클라우드 실패 시 로컬 보완)
$Schedules = @(
    @{ Name = "$TaskName-Morning";   Time = "08:05" },  # KST 08:00 크론 후
    @{ Name = "$TaskName-Afternoon"; Time = "16:05" },  # KST 16:00 크론 후
    @{ Name = "$TaskName-Evening";   Time = "21:35" }   # KST 21:30 크론 후
)

foreach ($s in $Schedules) {
    $Trigger = New-ScheduledTaskTrigger -Daily -At $s.Time
    $Action  = New-ScheduledTaskAction -Execute $BatchFile
    $Settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable

    Register-ScheduledTask `
        -TaskName $s.Name `
        -Trigger $Trigger `
        -Action $Action `
        -Settings $Settings `
        -RunLevel Highest `
        -Force | Out-Null

    Write-Host "등록: $($s.Name) @ $($s.Time)" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "✅ 작업 스케줄러 등록 완료!" -ForegroundColor Green
Write-Host "   - 매일 08:05 / 16:05 / 21:35 KST에 자동 실행"
Write-Host "   - Ollama가 켜져 있어야 함 (ollama serve)"
Write-Host "   - 로그: $LogDir\report.log"
Write-Host ""
Write-Host "확인: Get-ScheduledTask -TaskName '$TaskName*'"
Write-Host "삭제: Unregister-ScheduledTask -TaskName '$TaskName*' -Confirm:`$false"
