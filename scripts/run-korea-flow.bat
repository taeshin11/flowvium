@echo off
cd /d "C:\NoAddsMakingApps\FlowVium"
echo [%date% %time%] start >> "C:\NoAddsMakingApps\FlowVium\logs\korea-flow.log"
"C:\Program Files\nodejs\node.exe" "C:\NoAddsMakingApps\FlowVium\scripts\update-korea-flow.mjs" >> "C:\NoAddsMakingApps\FlowVium\logs\korea-flow.log" 2>&1
echo [%date% %time%] done >> "C:\NoAddsMakingApps\FlowVium\logs\korea-flow.log"