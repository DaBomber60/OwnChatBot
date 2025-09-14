Param(
    [switch]$Rebuild,
    [switch]$Nginx,
    [switch]$Logs
)

Write-Host "Starting OwnChatBot via Docker Compose..." -ForegroundColor Cyan

$composeArgs = @('compose')
if ($Rebuild) { $composeArgs += 'build' ; $composeArgs += '--no-cache' ; & docker @composeArgs ; $composeArgs = @('compose') }

$upArgs = @('compose','up','-d')
if ($Rebuild) { $upArgs += '--build' }
if ($Nginx) { $upArgs += '--profile' ; $upArgs += 'nginx' }

& docker $upArgs
if ($LASTEXITCODE -ne 0) { Write-Error 'docker compose up failed'; exit 1 }

Write-Host "Containers are starting. Health checks may take ~30s." -ForegroundColor Yellow

if ($Logs) {
    Write-Host "Tailing logs (Ctrl+C to exit)" -ForegroundColor Green
    docker compose logs -f
}
