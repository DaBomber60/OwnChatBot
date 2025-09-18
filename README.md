# OwnChatBot

A self‑hostable Next.js application for creating richly defined AI characters and running long‑form, persona‑driven chat sessions. It focuses on local control of data (PostgreSQL), high‑quality conversation management (variants, editing, summaries, notes), and operational tooling (import/export, request logs, rate limiting, truncation safeguards).

> Screenshot placeholders are included. Replace each `![screenshot-*]` with a real screenshot image committed to `public/` and update alt text accordingly.

## Table of Contents
1. ✨ Features
2. 🖼️ Screenshots (Placeholders)
3. 🚀 Quick Start
4. 🛠️ Development Setup
5. 📘 Usage Guide
6. 🏗️ Architecture
7. 🔧 Environment Variables
8. 💻 Commands
9. 💾 Data & Migration
10. 🐛 Troubleshooting

---
## 1. ✨ Features

### Character & Persona System
- Rich character definitions: scenario, personality, first message, example dialogue
- Optional profile/display names for cleaner UI
- Personas define the "user" speaking style / role (profile text injected into system prompt)
- Mix & match any persona with any character

### Conversation Management
- Session cloning (duplicate entire chat with variants, notes, summary)
- Per‑session Notes (user maintained) and AI Summaries (auto or manual, incremental update supported)
- Streaming or non‑streaming AI responses
- Automatic truncation logic + character count limit endpoint (`/api/sessions/:id/check-limit`) to prevent hard API failures
- Token/character conservation via incremental summary update endpoint

### Message Controls
- Variants: generate alternate AI responses, cycle, and commit an active variant
- Continue: extend an AI message seamlessly
- Edit: modify any prior message (user or AI) and reflow subsequent conversation
- Delete: remove a message and everything after it (with variant cleanup)

### Formatting & Safety
- Sanitization + lightweight markdown (bold, italics, inline code, divider lines)
- Redaction utilities (sensitive request log filtering)
- Body size limiting & basic rate limiting middleware

### Data Layer
- PostgreSQL with Prisma (v6) schema: characters, personas, sessions, messages, message versions, settings, prompts
- Cascading deletes & version tracking for message variants
- Import / Export endpoints for complete data portability

### Settings & Configuration
- Temperature, streaming toggle, summary prompt, custom global prompts
- Stored AI API Key in DB (supports DeepSeek, OpenAI, OpenRouter, or custom OpenAI-compatible endpoint)
- JWT session auth with password setup wizard & change password flow

### Developer / Ops Tooling
- Request log capture & per‑request download (debug mode)
- Character count preflight (`check-limit`) to prompt user to summarize
- Docker & deployment script (`deploy.sh`) with nginx profile option

### UI / UX
- Responsive Next.js + TailwindCSS layout
- Inline action toolbars on hover; clean reading layout
- Clear loading / saving states for summary, notes, variants generation
- (Planned / optional) drag & drop ordering (dnd‑kit) — update docs if expanded

---
## 2. 🖼️ Screenshots (Coming Soon!)

| Section | Placeholder |
|--------|-------------|
| Dashboard / Session List | ![screenshot-dashboard](public/PLACEHOLDER-dashboard.png) |
| Character Editor | ![screenshot-character-editor](public/PLACEHOLDER-character-editor.png) |
| Persona Manager | ![screenshot-personas](public/PLACEHOLDER-personas.png) |
| Chat View (Streaming) | ![screenshot-chat-stream](public/PLACEHOLDER-chat-stream.png) |
| Variants Panel | ![screenshot-variants](public/PLACEHOLDER-variants.png) |
| Notes & Summary Modals | ![screenshot-notes-summary](public/PLACEHOLDER-notes-summary.png) |

---
## 3. 🚀 Quick Start

### Option A: One‑Line (Linux / macOS)
```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16); \
curl -fsSL https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -o docker-compose.yml; \
APP_IMAGE=dabomber/ownchatbot:latest docker compose up -d; \
echo "Open: http://localhost:3000"
```

### Option B: One‑Line (Windows PowerShell)
```powershell
$Env:POSTGRES_PASSWORD = -join ((48..57 + 97..102) | Get-Random -Count 32 | % {[char]$_})
Invoke-WebRequest https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml -OutFile docker-compose.yml
$Env:APP_IMAGE = 'dabomber/ownchatbot:latest'
docker compose up -d
Write-Host 'Open: http://localhost:3000'
```

These commands:
1. Generate a random Postgres password (not persisted unless you create a `.env`)
2. Download the minimal two‑service compose file (app + postgres)
3. Start both containers on an auto-created network
4. Expose the web app at http://localhost:3000

