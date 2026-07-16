# Boots the full METS stack for demo day: Docker -> Postgres -> API -> web.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File scripts\start-demo.ps1
# Each server opens in its own window so a crash is visible and restartable.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

Write-Host '== METS demo startup ==' -ForegroundColor Cyan

# 1. Docker Desktop
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Starting Docker Desktop...'
    Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    $tries = 0
    while ($tries -lt 30) {
        Start-Sleep 5
        cmd /c "docker info >nul 2>&1"
        if ($LASTEXITCODE -eq 0) { break }
        $tries++
    }
    if ($LASTEXITCODE -ne 0) { throw 'Docker did not come up - start Docker Desktop manually and rerun.' }
}
Write-Host 'Docker: up' -ForegroundColor Green

# 2. Postgres container
$state = cmd /c "docker inspect -f {{.State.Running}} mets-db 2>nul"
if ($state -ne 'true') { docker start mets-db | Out-Null }
$tries = 0
while ($tries -lt 12) {
    cmd /c "docker exec mets-db pg_isready -U mets >nul 2>&1"
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep 5; $tries++
}
if ($LASTEXITCODE -ne 0) { throw 'Postgres did not become ready.' }
Write-Host 'Postgres: ready (mets-db, port 5433)' -ForegroundColor Green

# 3. API server (port 3001) - skip if already listening
$apiUp = $null -ne (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)
if (-not $apiUp) {
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$repo\server'; npm run dev" -WindowStyle Minimized
}
$tries = 0
while ($tries -lt 20) {
    try { Invoke-RestMethod http://localhost:3001/api/health -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 3; $tries++ }
}
$health = Invoke-RestMethod http://localhost:3001/api/health
Write-Host ("API: up (adapters: auth={0} mail={1} ai={2})" -f $health.adapters.auth, $health.adapters.mail, $health.adapters.ai) -ForegroundColor Green
if ($health.adapters.ai -ne 'claude') { Write-Host '  WARNING: AI adapter is not claude - check .env / API key' -ForegroundColor Yellow }

# 4. Web server (port 80) - skip if already listening
$webUp = $null -ne (Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue)
if (-not $webUp) {
    Start-Process powershell -ArgumentList '-NoExit', '-Command', "cd '$repo\web'; npm run dev" -WindowStyle Minimized
    Start-Sleep 6
}
Write-Host 'Web: up (port 80)' -ForegroundColor Green

# 5. Where to point people
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.IPAddress -notmatch '^169\.' } |
    Select-Object -First 1).IPAddress
Write-Host ''
Write-Host 'READY.' -ForegroundColor Cyan
Write-Host "  Local:   http://mets.masterelectronics.com"
Write-Host "  Judges:  http://$lanIp/"
Write-Host "  API doc: http://$lanIp/api/docs"
Write-Host ''
Write-Host 'Reset demo data between takes:  powershell -ExecutionPolicy Bypass -File scripts\reset-demo.ps1'
