$ErrorActionPreference = 'Continue'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$RuntimeDir = Join-Path $ProjectRoot '.runtime'
$LogFile = Join-Path $RuntimeDir 'publisher.log'
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Set-Location $ProjectRoot

if (-not $env:PUBLIC_SITE_URL) { $env:PUBLIC_SITE_URL = 'https://mulakhas.com' }
if (-not $env:OMNIROUTE_BASE_URL) { $env:OMNIROUTE_BASE_URL = 'http://127.0.0.1:20128/v1' }
if (-not $env:OMNIROUTE_API_KEY) { $env:OMNIROUTE_API_KEY = 'sk_omniroute' }
if (-not $env:OMNIROUTE_MODEL) { $env:OMNIROUTE_MODEL = 'auto/smart' }
if (-not $env:OMNIROUTE_FALLBACK_MODEL) { $env:OMNIROUTE_FALLBACK_MODEL = 'auto' }
if (-not $env:OMNIROUTE_TIMEOUT_MS) { $env:OMNIROUTE_TIMEOUT_MS = '60000' }

function Log([string]$Message) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Tee-Object -FilePath $LogFile -Append
}

Log 'Windows newsroom cycle started.'
& npm install --no-audit --no-fund 2>&1 | Tee-Object -FilePath $LogFile -Append
if ($LASTEXITCODE -ne 0) { Log 'npm install failed.'; exit 20 }

& npm run newsroom 2>&1 | Tee-Object -FilePath $LogFile -Append
$newsroomCode = $LASTEXITCODE
if ($newsroomCode -ne 0) { Log "Newsroom returned $newsroomCode; continuing with checkpointed data." }

& npm run build 2>&1 | Tee-Object -FilePath $LogFile -Append
if ($LASTEXITCODE -ne 0) { Log 'Build failed.'; exit 30 }

& npm run audit:prelaunch 2>&1 | Tee-Object -FilePath $LogFile -Append
if ($LASTEXITCODE -ne 0) { Log 'Audit failed.'; exit 31 }

Log 'Windows newsroom cycle completed.'
exit 0
