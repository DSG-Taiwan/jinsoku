# Keeps the floor board server running on http://localhost:8000 and restarts it if it exits.
# A tray icon shows the state; right-click for Open board / Restart server / Stop. Serves the repo given in -Repo
# (default: the Cursor lane's checkout, which holds the current public/ UI).
param([string]$Repo = (Split-Path -Parent $PSScriptRoot), [int]$Port = 8000)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$cli = Join-Path $Repo "node_modules\tsx\dist\cli.mjs"
$logDir = Join-Path $Repo "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$out = Join-Path $logDir "board-server.log"
$env:PORT = "$Port"
$script:proc = $null
$script:stopping = $false

function Start-Board {
  $script:proc = Start-Process -FilePath "node" -ArgumentList "`"$cli`" src/server.ts" -WorkingDirectory $Repo `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err"
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Application
$tray.Visible = $true
$tray.Text = "Board: starting"
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open board")
$open.add_Click({ Start-Process "http://localhost:$Port" })
$restart = $menu.Items.Add("Restart server")
$restart.add_Click({
  if ($script:proc -and -not $script:proc.HasExited) { Stop-Process -Id $script:proc.Id -Force }
  $script:down = 0
  $tray.Text = "Board: restarting"
  Start-Sleep -Milliseconds 800
  Start-Board
})
$stop = $menu.Items.Add("Stop board and exit")
$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Start-Process "http://localhost:$Port" })

$script:down = 0
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  if ($script:stopping) { return }
  if ($script:proc -eq $null -or $script:proc.HasExited) {
    $script:down += 1
    $tray.Text = "Board: restarting"
    if ($script:down -eq 3) { $tray.ShowBalloonTip(10000, "Board keeps stopping", "See $out.err", [System.Windows.Forms.ToolTipIcon]::Warning) }
    Start-Board
    return
  }
  try {
    $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 3
    $script:down = 0
    $tray.Text = "Board: running on :$Port"
  } catch { $tray.Text = "Board: starting" }
})
$stop.add_Click({
  $script:stopping = $true
  $timer.Stop()
  if ($script:proc -and -not $script:proc.HasExited) { Stop-Process -Id $script:proc.Id -Force }
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
Start-Board
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Dispose()
