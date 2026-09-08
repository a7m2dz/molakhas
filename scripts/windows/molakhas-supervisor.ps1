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
$PidFile = Join-Path $RuntimeDir 'supervisor.pid'
$HeartbeatRepo = Join-Path $RuntimeDir 'heartbeat-repo'

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $LogFile -Append | Out-Null
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

[System.IO.File]::WriteAllText($PidFile, [string]$PID)
Set-Location $ProjectRoot

if (-not $env:PUBLIC_SITE_URL) { $env:PUBLIC_SITE_URL = 'https://mulakhas.com' }
if (-not $env:OMNIROUTE_BASE_URL) { $env:OMNIROUTE_BASE_URL = 'http://127.0.0.1:20128/v1' }
if (-not $env:OMNIROUTE_API_KEY) { $env:OMNIROUTE_API_KEY = 'sk_omniroute' }
$env:OMNIROUTE_MODEL = 'auto/best-free'
if (-not $env:OMNIROUTE_FALLBACK_MODEL) { $env:OMNIROUTE_FALLBACK_MODEL = 'auto' }
if (-not $env:OMNIROUTE_TIMEOUT_MS) { $env:OMNIROUTE_TIMEOUT_MS = '60000' }
$env:HOSTNAME = '127.0.0.1'
$env:OMNIROUTE_SERVER_HOST = '127.0.0.1'
$env:REQUIRE_API_KEY = 'false'

function Test-OmniRoutePort {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $wait = $client.BeginConnect('127.0.0.1', 20128, $null, $null)
    $ok = $wait.AsyncWaitHandle.WaitOne(1200, $false)
    if (-not $ok) { $client.Close(); return $false }
    $client.EndConnect($wait)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Invoke-ModelsProbe {
  param([AllowNull()][string]$ApiKey)
  try {
    $params = @{
      Uri = "$($env:OMNIROUTE_BASE_URL)/models"
      Method = 'Get'
      TimeoutSec = 5
      ErrorAction = 'Stop'
    }
    if ($ApiKey) { $params.Headers = @{ Authorization = "Bearer $ApiKey" } }
    $null = Invoke-RestMethod @params
    return $true
  } catch {
    return $false
  }
}

function Resolve-OmniRouteAuth {
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($env:OMNIROUTE_API_KEY) { $candidates.Add($env:OMNIROUTE_API_KEY) }
  if (-not $candidates.Contains('sk_omniroute')) { $candidates.Add('sk_omniroute') }
  $candidates.Add('')

  foreach ($candidate in $candidates) {
    if (Invoke-ModelsProbe -ApiKey $candidate) {
      $env:OMNIROUTE_API_KEY = $candidate
      if ($candidate) {
        Write-Log "OmniRoute API is healthy using bearer authentication. Model=$($env:OMNIROUTE_MODEL)"
      } else {
        Write-Log "OmniRoute API is healthy without bearer authentication. Model=$($env:OMNIROUTE_MODEL)"
      }
      return $true
    }
  }
  return $false
}

function Start-OmniRouteIfNeeded {
  if (Resolve-OmniRouteAuth) { return $true }

  if (Test-OmniRoutePort) {
    Write-Log 'OmniRoute port 20128 is listening, but /v1/models authentication/readiness is not healthy yet. Not starting a duplicate process.'
    return $false
  }

  $command = Get-Command omniroute -ErrorAction SilentlyContinue
  if (-not $command) {
    Write-Log 'OmniRoute command was not found in PATH. Supervisor will keep retrying.'
    return $false
  }

  $cmdExe = $env:ComSpec
  if (-not $cmdExe) { $cmdExe = "$env:SystemRoot\System32\cmd.exe" }

  Write-Log 'OmniRoute is offline. Starting local OmniRoute with --no-open on 127.0.0.1.'
  try {
    Start-Process -FilePath $cmdExe -ArgumentList @('/d', '/s', '/c', 'omniroute --no-open') -WorkingDirectory $ProjectRoot -WindowStyle Hidden | Out-Null
  } catch {
    Write-Log "Failed to start OmniRoute: $($_.Exception.Message)"
    return $false
  }

  for ($attempt = 1; $attempt -le 90; $attempt++) {
    Start-Sleep -Seconds 2
    if (Resolve-OmniRouteAuth) { return $true }
  }

  Write-Log 'OmniRoute did not become API-ready within 180 seconds.'
  return $false
}

function Publish-Heartbeat {
  param([bool]$OmniHealthy)
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
      omnirouteHealthy = [bool]$OmniHealthy
      model = $env:OMNIROUTE_MODEL
    } | ConvertTo-Json -Depth 3

    $heartbeatPath = Join-Path $HeartbeatRepo 'heartbeat.json'
    [System.IO.File]::WriteAllText($heartbeatPath, $payload + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

    & git -C $HeartbeatRepo add heartbeat.json | Out-Null
    & git -C $HeartbeatRepo commit -m "heartbeat: windows primary $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')) UTC" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return }

    & git -C $HeartbeatRepo push --force origin HEAD:windows-heartbeat 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Log "Published Windows-primary heartbeat. healthy=$OmniHealthy model=$($env:OMNIROUTE_MODEL)"
    } else {
      Write-Log 'Heartbeat push failed; cloud fallback will remain eligible.'
    }
  } catch {
    Write-Log "Heartbeat error: $($_.Exception.Message)"
  }
}

Write-Log "Molakhas supervisor started. Project=$ProjectRoot Cycle=${CycleMinutes}m Heartbeat=${HeartbeatMinutes}m Model=$($env:OMNIROUTE_MODEL) PID=$PID"

$nextHealthCheck = Get-Date
$nextHeartbeat = Get-Date
$nextCycle = Get-Date
$publisherProcess = $null
$omniHealthy = $false

try {
  while ($true) {
    $now = Get-Date

    if ($now -ge $nextHealthCheck) {
      $omniHealthy = [bool](Start-OmniRouteIfNeeded)
      $nextHealthCheck = (Get-Date).AddSeconds([Math]::Max(10, $HealthCheckSeconds))
    }

    if ($now -ge $nextHeartbeat) {
      Publish-Heartbeat -OmniHealthy $omniHealthy
      $nextHeartbeat = (Get-Date).AddMinutes([Math]::Max(2, $HeartbeatMinutes))
    }

    if ($publisherProcess -and $publisherProcess.HasExited) {
      Write-Log "Publisher cycle exited with code $($publisherProcess.ExitCode)."
      $publisherProcess.Dispose()
      $publisherProcess = $null
    }

    if (-not $publisherProcess -and $now -ge $nextCycle) {
      if ($omniHealthy) {
        Write-Log "Starting publisher cycle with model=$($env:OMNIROUTE_MODEL)."
        $publisherProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
          '-NoProfile',
          '-ExecutionPolicy', 'Bypass',
          '-File', "`"$CycleScript`""
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru
        $nextCycle = (Get-Date).AddMinutes([Math]::Max(5, $CycleMinutes))
      } else {
        Write-Log 'Publisher cycle postponed because OmniRoute API is not healthy.'
        $nextCycle = (Get-Date).AddMinutes(2)
      }
    }

    Start-Sleep -Seconds 10
  }
} finally {
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
  if ($hasMutex) {
    try { $mutex.ReleaseMutex() | Out-Null } catch {}
  }
  $mutex.Dispose()
}
