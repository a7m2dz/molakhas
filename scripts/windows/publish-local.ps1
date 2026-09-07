param(
  [string]$RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$FccBaseUrl = 'http://127.0.0.1:8082/v1',
  [int]$MaxStories = 8
)

$ErrorActionPreference = 'Stop'
Set-Location $RepoPath

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

# Optional local secrets/settings. Keep them outside Git.
$localEnv = Join-Path $RepoPath '.env.local.ps1'
if (Test-Path $localEnv) {
  . $localEnv
}

Write-Host '[Molakhas] Updating repository...'
git pull --rebase --autostash origin main

if (-not (Test-Path (Join-Path $RepoPath 'node_modules'))) {
  Write-Host '[Molakhas] Installing dependencies...'
  npm install --no-audit --no-fund
}

Write-Host '[Molakhas] Testing FCC...'
npm run fcc:test

Write-Host '[Molakhas] Scanning and generating stories...'
npm run newsroom

Write-Host '[Molakhas] Verifying production build...'
npm run build

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
git push origin main

Write-Host '[Molakhas] Done. Cloudflare will deploy the new commit automatically.'
