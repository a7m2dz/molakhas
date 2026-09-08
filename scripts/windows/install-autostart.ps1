$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Supervisor = Join-Path $PSScriptRoot 'molakhas-supervisor.ps1'
$TaskName = 'Molakhas Supervisor'
$User = "$env:USERDOMAIN\$env:USERNAME"

if (-not (Test-Path $Supervisor)) {
  throw "Supervisor script not found: $Supervisor"
}

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
