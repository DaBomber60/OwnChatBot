# OwnChatBot Quickstart

Minimal steps to run the app locally with Docker. For full documentation see the main README.

## One‑Line (Linux / macOS)
```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16); \
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml; \
APP_IMAGE=dabomber/ownchatbot:latest docker compose up -d; \
echo "Open: http://localhost:3000"
```

## One‑Line (Windows PowerShell)
```powershell
$Env:POSTGRES_PASSWORD = -join ((48..57 + 97..102) | Get-Random -Count 32 | % {[char]$_})
Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml
$Env:APP_IMAGE = 'dabomber/ownchatbot:latest'
docker compose up -d
Write-Host 'Open: http://localhost:3000'
```

## Scripted (Recommended for Persistence)
Clone the repo (or download release assets) and run one of:

```bash
./quickstart.sh
```
```powershell
./quickstart.ps1
```
```bat
quickstart.bat
```

Scripts will:
- Download compose file if missing
- Create `.env` with random Postgres password (idempotent)
- Start containers & poll health

## Environment / Overrides
Set (export) before `docker compose up` or place in `.env`:

| Variable | Purpose | Default |
|----------|---------|---------|
| POSTGRES_DB | Database name | ownchatbot |
| POSTGRES_USER | Database user | ownchatbot |
| POSTGRES_PASSWORD | DB password | ownchatbot_secure_password (auto random if using scripts) |
| APP_PORT | Host port for web UI | 3000 |
| APP_IMAGE | Image tag | dabomber/ownchatbot:latest |
| JWT_SECRET | (Optional) Force JWT signing secret | auto-generated & persisted if blank |

## Common Tasks
```bash
docker compose logs -f          # Follow logs
docker compose down             # Stop (data persists)
docker compose down --volumes   # CAUTION: resets data
APP_PORT=4000 docker compose up -d   # Run on alternate port
```

## Backups
Minimal stack does not include automated backups. For scheduled backups + nginx, use the full `docker-compose.yml` in the repo.
