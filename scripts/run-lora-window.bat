@echo off
REM run-lora-window.bat - AISVI_FINANCE_T LoRA ??? ?????(2026-06-19 02:00 KST ???, FlowVium-LoRA).
REM lock ???(watchdog ?? vLLM ????????) -> vLLM ???(GPU ???) -> QLoRA ??? -> lock ??? -> vLLM ?????
REM ASCII + CRLF ??? (cmd ???).
set "LOG=C:\Flowvium\logs\lora-train.log"
echo [%DATE% %TIME%] === LoRA window start === > "%LOG%"

echo lock > "C:\Flowvium\logs\lora-training.lock"
echo [%DATE% %TIME%] lock created, stopping vLLM to free GPU >> "%LOG%"
wsl -d Ubuntu-24.04 -u root pkill -f "vllm serve" >> "%LOG%" 2>&1
wsl -d Ubuntu-24.04 -u root sleep 12 >> "%LOG%" 2>&1

echo [%DATE% %TIME%] starting train-lora.sh (QLoRA 30B, ~2-4h) >> "%LOG%"
wsl -d Ubuntu-24.04 -u root bash /mnt/c/Flowvium/scripts/sft/train-unsloth.sh >> "%LOG%" 2>&1
echo [%DATE% %TIME%] training exit code %ERRORLEVEL% >> "%LOG%"

echo [%DATE% %TIME%] removing lock, restarting vLLM >> "%LOG%"
del "C:\Flowvium\logs\lora-training.lock"
schtasks /run /tn "FlowVium-vLLM" >> "%LOG%" 2>&1
echo [%DATE% %TIME%] === LoRA window complete (vLLM restarting) === >> "%LOG%"
