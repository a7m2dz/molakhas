$ErrorActionPreference = 'Continue'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $ProjectRoot

if (-not $env:PUBLIC_SITE_URL) { $env:PUBLIC_SITE_URL = 'https://mulakhas.com' }
if (-not $env:OMNIROUTE_BASE_URL) { $env:OMNIROUTE_BASE_URL = 'http://127.0.0.1:20128/v1' }

if (-not $env:OMNIROUTE_API_KEY) {
  $storedApiKey = [Environment]::GetEnvironmentVariable('OMNIROUTE_API_KEY', 'User')
  if ($storedApiKey) { $env:OMNIROUTE_API_KEY = $storedApiKey }
}
if (-not $env:OMNIROUTE_API_KEY) {
  Write-Error 'OMNIROUTE_API_KEY is missing. Set it in .env.local.ps1 or Windows User environment before running Molakhas.'
  exit 2
}

$env:OMNIROUTE_MODEL = 'auto/best-free'
if (-not $env:OMNIROUTE_FALLBACK_MODEL) { $env:OMNIROUTE_FALLBACK_MODEL = 'auto' }
if (-not $env:OMNIROUTE_TIMEOUT_MS) { $env:OMNIROUTE_TIMEOUT_MS = '90000' }

& node (Join-Path $PSScriptRoot 'windows-publisher.mjs')
exit $LASTEXITCODE
