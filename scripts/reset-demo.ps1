# Resets the demo data to the seeded baseline - the "between takes" button.
# Preserved across resets: real AI spend history, the weekly briefing, API keys.
# Takes ~2 minutes (KB embeddings rebuild). Run while servers stay up.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

Write-Host '== METS demo reset ==' -ForegroundColor Cyan
Push-Location "$repo\server"
try {
    npm run db:seed
    if ($LASTEXITCODE -ne 0) { throw 'seed failed' }
} finally { Pop-Location }

$health = Invoke-RestMethod http://localhost:3001/api/health -TimeoutSec 5
Write-Host ''
Write-Host ("READY - db {0}, adapters: ai={1} mail={2}" -f $health.ok, $health.adapters.ai, $health.adapters.mail) -ForegroundColor Green
Write-Host 'Refresh any open browser tabs (Ctrl+F5) before the next take.'