### Option C: Quickstart Scripts (Recommended)
Clone or download a release, then:
```bash
./quickstart.sh       # Linux / macOS
```
```powershell
./quickstart.ps1      # Windows PowerShell
```
```bat
quickstart.bat        # Batch wrapper (delegates to PowerShell)
```
Scripts will:
- Download compose file if missing
- Create `.env` (idempotent) with a random secure `POSTGRES_PASSWORD`
- Start containers and poll `/api/health`

### Upgrades
```bash
docker compose pull
docker compose up -d
```
Volumes preserve data (`ownchatbot_pg_data`, `ownchatbot_app_data`).

### Environment Overrides
Set in shell or `.env`:
| Variable | Purpose | Default |
|----------|---------|---------|
| POSTGRES_DB | Database name | ownchatbot |
| POSTGRES_USER | DB user | ownchatbot |
| POSTGRES_PASSWORD | DB password | (insecure default unless randomized) |
| APP_PORT | Host port for web UI | 3000 |
| APP_IMAGE | Docker image tag | dabomber/ownchatbot:latest |
| JWT_SECRET | (Optional) Static JWT signing secret | Auto-generated & persisted in volume |

### Common Variations
Run on a different port:
```bash
APP_PORT=4000 docker compose up -d
```
Force a specific image version:
```bash
APP_IMAGE=dabomber/ownchatbot:v1.0.0 docker compose up -d
```
Reset everything (DATA LOSS):
```bash
docker compose down --volumes
```

### Full stack (with daily backups sidecar + optional nginx)
```bash
# Clone
git clone <REPO_URL> ownchatbot
cd ownchatbot

# Build + run (compose via helper script)
./deploy.sh --rebuild

# Update later
git pull
./deploy.sh --rebuild
```

Single-container example (no nginx sidecar):
```bash
docker run -d --name ownchatbot -p 3000:3000 -v ownchatbot_data:/app/data yourdockerhubusername/ownchatbot:latest \
	-e DATABASE_URL='postgresql://user:pass@host:5432/ownchatbot?schema=public'
```
Open: http://localhost:3000

### Windows Notes
- Use Git Bash / WSL for `deploy.sh` scripts.
- Or translate the compose file manually: `docker compose up -d --build`.

---
## 4. 🛠️ Development Setup

```bash
git clone <REPO_URL>
cd ownchatbot
npm install

# Copy & edit environment
envExample=.env.example
envLocal=.env.local
cp "$envExample" "$envLocal"

# Start local Postgres (Docker)
npm run db:setup

# Apply migrations (baseline + future changes)
npx prisma migrate dev

npm run dev
```
Open http://localhost:3000

Windows PowerShell equivalent (illustrative):
```powershell
git clone <REPO_URL> ownchatbot
cd ownchatbot
npm install
Copy-Item .env.example .env.local
npm run db:setup
npx prisma migrate dev
npm run dev
```

---
## 5. 📘 Usage Guide

### Initial Setup
1. Open the app → Setup Wizard (define master password)
2. Add your AI provider API key in Settings (stored in DB, not env)
3. Adjust temperature / streaming / summary prompt as desired

### Creating a Character
1. Characters → New
2. Fill: Name, (optional) Display Name, Scenario, Personality, First Message, Example Dialogue
3. Save → Start a session

### Creating Personas
1. Personas → New
2. Provide Name + Profile style (how the "user" speaks)
3. Reuse personas across characters to compare tone differences

### Starting & Managing Sessions
- Start from Character or Sessions list
- Add user messages; AI responds (streaming if enabled)
- Notes modal → personal notes (not sent to AI)
- Summary modal → auto-generate or incremental update summary
- Clone session to branch storylines without losing history

### Working with Variants
- On an AI message: Generate variant → cycle (left/right)
- Commit chosen variant to finalize
- Cleanup removes uncommitted variants

### Summaries & Limits
- Full Generate Summary condenses entire conversation
- Update Summary appends only new messages since last summary (token efficient)
- Preflight via `/api/sessions/:id/check-limit` warns when near character cap

### Import / Export
- Export: JSON archive of all data (characters, personas, sessions, messages, settings)
- Import: Upload archive (requires import token) to merge / restore

### Request Logs (Debug Mode)
- Enable debug setting → per-request logs (download payloads)
- Sensitive fields redacted automatically

### Notes
- Each session has user-maintained notes, never sent to AI model

---
## 6. 🏗️ Architecture

- Frontend: Next.js 15 (Pages Router) + TypeScript + SWR
- Backend: Next.js API routes (auth, CRUD, chat, utilities)
- Database: PostgreSQL (Prisma ORM)
- Auth: Password (bcrypt) + JWT (HTTP-only cookie) + setup/init flow
- AI Providers: DeepSeek (default) plus OpenAI (gpt-5-mini default), OpenRouter, or a custom OpenAI-compatible endpoint (stream & non-stream)
- Build Tooling: TailwindCSS, PostCSS, autoprefixer
- Deployment: Docker (optional nginx reverse proxy)

