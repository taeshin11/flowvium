' run-report-hidden.vbs — Task Scheduler 용 숨김 실행 래퍼 (2026-06-11 신설).
' run-report.bat 를 직접 action 으로 걸면 실행 내내 cmd 창이 화면에 떠서
' (보고서 생성 수 분) 사용자가 "이상한 창이 계속 뜬다"고 인지하는 문제.
' WshShell.Run 의 windowStyle=0 (숨김) 으로 동일 batch 를 창 없이 실행.
' 주의: bWaitOnReturn=True 라 batch exit code 가 wscript exit code 로 전달됨.
Dim sh, rc
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("""C:\NoAddsMakingApps\FlowVium\scripts\run-report.bat""", 0, True)
WScript.Quit rc
