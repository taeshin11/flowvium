# KRX 수급 데이터 자동 업데이트 - Windows 작업 스케줄러 설정
$ProjectDir = "C:\NoAddsMakingApps\FlowVium"
$NodePath   = (Get-Command node).Source
$Script     = "$ProjectDir\scripts\update-korea-flow.mjs"
$LogDir     = "$ProjectDir\logs"
$TaskName   = "FlowVium-Korea-Flow"
$BatchFile  = "$ProjectDir\scripts\run-korea-flow.bat"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 배치 파일 생성
$bat = "@echo off`r`ncd /d `"$ProjectDir`"`r`necho [%date% %time%] KRX start >> `"$LogDir\korea-flow.log`"`r`n`"$NodePath`" `"$Script`" >> `"$LogDir\korea-flow.log`" 2>&1`r`necho [%date% %time%] done >> `"$LogDir\korea-flow.log`""
[System.IO.File]::WriteAllText($BatchFile, $bat, [System.Text.Encoding]::ASCII)
Write-Host "배치 파일 생성: $BatchFile" -ForegroundColor Green

# 기존 태스크 제거
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

# 트리거: 지금부터 15분마다
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
$action  = New-ScheduledTaskAction -Execute $BatchFile
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Trigger $trigger -Action $action -Settings $settings -RunLevel Highest -Force | Out-Null
Write-Host "등록 완료: $TaskName (15분마다)" -ForegroundColor Green

# 즉시 실행 테스트
Write-Host "즉시 테스트 실행..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 8
Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime, LastTaskResult
