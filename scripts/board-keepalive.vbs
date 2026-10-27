' Starts scripts\board-keepalive.ps1 with no console window. Double-click, or put a shortcut to this file in the Startup folder.
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\board-keepalive.ps1""", 0, False
