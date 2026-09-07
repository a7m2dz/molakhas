param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$OmniRouteBaseUrl = 'http://127.0.0.1:20128/v1',
  [int]$MaxStories = 8
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoPath

function Invoke-Checked {
  param(
    [Parameter(Mandatory=$true)][string]$Label,
    [Parameter(Mandatory=$true)][scriptblock]$Command
  )
  Write-Host "[Molakhas] $Label"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

Write-Host "[Molakhas] Repo:      $RepoPath"
Write-Host "[Molakhas] OmniRoute: $OmniRouteBaseUrl"

$env:OMNIROUTE_BASE_URL = $OmniRouteBaseUrl
$env:OMNIROUTE_MODEL = if ($env:OMNIROUTE_MODEL) { $env:OMNIROUTE_MODEL } else { 'auto/best-free' }
$env:OMNIROUTE_FALLBACK_MODEL = if ($env:OMNIROUTE_FALLBACK_MODEL) { $env:OMNIROUTE_FALLBACK_MODEL } else { 'auto' }
$env:OMNIROUTE_TIMEOUT_MS = if ($env:OMNIROUTE_TIMEOUT_MS) { $env:OMNIROUTE_TIMEOUT_MS } else { '120000' }
$env:NEWSROOM_MAX_STORIES = "$MaxStories"
$env:NEWSROOM_MAX_AGE_HOURS = '72'
$env:AUTO_PUBLISH_ENABLED = 'true'
$env:AUTO_PUBLISH_MIN_SCORE = '88'
$env:AUTO_PUBLISH_MIN_TRUST = '88'
$env:AUTO_PUBLISH_MIN_CONFIDENCE = '78'

# Optional local secrets/settings. This file is ignored by Git.
$localEnv = Join-Path $RepoPath '.env.local.ps1'
if (Test-Path $localEnv) {
  . $localEnv
}

function Test-OmniRoutePort {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $task = $client.ConnectAsync('127.0.0.1', 20128)
    if (-not $task.Wait(1500)) { $client.Dispose(); return $false }
    $ok = $client.Connected
    $client.Dispose()
    return $ok
  } catch { return $false }
}

if (-not (Test-OmniRoutePort)) {
  Write-Host '[Molakhas] OmniRoute is not running. Trying to start it...'
  $omni = Get-Command omniroute -ErrorAction SilentlyContinue
  if (-not $omni) {
    throw 'omniroute is not available in PATH. Start OmniRoute manually, then rerun this script.'
  }
  Start-Process -FilePath $omni.Source -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-OmniRoutePort) { $ready = $true; break }
  }
  if (-not $ready) { throw 'OmniRoute did not become ready on port 20128.' }
}

Invoke-Checked 'Updating repository...' { git pull --rebase --autostash origin main }

if (-not (Test-Path (Join-Path $RepoPath 'node_modules'))) {
  Invoke-Checked 'Installing dependencies...' { npm install --no-audit --no-fund }
}

Invoke-Checked 'Testing OmniRoute...' { npm run omniroute:test }
Invoke-Checked 'Scanning and generating stories...' { npm run newsroom }
Invoke-Checked 'Verifying production build...' { npm run build }

$changes = git status --porcelain -- src/data/stories.json
if (-not $changes) {
  Write-Host '[Molakhas] No new story changes. Nothing to push.'
  exit 0
}

Write-Host '[Molakhas] Publishing generated stories to GitHub...'
git config user.name 'molakhas-local-newsroom'
git config user.email 'molakhas-local@users.noreply.github.com'
git add src/data/stories.json
git commit -m "newsroom: OmniRoute batch $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
if ($LASTEXITCODE -ne 0) { throw "git commit failed with exit code $LASTEXITCODE" }
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed with exit code $LASTEXITCODE" }

Write-Host '[Molakhas] Done. Cloudflare will deploy the new commit automatically.'
