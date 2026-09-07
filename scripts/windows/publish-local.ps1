param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$FccBaseUrl = 'http://127.0.0.1:8082/v1',
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

Write-Host "[Molakhas] Repo: $RepoPath"
Write-Host "[Molakhas] FCC:  $FccBaseUrl"

$env:FCC_BASE_URL = $FccBaseUrl
$env:NEWSROOM_MAX_STORIES = "$MaxStories"
$env:NEWSROOM_MAX_AGE_HOURS = '72'
$env:AUTO_PUBLISH_ENABLED = 'true'
$env:AUTO_PUBLISH_MIN_SCORE = '88'
$env:AUTO_PUBLISH_MIN_TRUST = '88'
$env:AUTO_PUBLISH_MIN_CONFIDENCE = '78'
$env:FCC_TIMEOUT_MS = '60000'

# Optional local secrets/settings. This file is ignored by Git.
$localEnv = Join-Path $RepoPath '.env.local.ps1'
if (Test-Path $localEnv) {
  . $localEnv
}

function Test-FccPort {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $task = $client.ConnectAsync('127.0.0.1', 8082)
    if (-not $task.Wait(1500)) { $client.Dispose(); return $false }
    $ok = $client.Connected
    $client.Dispose()
    return $ok
  } catch { return $false }
}

if (-not (Test-FccPort)) {
  Write-Host '[Molakhas] FCC is not running. Trying to start fcc-server...'
  $fcc = Get-Command fcc-server -ErrorAction SilentlyContinue
  if (-not $fcc) {
    throw 'fcc-server is not available in PATH. Start FCC manually before the scheduled run.'
  }
  Start-Process -FilePath $fcc.Source -WindowStyle Hidden
  $ready = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if (Test-FccPort) { $ready = $true; break }
  }
  if (-not $ready) { throw 'FCC did not become ready on port 8082.' }
}

Invoke-Checked 'Updating repository...' { git pull --rebase --autostash origin main }

if (-not (Test-Path (Join-Path $RepoPath 'node_modules'))) {
  Invoke-Checked 'Installing dependencies...' { npm install --no-audit --no-fund }
}

Invoke-Checked 'Testing FCC...' { npm run fcc:test }
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
git commit -m "newsroom: local FCC batch $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
if ($LASTEXITCODE -ne 0) { throw "git commit failed with exit code $LASTEXITCODE" }
git push origin main
if ($LASTEXITCODE -ne 0) { throw "git push failed with exit code $LASTEXITCODE" }

Write-Host '[Molakhas] Done. Cloudflare will deploy the new commit automatically.'
