param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$TaskName = 'Molakhas Newsroom',
  [int]$EveryHours = 2
)

$ErrorActionPreference = 'Stop'
$publisher = Join-Path $RepoPath 'scripts\windows\publish-local.ps1'
if (-not (Test-Path $publisher)) { throw "Publisher script not found: $publisher" }

$start = (Get-Date).AddMinutes(2).ToString('HH:mm')
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$publisher`" -RepoPath `"$RepoPath`""

Write-Host "[Molakhas] Installing scheduled task: $TaskName"
Write-Host "[Molakhas] Runs every $EveryHours hour(s), starting at $start"

& schtasks.exe /Create /F /SC HOURLY /MO $EveryHours /ST $start /TN $TaskName /TR $taskCommand | Out-Host
if ($LASTEXITCODE -ne 0) { throw "schtasks failed with exit code $LASTEXITCODE" }

Write-Host '[Molakhas] Task installed successfully.'
Write-Host "[Molakhas] Test it now with: schtasks /Run /TN `"$TaskName`""
