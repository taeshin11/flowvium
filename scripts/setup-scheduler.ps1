# FlowVium AI 由ы룷???먮룞 ?앹꽦 - Windows ?묒뾽 ?ㅼ?以꾨윭 ?ㅼ젙
# ?ㅽ뻾 諛⑸쾿: PowerShell??愿由ъ옄 沅뚰븳?쇰줈 ?닿퀬 ?꾨옒 ?ㅽ뻾
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\setup-scheduler.ps1

$ProjectDir = "C:\Flowvium"
$NodePath = (Get-Command node).Source
$Script = "$ProjectDir\scripts\generate-report-local.mjs"
$Model = "ollama/qwen3:8b"
$LogDir = "$ProjectDir\logs"
$TaskName = "FlowVium-AI-Report"

# 濡쒓렇 ?붾젆?좊━ ?앹꽦
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ?ㅽ뻾 ?ㅽ겕由쏀듃 ?댁슜 (Ollama ?쒕쾭 ?뺤씤 ?ы븿)
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

Write-Host "諛곗튂 ?뚯씪 ?앹꽦: $BatchFile" -ForegroundColor Green

# 3媛??ㅼ?以??깅줉 (?щ줎 ??5遺????ㅽ뻾 ???대씪?곕뱶 ?ㅽ뙣 ??濡쒖뺄 蹂댁셿)
$Schedules = @(
    @{ Name = "$TaskName-Morning";   Time = "08:05" },  # KST 08:00 ?щ줎 ??
    @{ Name = "$TaskName-Afternoon"; Time = "16:05" },  # KST 16:00 ?щ줎 ??
    @{ Name = "$TaskName-Evening";   Time = "21:35" }   # KST 21:30 ?щ줎 ??
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

    Write-Host "?깅줉: $($s.Name) @ $($s.Time)" -ForegroundColor Cyan
}

# ??? DART prefetch (KR 345 醫낅ぉ 留ㅼ씪 媛깆떊) ??????????????????????????????????????
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
Write-Host "諛곗튂 ?뚯씪 ?앹꽦: $DartBatchFile" -ForegroundColor Green

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
Write-Host "?깅줉: FlowVium-DART-Prefetch @ 03:00 (KR 345 醫낅ぉ)" -ForegroundColor Cyan

# ??? DART corp_code 留ㅼ썡 媛깆떊 (3,967 ?곸옣??stock_code?봠orp_code mapping) ???????
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

# 留ㅼ썡 1??02:00 KST
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
Write-Host "?깅줉: FlowVium-DART-CorpCodes @ 02:00 daily (corp_code mapping 媛깆떊)" -ForegroundColor Cyan

# ??? tune-sell-rules.mjs (Karpathy 留ㅻ룄 猷?grid search, 二?1?? ??????????????????
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
Write-Host "?깅줉: FlowVium-Tune-Sell-Rules @ Sun 04:00 (猷?grid search ?숈뒿)" -ForegroundColor Cyan

# ??? tune-buy-rules.mjs (留ㅼ닔 猷?outcome ?됯?, 二?1?? ???????????????????????????
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
Write-Host "?깅줉: FlowVium-Tune-Buy-Rules @ Sun 04:15 (留ㅼ닔 猷?outcome ?됯?)" -ForegroundColor Cyan

Write-Host ""
Write-Host "???묒뾽 ?ㅼ?以꾨윭 ?깅줉 ?꾨즺!" -ForegroundColor Green
Write-Host "   - 蹂닿퀬?? 留ㅼ씪 08:05 / 16:05 / 21:35 KST"
Write-Host "   - DART prefetch: 留ㅼ씪 03:00 KST (KOSPI 200 + KOSDAQ 150)"
Write-Host "   - Ollama媛 耳쒖졇 ?덉뼱????(ollama serve)"
Write-Host "   - 濡쒓렇: $LogDir\report.log, $LogDir\dart-prefetch.log"
Write-Host ""
Write-Host "?뺤씤: Get-ScheduledTask -TaskName 'FlowVium-*'"
Write-Host "??젣: Unregister-ScheduledTask -TaskName 'FlowVium-*' -Confirm:`$false"
