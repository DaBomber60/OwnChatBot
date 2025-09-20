# OwnChatBot Docker Image

Self‑hostable AI chat + persona + character management web application.

Repository: https://github.com/dabomber60/ownchatbot
Image: `dabomber/ownchatbot:latest`

## Features (Brief)
- Character & persona system
- Variant, edit, continue responses
- Session notes + summaries (incremental)
- Import / export data
- PostgreSQL + Prisma
- JWT auth with setup & password change

## Quick Start (Two Containers via Compose)

### Linux / macOS One‑Liner (Creates .env)
```bash
PW=$(openssl rand -hex 16); \
printf "POSTGRES_PASSWORD=%s\nCOMPOSE_PROJECT_NAME=ownchatbot\nAPP_IMAGE=dabomber/ownchatbot:latest\n" "$PW" > .env; \
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml; \
docker compose up -d; \
echo "Open: http://localhost:3000"
```

### Windows PowerShell One‑Liner (Creates .env)
Multi-line (recommended for readability):
```powershell
$pw = -join ((48..57 + 97..102) | Get-Random -Count 32 | % {[char]$_})
@"
POSTGRES_PASSWORD=$pw
COMPOSE_PROJECT_NAME=ownchatbot
APP_IMAGE=dabomber/ownchatbot:latest
"@ | Set-Content .env
Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml
docker compose up -d
Write-Host 'Open: http://localhost:3000'
```

Pure single-line variant (copy/paste friendly):
```powershell
$pw = -join ((48..57 + 97..102) | Get-Random -Count 32 | % {[char]$_}); "POSTGRES_PASSWORD=$pw`nCOMPOSE_PROJECT_NAME=ownchatbot`nAPP_IMAGE=dabomber/ownchatbot:latest`n" | Out-File -Encoding utf8 .env; Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml; docker compose up -d; Write-Host 'Open: http://localhost:3000'
```

This starts:
- postgres (16-alpine)
- app (OwnChatBot) — depends_on Postgres health

Compose automatically creates a dedicated network; the app reaches Postgres via hostname `postgres`.

The project (stack) name is set to `ownchatbot` above via `COMPOSE_PROJECT_NAME` by default. If you host multiple instances, change this value per instance.

### Quickstart Scripts
Download from Releases or clone repo, then run:
```
./quickstart.sh   # or
./quickstart.ps1  # or quickstart.bat
```
They create a `.env` with a random `POSTGRES_PASSWORD` plus `COMPOSE_PROJECT_NAME` and `APP_IMAGE`, then start containers. (Quickstart scripts additionally poll `/api/health`.)

## Environment Variables
Place in `.env` or export before `docker compose up`.

| Name | Description | Default / Behavior |
|------|-------------|--------------------|
| POSTGRES_DB | Database name | ownchatbot |
| POSTGRES_USER | DB user | ownchatbot |
| POSTGRES_PASSWORD | DB password | Required (scripts auto-generate) |
| APP_PORT | Host port to expose app | 3000 |
| APP_IMAGE | Image to deploy | dabomber/ownchatbot:latest |
| JWT_SECRET | Optional static JWT secret | Auto-generated & persisted inside volume if unset |
| TZ | Timezone (backup stack only) | UTC |

## Data Persistence
Named volumes:
- `ownchatbot_pg_data` – PostgreSQL data
- `ownchatbot_app_data` – App data (JWT secret, future local artifacts)

Remove with caution:
```bash
docker compose down --volumes   # Destroys ALL data
```

## Upgrading
Always use the same project name you used at initial creation so Compose recognizes existing containers (avoids a name conflict with the fixed `container_name: ownchatbot`). The installation one-liners already wrote `COMPOSE_PROJECT_NAME=ownchatbot` into `.env`.

Upgrade:
```bash
docker compose pull
docker compose up -d
```
Data persists (volumes reused). If schema migrations are needed, the app runs them automatically via Prisma client init.

### Linux / macOS One-Liner
```bash
COMPOSE_PROJECT_NAME=ownchatbot docker compose pull && \
COMPOSE_PROJECT_NAME=ownchatbot docker compose up -d
```

### Windows PowerShell One-Liner
```powershell
$Env:COMPOSE_PROJECT_NAME='ownchatbot'; docker compose pull; docker compose up -d
```

Above commands ensure the same project name so Compose reuses the existing `ownchatbot` container instead of trying to create a second one and failing with a name conflict.

### (Optional) Re-download + Upgrade One-Liners
Use these if you did not customize `docker-compose.simple.yml` locally on first install and no longer have the file on hand.

Linux / macOS:
```bash
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml && \
COMPOSE_PROJECT_NAME=ownchatbot docker compose pull && \
COMPOSE_PROJECT_NAME=ownchatbot docker compose up -d
```

Windows PowerShell:
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml
$Env:COMPOSE_PROJECT_NAME='ownchatbot'
docker compose pull
docker compose up -d
```

## Changing Port
```bash
APP_PORT=4000 docker compose up -d
```
Open: http://localhost:4000

## Manual docker run (NOT recommended compared to compose)
You would need to create a network, run Postgres, then run the app container pointing to it.
Compose simplifies all of this; use only if constrained.

## Backups
Minimal stack: use `pg_dump` manually:
```bash
docker compose exec postgres pg_dump -U ownchatbot ownchatbot > backup.sql
```
Full stack (`docker-compose.yml`) includes a scheduled backup sidecar.

## Resetting / Rotating Auth
- Delete `ownchatbot_app_data` volume to force new JWT secret (logs out users)
- Or set `JWT_SECRET` explicitly for multi-replica setups

## Troubleshooting
| Symptom | Action |
|---------|--------|
| App not healthy | `docker compose logs app` |
| DB auth errors | Ensure same password in `.env` & existing volume (changing password after creation requires updating inside DB) |
| Port in use | Set `APP_PORT` to another value |
| Need clean slate | `docker compose down --volumes` (data loss) |

## License
GPL-3.0 license
