# FlowVium AI 리포트 자동 생성 - Windows 작업 스케줄러 설정
# 실행 방법: PowerShell을 관리자 권한으로 열고 아래 실행
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\setup-scheduler.ps1

$ProjectDir = "D:\Flowvium"
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

# ─── DART prefetch (KR 345 종목 매일 갱신) ──────────────────────────────────────
$DartScript = "$ProjectDir\scripts\prefetch-dart-financials.mjs"
$DartLog = "$LogDir\dart-prefetch.log"
$DartBatch = @"
@echo off
cd /d "$ProjectDir"
echo [%date% %time%] DART prefetch start >> "$DartLog"
"$NodePath" "$DartScript" >> "$DartLog" 2>&1
echo [%date% %time%] DART prefetch done. >> "$DartLog"
"@
$DartBatchFile = "$ProjectDir\scripts\run-dart-prefetch.bat"
$DartBatch | Out-File -FilePath $DartBatchFile -Encoding ASCII
Write-Host "배치 파일 생성: $DartBatchFile" -ForegroundColor Green

$DartTrigger = New-ScheduledTaskTrigger -Daily -At "03:00"
$DartAction  = New-ScheduledTaskAction -Execute $DartBatchFile
$DartSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
    -TaskName "FlowVium-DART-Prefetch" `
    -Trigger $DartTrigger `
    -Action $DartAction `
    -Settings $DartSettings `
    -RunLevel Highest `
    -Force | Out-Null
Write-Host "등록: FlowVium-DART-Prefetch @ 03:00 (KR 345 종목)" -ForegroundColor Cyan

# ─── DART corp_code 매월 갱신 (3,967 상장사 stock_code↔corp_code mapping) ───────
$CorpScript = "$ProjectDir\scripts\fetch-dart-corp-codes.mjs"
$CorpLog = "$LogDir\dart-corp-codes.log"
$CorpBatch = @"
@echo off
cd /d "$ProjectDir"
echo [%date% %time%] DART corp_code fetch start >> "$CorpLog"
"$NodePath" "$CorpScript" >> "$CorpLog" 2>&1
echo [%date% %time%] DART corp_code fetch done. >> "$CorpLog"
"@
$CorpBatchFile = "$ProjectDir\scripts\run-dart-corp-codes.bat"
$CorpBatch | Out-File -FilePath $CorpBatchFile -Encoding ASCII

# 매월 1일 02:00 KST
$CorpTrigger = New-ScheduledTaskTrigger -Daily -At "02:00"
$CorpTrigger.Repetition = $null
$CorpSettings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
    -TaskName "FlowVium-DART-CorpCodes" `
    -Trigger $CorpTrigger `
    -Action (New-ScheduledTaskAction -Execute $CorpBatchFile) `
    -Settings $CorpSettings `
    -RunLevel Highest `
    -Force | Out-Null
Write-Host "등록: FlowVium-DART-CorpCodes @ 02:00 daily (corp_code mapping 갱신)" -ForegroundColor Cyan

# ─── tune-sell-rules.mjs (Karpathy 매도 룰 grid search, 주 1회) ──────────────────
$TuneScript = "$ProjectDir\scripts\tune-sell-rules.mjs"
$TuneLog = "$LogDir\tune-sell-rules.log"
$TuneBatch = @"
@echo off
cd /d "$ProjectDir"
echo [%date% %time%] tune-sell-rules start >> "$TuneLog"
"$NodePath" "$TuneScript" >> "$TuneLog" 2>&1
echo [%date% %time%] tune-sell-rules done. >> "$TuneLog"
"@
$TuneBatchFile = "$ProjectDir\scripts\run-tune-sell-rules.bat"
$TuneBatch | Out-File -FilePath $TuneBatchFile -Encoding ASCII

$TuneTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "04:00"
Register-ScheduledTask `
    -TaskName "FlowVium-Tune-Sell-Rules" `
    -Trigger $TuneTrigger `
    -Action (New-ScheduledTaskAction -Execute $TuneBatchFile) `
    -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable) `
    -RunLevel Highest `
    -Force | Out-Null
Write-Host "등록: FlowVium-Tune-Sell-Rules @ Sun 04:00 (룰 grid search 학습)" -ForegroundColor Cyan

# ─── tune-buy-rules.mjs (매수 룰 outcome 평가, 주 1회) ───────────────────────────
$TuneBuyScript = "$ProjectDir\scripts\tune-buy-rules.mjs"
$TuneBuyLog = "$LogDir\tune-buy-rules.log"
$TuneBuyBatch = @"
@echo off
cd /d "$ProjectDir"
echo [%date% %time%] tune-buy-rules start >> "$TuneBuyLog"
"$NodePath" "$TuneBuyScript" >> "$TuneBuyLog" 2>&1
echo [%date% %time%] tune-buy-rules done. >> "$TuneBuyLog"
"@
$TuneBuyBatchFile = "$ProjectDir\scripts\run-tune-buy-rules.bat"
$TuneBuyBatch | Out-File -FilePath $TuneBuyBatchFile -Encoding ASCII

$TuneBuyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "04:15"
Register-ScheduledTask `
    -TaskName "FlowVium-Tune-Buy-Rules" `
    -Trigger $TuneBuyTrigger `
    -Action (New-ScheduledTaskAction -Execute $TuneBuyBatchFile) `
    -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable) `
    -RunLevel Highest `
    -Force | Out-Null
Write-Host "등록: FlowVium-Tune-Buy-Rules @ Sun 04:15 (매수 룰 outcome 평가)" -ForegroundColor Cyan

Write-Host ""
Write-Host "✅ 작업 스케줄러 등록 완료!" -ForegroundColor Green
Write-Host "   - 보고서: 매일 08:05 / 16:05 / 21:35 KST"
Write-Host "   - DART prefetch: 매일 03:00 KST (KOSPI 200 + KOSDAQ 150)"
Write-Host "   - Ollama가 켜져 있어야 함 (ollama serve)"
Write-Host "   - 로그: $LogDir\report.log, $LogDir\dart-prefetch.log"
Write-Host ""
Write-Host "확인: Get-ScheduledTask -TaskName 'FlowVium-*'"
Write-Host "삭제: Unregister-ScheduledTask -TaskName 'FlowVium-*' -Confirm:`$false"
