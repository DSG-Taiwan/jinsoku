# Runs eval\nightshift-real.ts hidden and reports from the system tray.
# The tray icon shows progress on hover, pops a balloon when a person has to act, and when the run ends.
param([string]$Script = "eval/nightshift-real.ts")
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$results = Join-Path $root "eval\results"
New-Item -ItemType Directory -Force $results | Out-Null
$progressFile = Join-Path $results "nightshift-real.progress.json"
$logFile = Join-Path $results "nightshift-real.log"
Remove-Item $progressFile -ErrorAction SilentlyContinue

$cli = Join-Path $root "node_modules\tsx\dist\cli.mjs"
$proc = Start-Process -FilePath "node" -ArgumentList "`"$cli`" `"$Script`"" -WorkingDirectory $root `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.SystemIcons]::Information
$tray.Visible = $true
$tray.Text = "Nightshift run: starting"
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$status = $menu.Items.Add("Starting")
$status.Enabled = $false
$open = $menu.Items.Add("Open results folder")
$open.add_Click({ Start-Process explorer.exe $results })
$stop = $menu.Items.Add("Stop run and exit")
$tray.ContextMenuStrip = $menu

$script:last = ""
$script:finished = $false
function Say([string]$state, [string]$text, [System.Windows.Forms.ToolTipIcon]$icon) {
  $short = if ($text.Length -gt 60) { $text.Substring(0, 60) } else { $text }
  $tray.Text = $short
  $status.Text = $text
  if ($state -ne $script:last) {
    $script:last = $state
    if ($state -in @("needs-hitl", "done", "failed")) {
      $title = switch ($state) { "needs-hitl" { "Needs you" } "done" { "Run finished" } default { "Run failed" } }
      $tray.ShowBalloonTip(15000, $title, $text, $icon)
    }
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
  if ($script:finished) { return }
  $p = $null
  if (Test-Path $progressFile) { try { $p = Get-Content $progressFile -Raw | ConvertFrom-Json } catch {} }
  if ($p) {
    $text = "$($p.message) ($($p.done)/$($p.total))"
    $icon = switch ($p.state) { "needs-hitl" { "Warning" } "failed" { "Error" } default { "Info" } }
    Say $p.state $text $icon
    if ($p.state -in @("done", "failed")) { $script:finished = $true }
  }
  if ($proc.HasExited -and -not $script:finished) {
    $script:finished = $true
    if ($p -and $p.state -eq "done") { return }
    Say "failed" "The run stopped without finishing. See eval\results\nightshift-real.log.err" "Error"
  }
})
$stop.add_Click({
  $timer.Stop()
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})
$tray.add_BalloonTipClicked({ Start-Process explorer.exe $results })
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Dispose()
