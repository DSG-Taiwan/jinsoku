' Starts eval\tray.ps1 with no console window. Double-click to fire the run; it lives in the system tray.
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\tray.ps1""", 0, False
