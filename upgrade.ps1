<#!
.SYNOPSIS
  Upgrade script for OwnChatBot (PowerShell).
.DESCRIPTION
  Ensures a compose file exists (downloads minimal one if missing), pulls the latest image,
  and recreates the app container while preserving volumes.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host '==> OwnChatBot Upgrade (PowerShell)' -ForegroundColor Cyan

$composeFileUrl = 'https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error 'Docker is required. Install Docker Desktop first.'
}

$composeCmd = if ((docker compose version) 2>$null) { 'docker compose' } elseif (Get-Command docker-compose -ErrorAction SilentlyContinue) { 'docker-compose' } else { throw 'Docker Compose not found.' }

# Resolve compose file (download if missing)
if (-not (Test-Path 'docker-compose.yml') -and -not (Test-Path 'docker-compose.simple.yml')) {
  Write-Host 'Compose file not found. Downloading minimal compose file...'
  Invoke-WebRequest $composeFileUrl -OutFile 'docker-compose.yml'
  $composeFile = 'docker-compose.yml'
}
else {
  if (Test-Path 'docker-compose.yml') { $composeFile = 'docker-compose.yml' } else { $composeFile = 'docker-compose.simple.yml' }
}

if (-not $Env:APP_IMAGE) { $Env:APP_IMAGE = 'dabomber/ownchatbot:latest' }
if (-not $Env:COMPOSE_PROJECT_NAME) { $Env:COMPOSE_PROJECT_NAME = 'ownchatbot' }

Write-Host "Using compose file: $composeFile"
Write-Host "Pulling latest image for: $($Env:APP_IMAGE)" -ForegroundColor Yellow

# Attempt targeted pull; fall back to full pull if service name mismatch
try {
  & $composeCmd -f $composeFile pull app | Write-Host
}
catch {
  & $composeCmd -f $composeFile pull | Write-Host
}

Write-Host 'Recreating container(s)...'
try {
  & $composeCmd -f $composeFile up -d app | Write-Host
}
catch {
  & $composeCmd -f $composeFile up -d | Write-Host
}

Write-Host 'Upgrade complete. Current containers:' -ForegroundColor Green
& $composeCmd -f $composeFile ps | Write-Host
