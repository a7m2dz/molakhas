param(
  [int]$CycleMinutes = 15,
  [int]$HeartbeatMinutes = 5,
  [int]$HealthCheckSeconds = 30
)

$ErrorActionPreference = 'Continue'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimeDir = Join-Path $ProjectRoot '.runtime'
$CycleScript = Join-Path $PSScriptRoot 'molakhas-cycle.ps1'
$LogFile = Join-Path $RuntimeDir 'supervisor.log'
$HeartbeatRepo = Join-Path $RuntimeDir 'heartbeat-repo'

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $LogFile -Append
}

$mutexName = 'Global\MolakhasSupervisor'
try {
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  $hasMutex = $mutex.WaitOne(0, $false)
} catch {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\MolakhasSupervisor')
  $hasMutex = $mutex.WaitOne(0, $false)
}

if (-not $hasMutex) {
  Write-Log 'Another Molakhas supervisor instance is already running. Exiting.'
  exit 0
}

Set-Location $ProjectRoot

if (-not $env:PUBLIC_SITE_URL) { $env:PUBLIC_SITE_URL = 'https://mulakhas.com' }
if (-not $env:OMNIROUTE_BASE_URL) { $env:OMNIROUTE_BASE_URL = 'http://127.0.0.1:20128/v1' }
if (-not $env:OMNIROUTE_API_KEY) { $env:OMNIROUTE_API_KEY = 'sk_omniroute' }
if (-not $env:OMNIROUTE_MODEL) { $env:OMNIROUTE_MODEL = 'auto/smart' }
if (-not $env:OMNIROUTE_FALLBACK_MODEL) { $env:OMNIROUTE_FALLBACK_MODEL = 'auto' }
if (-not $env:OMNIROUTE_TIMEOUT_MS) { $env:OMNIROUTE_TIMEOUT_MS = '60000' }

function Test-OmniRoute {
  try {
    $headers = @{ Authorization = "Bearer $($env:OMNIROUTE_API_KEY)" }
    $null = Invoke-RestMethod -Uri "$($env:OMNIROUTE_BASE_URL)/models" -Headers $headers -Method Get -TimeoutSec 5
    return $true
  } catch {
    return $false
  }
}

function Start-OmniRouteIfNeeded {
  if (Test-OmniRoute) { return $true }

  $command = Get-Command omniroute -ErrorAction SilentlyContinue
  if (-not $command) {
    Write-Log 'OmniRoute command was not found in PATH. Supervisor will keep retrying.'
    return $false
  }

  $cmdExe = $env:ComSpec
  if (-not $cmdExe) { $cmdExe = "$env:SystemRoot\System32\cmd.exe" }

  Write-Log 'OmniRoute is not responding. Starting local OmniRoute with --no-open.'
  try {
    Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/s', '/c', 'omniroute --no-open') -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
  } catch {
    Write-Log "Failed to start OmniRoute: $($_.Exception.Message)"
    return $false
  }

  for ($attempt = 1; $attempt -le 90; $attempt++) {
    Start-Sleep -Seconds 2
    if (Test-OmniRoute) {
      Write-Log 'OmniRoute API is healthy.'
      return $true
    }
  }

  Write-Log 'OmniRoute did not become healthy within 180 seconds.'
  return $false
}

function Publish-Heartbeat {
  try {
    New-Item -ItemType Directory -Force -Path $HeartbeatRepo | Out-Null

    if (-not (Test-Path (Join-Path $HeartbeatRepo '.git'))) {
      & git -C $HeartbeatRepo init | Out-Null
      $remote = (& git -C $ProjectRoot remote get-url origin 2>$null).Trim()
      if (-not $remote) { throw 'Git origin remote is not configured.' }
      & git -C $HeartbeatRepo remote add origin $remote | Out-Null
      & git -C $HeartbeatRepo config user.name 'molakhas-windows[bot]' | Out-Null
      & git -C $HeartbeatRepo config user.email 'actions@users.noreply.github.com' | Out-Null
    }

    & git -C $HeartbeatRepo fetch --depth=1 origin windows-heartbeat 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      & git -C $HeartbeatRepo checkout -B windows-heartbeat FETCH_HEAD 2>$null | Out-Null
    } else {
      & git -C $HeartbeatRepo checkout --orphan windows-heartbeat 2>$null | Out-Null
      Get-ChildItem -Force $HeartbeatRepo | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    $payload = [ordered]@{
      source = 'windows-primary'
      updatedAt = (Get-Date).ToUniversalTime().ToString('o')
      project = 'molakhas'
      omnirouteHealthy = [bool](Test-OmniRoute)
    } | ConvertTo-Json -Depth 3

    $heartbeatPath = Join-Path $HeartbeatRepo 'heartbeat.json'
    [System.IO.File]::WriteAllText($heartbeatPath, $payload + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

    & git -C $HeartbeatRepo add heartbeat.json | Out-Null
    & git -C $HeartbeatRepo commit -m "heartbeat: windows primary $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')) UTC" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return }

    & git -C $HeartbeatRepo push --force origin HEAD:windows-heartbeat 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Log 'Published Windows-primary heartbeat.'
    } else {
      Write-Log 'Heartbeat push failed; cloud fallback will remain eligible.'
    }
  } catch {
    Write-Log "Heartbeat error: $($_.Exception.Message)"
  }
}

Write-Log "Molakhas supervisor started. Project=$ProjectRoot Cycle=${CycleMinutes}m Heartbeat=${HeartbeatMinutes}m"

$nextHealthCheck = Get-Date
$nextHeartbeat = Get-Date
$nextCycle = Get-Date
$publisherProcess = $null

try {
  while ($true) {
    $now = Get-Date

    if ($now -ge $nextHealthCheck) {
      $null = Start-OmniRouteIfNeeded
      $nextHealthCheck = (Get-Date).AddSeconds([Math]::Max(10, $HealthCheckSeconds))
    }

    if ($now -ge $nextHeartbeat) {
      Publish-Heartbeat
      $nextHeartbeat = (Get-Date).AddMinutes([Math]::Max(2, $HeartbeatMinutes))
    }

    if ($publisherProcess -and $publisherProcess.HasExited) {
      Write-Log "Publisher cycle exited with code $($publisherProcess.ExitCode)."
      $publisherProcess.Dispose()
      $publisherProcess = $null
    }

    if (-not $publisherProcess -and $now -ge $nextCycle) {
      if (Test-OmniRoute) {
        Write-Log 'Starting publisher cycle.'
        $publisherProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', "`"$CycleScript`""
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
        $nextCycle = (Get-Date).AddMinutes([Math]::Max(5, $CycleMinutes))
      } else {
        Write-Log 'Publisher cycle postponed because OmniRoute is not healthy.'
        $nextCycle = (Get-Date).AddMinutes(2)
      }
    }

    Start-Sleep -Seconds 10
  }
} finally {
  if ($hasMutex) {
    try { $mutex.ReleaseMutex() | Out-Null } catch {}
  }
  $mutex.Dispose()
}
