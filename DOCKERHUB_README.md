# OwnChatBot Docker Image

Self‑hostable AI chat + persona + character management web application.

For feature list and raising bug reports, please head to the GitHub repo.

Repository: https://github.com/dabomber60/ownchatbot  
Image: `dabomber/ownchatbot:latest`

---

## 🚀 Quick Start (Beginner Friendly)

Two containers only: the app + PostgreSQL. Docker Compose handles the network and startup order. In < 1 minute you'll have a running instance at http://localhost:3000.

### Requirements
- Docker Engine (Linux) OR Docker Desktop (macOS / Windows)
- `docker compose` plugin (bundled with recent Docker Desktop / Engine)

No manual DB creation, no schema steps—migrations run automatically on first start.

### 1. Linux / macOS Quickstart

Create a fresh directory (recommended) and run the one‑liner below. It:
1. Generates a secure random Postgres password
2. Writes a `.env`
3. Downloads `docker-compose.simple.yml` as `docker-compose.yml`
4. Starts the stack

```bash
PW=$(openssl rand -hex 16); \
printf "POSTGRES_PASSWORD=%s\nCOMPOSE_PROJECT_NAME=ownchatbot\nAPP_IMAGE=dabomber/ownchatbot:latest\n" "$PW" > .env; \
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml; \
docker compose up -d; \
echo "Open: http://localhost:3000"
```

Example `.env` produced (your password will differ):
```
POSTGRES_PASSWORD=abcdef123456abcdef123456abcdef12
COMPOSE_PROJECT_NAME=ownchatbot
APP_IMAGE=dabomber/ownchatbot:latest
```

Change port (optional) by adding `APP_PORT=4000` to `.env` or prefixing the command: `APP_PORT=4000 docker compose up -d`.

#### Upgrade (Later)
Keep the same `COMPOSE_PROJECT_NAME` so the existing containers & volumes are reused:
```bash
COMPOSE_PROJECT_NAME=ownchatbot docker compose pull && \
COMPOSE_PROJECT_NAME=ownchatbot docker compose up -d
```

Re-download + upgrade in one go (if you lost the compose file and did not customize it):
```bash
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml && \
COMPOSE_PROJECT_NAME=ownchatbot docker compose pull && \
COMPOSE_PROJECT_NAME=ownchatbot docker compose up -d
```

### 2. Windows (PowerShell) Quickstart

Run inside an empty or dedicated folder in Windows PowerShell (not CMD). This multi-line variant is clearer:
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

Single-line (copy/paste):
```powershell
$pw = -join ((48..57 + 97..102) | Get-Random -Count 32 | % {[char]$_}); "POSTGRES_PASSWORD=$pw`nCOMPOSE_PROJECT_NAME=ownchatbot`nAPP_IMAGE=dabomber/ownchatbot:latest`n" | Out-File -Encoding utf8 .env; Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml; docker compose up -d; Write-Host 'Open: http://localhost:3000'
```

Example `.env` produced:
```
POSTGRES_PASSWORD=abcdef123456abcdef123456abcdef12
COMPOSE_PROJECT_NAME=ownchatbot
APP_IMAGE=dabomber/ownchatbot:latest
```

Change port: add `APP_PORT=4000` as a line in `.env` (or `$Env:APP_PORT=4000; docker compose up -d`).

#### Upgrade (Later)
```powershell
$Env:COMPOSE_PROJECT_NAME='ownchatbot'; docker compose pull; docker compose up -d
```

Re-download + upgrade (if compose file was removed & unmodified originally):
```powershell
Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml
$Env:COMPOSE_PROJECT_NAME='ownchatbot'
docker compose pull
docker compose up -d
```

### 3. Optional Quickstart Scripts (Alternative)
If you cloned the repo or downloaded a Release asset, you can run:
```
./quickstart.sh   (Linux/macOS)
./quickstart.ps1  (Windows PowerShell)
quickstart.bat    (Windows CMD)
```
They create `.env`, start containers, and poll `/api/health` until ready.

---

## ⚙️ Environment Variables
Place in `.env` or export before `docker compose up`.

| Name | Description | Default / Behavior |
|------|-------------|--------------------|
| POSTGRES_DB | Database name | ownchatbot |
| POSTGRES_USER | DB user | ownchatbot |
| POSTGRES_PASSWORD | DB password | Required (one-liners auto-generate) |
| APP_PORT | Host port to expose app | 3000 |
| APP_IMAGE | Image to deploy | dabomber/ownchatbot:latest |
| JWT_SECRET | Optional static JWT secret | Auto-generated & stored in volume if unset |
| TZ | Timezone (backup stack variant only) | UTC |

Notes:
- `JWT_SECRET` is persisted inside the `ownchatbot_app_data` volume if you don't set it. For multi-replica / load-balanced setups, set it explicitly.
- To run multiple independent instances on the same host, use different folders and change `COMPOSE_PROJECT_NAME` + (optionally) `APP_PORT`.

---

## 💾 Data Persistence
Named volumes (auto-created):
- `ownchatbot_pg_data` – PostgreSQL data
- `ownchatbot_app_data` – App data (generated JWT secret, future artifacts)

Remove with caution (destroys ALL data):
```bash
docker compose down --volumes
```

---

## ⬆️ Upgrading (Detailed)
1. Keep the same `COMPOSE_PROJECT_NAME` (already in your `.env`).
2. Pull the latest image(s)
3. Recreate containers (volumes reused; migrations auto-run)

Generic commands (works cross-platform when `.env` already present):
```bash
docker compose pull
docker compose up -d
```

If you manually override the project name at the CLI, be consistent every time or you'll hit a container name conflict (`container_name: ownchatbot`).

---

## 🔄 Changing Port
Add to `.env`:
```
APP_PORT=4000
```
Then:
```bash
docker compose up -d
```
Visit: http://localhost:4000

One-off (Linux/macOS):
```bash
APP_PORT=4000 docker compose up -d
```

PowerShell one-off:
```powershell
$Env:APP_PORT=4000; docker compose up -d
```

---

## 🧰 Backups
Minimal stack (simple compose file): manual dump example:
```bash
docker compose exec postgres pg_dump -U ownchatbot ownchatbot > backup.sql
```

Full stack (`docker-compose.yml` in repo, not the *simple* one) includes a scheduled backup sidecar writing into a volume (see repository docs for schedule specifics).

Restore example (basic):
```bash
docker compose exec -T postgres psql -U ownchatbot -d ownchatbot < backup.sql
```

---

## 🔐 Resetting / Rotating Auth
- Delete the `ownchatbot_app_data` volume to force regeneration of the JWT secret (logs everyone out)
- OR set `JWT_SECRET` explicitly in `.env` for predictable multi-instance auth

Rotate secret (explicit method):
1. Add a new `JWT_SECRET` to `.env`
2. `docker compose up -d` (users must re-authenticate)

---

## 🛠️ Troubleshooting
| Symptom | Action |
|---------|--------|
| App not healthy | `docker compose logs app` |
| DB auth errors | Ensure password in `.env` matches the already-created Postgres volume | 
| Port already in use | Change `APP_PORT` | 
| Want a clean slate | `docker compose down --volumes` (DATA LOSS) |
| Need new JWT secret | Remove `ownchatbot_app_data` or set `JWT_SECRET` |

Tip: Use `docker compose ps` to see container states quickly.

---

## 🧪 Manual docker run (Not Recommended)
You would need to: create a network, run Postgres with env vars & volume, then run the app container with linked env + network + port map. Compose already encodes all this—use it unless you have a hard constraint.

---

## 📄 License
GPL-3.0 license

