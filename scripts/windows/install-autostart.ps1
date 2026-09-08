$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Supervisor = Join-Path $PSScriptRoot 'molakhas-supervisor.ps1'
$RuntimeDir = Join-Path $ProjectRoot '.runtime'
$PidFile = Join-Path $RuntimeDir 'supervisor.pid'
$TaskName = 'Molakhas Supervisor'
$User = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path $Supervisor)) {
  throw "Supervisor script not found: $Supervisor"
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 2

# Stop only stale Molakhas supervisor processes, never unrelated PowerShell sessions.
$escapedSupervisor = [Regex]::Escape($Supervisor)
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match $escapedSupervisor } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      Write-Host "Stopped stale Molakhas supervisor PID $($_.ProcessId)." -ForegroundColor Yellow
    } catch {}
  }

# Restart only the process currently listening on OmniRoute's local port so the
# new supervisor can relaunch it with the expected host/auth environment.
Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    try {
      Stop-Process -Id $_ -Force -ErrorAction Stop
      Write-Host "Stopped stale OmniRoute listener PID $_ on port 20128." -ForegroundColor Yellow
    } catch {}
  }

if (Test-Path $PidFile) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }

$PowerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Supervisor`""
$Action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $Arguments -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$Task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description 'Keeps OmniRoute and the Molakhas Windows publisher alive after Windows logon/restart.'
Register-ScheduledTask -TaskName $TaskName -InputObject $Task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'Molakhas autostart installed successfully.' -ForegroundColor Green
Write-Host "Task: $TaskName"
Write-Host "Project: $ProjectRoot"
Write-Host 'The supervisor is now running and will start automatically at every Windows logon.'
Write-Host "Logs: $ProjectRoot\.runtime\supervisor.log"
