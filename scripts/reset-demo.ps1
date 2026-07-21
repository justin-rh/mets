# Resets the demo data to the seeded baseline - the "between takes" button.
# Preserved across resets: real AI spend history, the weekly briefing, API keys.
# Takes ~2 minutes (KB embeddings rebuild). Run while servers stay up.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

Write-Host '== METS demo reset ==' -ForegroundColor Cyan
Push-Location "$repo\server"
try {
    # Sync the schema first — after a git pull the seed may need columns this
    # database has never seen. No-op when already in sync; --force so a
    # confirmation prompt can never hang the script (the data is reseeded
    # from scratch right after anyway).
    npm run db:push -- --force
    if ($LASTEXITCODE -ne 0) { throw 'db:push failed' }
    npm run db:seed
    if ($LASTEXITCODE -ne 0) { throw 'seed failed' }
} finally { Pop-Location }

$health = Invoke-RestMethod http://localhost:3001/api/health -TimeoutSec 5
Write-Host ''
Write-Host ("READY - db {0}, adapters: ai={1} mail={2}" -f $health.ok, $health.adapters.ai, $health.adapters.mail) -ForegroundColor Green
Write-Host 'Refresh any open browser tabs (Ctrl+F5) before the next take.'