### Message Pipeline (High Level)
1. Build system prompt (persona, character, scenario, example dialogue, optional summary)
2. Append conversation history (truncate if needed)
3. Send to selected AI provider endpoint (stream or standard)
4. Handle variants / continuations via message versions in DB

---
## 7. 🔧 Environment Variables
Create `.env.local` (dev) or `.env` (prod). See `.env.example`.

Key variables:
- `DATABASE_URL` (PostgreSQL connection string)
- `JWT_SECRET` (OPTIONAL: if omitted the container auto-generates & persists one in `/app/data/jwt-secret`; set manually only if you want to control rotation or run multiple replicas)
- `APP_PORT` (default 3000)
- `POSTGRES_*` (when using provided Docker compose services)
- `TZ` (optional timezone for backup scheduling)

AI provider API key is stored only via the in-app Settings UI (not via env vars). Provider & model can be changed in Settings.

---
## 8. 💻 Commands

### Development / Build
```bash
npm run dev
npm run build
npm start
npm run lint
npm run type-check
```

### Database / Prisma
```bash
npm run db:setup       # Start local Postgres via Docker compose
npm run prisma:generate
npm run prisma:migrate  # Uses migrations (same as npx prisma migrate dev)
npm run prisma:push     # Push schema w/out migration (use with caution)
npm run prisma:studio
npm run db:reset        # CAUTION: drops & recreates data
```

### Docker / Deploy
```bash
./deploy.sh            # Start/update containers (cached)
./deploy.sh --rebuild  # Force rebuild
./deploy.sh --logs     # Tail container logs
./deploy.sh --nginx    # Include nginx reverse proxy profile
docker compose -f docker-compose.simple.yml up -d   # Minimal two-container stack
```

### Build & Publish Manually (Local)
```bash
# Build local image
docker build -t ownchatbot:local .

# Tag for Docker Hub
docker tag ownchatbot:local yourdockerhubusername/ownchatbot:latest

# Push (after docker login)
docker push yourdockerhubusername/ownchatbot:latest
```

### GitHub Actions (Automated)
Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repo secrets. A workflow (`.github/workflows/docker-image.yml`) builds multi-arch images on pushes & tags.

---
## 9. 💾 Data & Migration
- Primary persistence: PostgreSQL
- Schema tracked via Prisma migrations (baseline `20250914_init` + future diffs)
- Logical backup & restore: Export/Import endpoints (JSON)
- Physical backup: `pg_dump` / `psql` (examples below)

Example manual dump/restore (container):
```bash
docker compose exec postgres pg_dump -U ownchatbot ownchatbot > backup.sql
docker compose exec -T postgres psql -U ownchatbot ownchatbot < backup.sql
```

### Automated Backups
- Sidecar backup service runs daily at 03:15 server time
- Retention: 7 daily, 4 weekly, 12 monthly (tunable in `docker-compose.yml` under `backup` service env vars: `SCHEDULE`, `KEEP_*`)
- Manual one-off backup: `./scripts/backup-now.sh [label]` (creates compressed custom-format dump under `./backups/` — gitignored)
- Deploy script attempts pre-deploy backup if executable

Adjust timezone via `TZ` env variable.

---
## 10. 🐛 Troubleshooting

Issue: DeepSeek key not recognized
- Re-set in Settings UI (provider-specific)
- Confirm API credits & network reachability

Issue: Near character limit
- Generate or update summary; retry message
- Use `/api/sessions/:id/check-limit` for stats

Issue: Prisma client mismatch
```bash
npm run prisma:generate
```

Issue: Database reset / migration errors
```bash
npm run db:reset
npm run prisma:migrate
```

Issue: Docker stale build
```bash
./deploy.sh --rebuild
```

Issue: Port already in use
- Change `APP_PORT` or free the existing process

Issue: New login cookies invalid after restart
- Ensure the `app_data` volume is mounted (see docker-compose) so the generated secret persists.

Issue: Startup logs show "The following package was not found and will be installed: prisma"
- Resolved: `prisma` is now a production dependency so the CLI ships in the image. We prune dev deps after build. If you still see this message, ensure your image is rebuilt (no stale layer) and that `docker-entrypoint.sh` isn't running before layer cache updated. To further slim the image you could copy only the generated client and remove runtime migrations.

Issue: Want to share sessions across multiple replicas
- Manually set the same `JWT_SECRET` value for every instance (Kubernetes Secret / compose env). Without this, each replica would issue tokens another cannot validate.

Issue: Force logout / rotate all sessions intentionally
- Delete `/app/data/jwt-secret` (or remove the volume) and restart, or set a new `JWT_SECRET` value; users must re-authenticate.

---

