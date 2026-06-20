@echo off
REM FlowVium-SFTMonitor - SFT stall/crash detector, runs monitor-sft.sh every 15min during training.
REM ASCII + CRLF (cmd parser). Removed automatically when SFT done (lock OFF -> monitor exits idle).
wsl -d Ubuntu-24.04 -u root bash /mnt/d/Flowvium/scripts/sft/monitor-sft.sh >> "D:\Flowvium\logs\sft-monitor-run.log" 2>&1
