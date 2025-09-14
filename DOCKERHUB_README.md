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

### Linux / macOS One‑Liner
```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16); \
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml; \
APP_IMAGE=dabomber/ownchatbot:latest docker compose up -d; \
echo "Open: http://localhost:3000"
```

### Windows PowerShell One‑Liner
```powershell
$Env:POSTGRES_PASSWORD = -join ((48..57 + 97..102) | Get-Random -Count 32 | % {[char]$_})
Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml
$Env:APP_IMAGE = 'dabomber/ownchatbot:latest'
docker compose up -d
Write-Host 'Open: http://localhost:3000'
```

This starts:
- postgres (16-alpine)
- app (OwnChatBot) — depends_on Postgres health

Compose automatically creates a dedicated network; the app reaches Postgres via hostname `postgres`.

### Quickstart Scripts
Download from Releases or clone repo, then run:
```
./quickstart.sh   # or
./quickstart.ps1  # or quickstart.bat
```
They create a `.env` (if absent) with a random `POSTGRES_PASSWORD`, start containers, and poll `/api/health`.

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
Named volumes (from compose file):
- `ownchatbot_pg_data` – PostgreSQL data
- `ownchatbot_app_data` – App data (JWT secret, future local artifacts)

Remove with caution:
```bash
docker compose down --volumes   # Destroys ALL data
```

## Upgrading
```bash
docker compose pull
docker compose up -d
```
Data persists (volumes reused). If schema migrations are needed, the app runs them automatically via Prisma client init.

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
See repository LICENSE file.
