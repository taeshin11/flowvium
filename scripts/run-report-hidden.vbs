' run-report-hidden.vbs - hidden launcher for Task Scheduler (2026-06-11).
' Running run-report.bat directly shows a cmd window for the whole run (minutes).
' WshShell.Run with windowStyle=0 runs the same batch with no visible window.
' bWaitOnReturn=True so the batch exit code propagates as the wscript exit code.
' 2026-06-18: kept ASCII to avoid CP949/UTF-8 mis-decode breaking the launcher (see run-report.bat).
Dim sh, rc
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("""C:\Flowvium\scripts\run-report.bat""", 0, True)
WScript.Quit rc
