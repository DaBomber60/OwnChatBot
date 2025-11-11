# OwnChatBot

A self‑hostable Next.js application for creating richly defined AI characters and running long‑form, persona‑driven chat sessions. It focuses on local control of data (PostgreSQL), high‑quality conversation management (variants, editing, summaries, notes), and operational tooling (import/export, request logs, rate limiting, truncation safeguards).

Production / self‑hosting instructions have moved to Docker Hub to keep this README focused on development and contribution:  
➡️ https://hub.docker.com/r/dabomber/ownchatbot

> Screenshot placeholders are included. Replace each `![screenshot-*]` with a real screenshot image committed to `public/` and update alt text accordingly.

## Table of Contents
1. ✨ Features
2. 🖼️ Screenshots (Placeholders)
3. 🚀 Deployment (Self-Hosting)
4. 🛠️ Development Setup
5. 📘 Usage Guide
6. 🏗️ Architecture
7. 🔧 Environment Variables
8. 💻 Commands
9. 💾 Data & Migration
10. 🐛 Troubleshooting
11. 🧬 Character Generation Tool

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
## 3. 🚀 Deployment (Self-Hosting)

All production / self‑hosting instructions, one‑liners, upgrade notes, environment variable explanations for container deployment, and backup guidance have moved to Docker Hub to keep this repository README focused on development and contribution.

👉 Docker Hub page: https://hub.docker.com/r/dabomber/ownchatbot

That page includes:
- Minimal two‑container (app + Postgres) quickstart
- Linux/macOS & Windows PowerShell one‑liners (with automatic password generation)
- Upgrade & re-download commands
- Environment variable reference
- Data persistence & backup info
- Troubleshooting table

If you notice something missing there, open an issue or PR here.

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
Create `.env.local` for development (copied from `.env.example`).

Key variables (development focus):
- `DATABASE_URL` (PostgreSQL connection string — local dev DB)
- `JWT_SECRET` (optional in dev; auto-generated in container deployments — see Docker Hub docs for production guidance)
- `APP_PORT` (default 3000 for local dev server)
- `TZ` (optional; affects backup scheduling only in container stack)

Deployment‑oriented environment variable details (Postgres service variables, container secret persistence, backup timezone, etc.) are documented on Docker Hub.

AI provider API key is stored only via the in‑app Settings UI (not via env vars). Provider & model can be changed in Settings.

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
npm run db:setup       # Start local Postgres (via lightweight compose file)
npm run prisma:generate
npm run prisma:migrate  # Uses migrations (same as npx prisma migrate dev)
npm run prisma:push     # Push schema w/out migration (use with caution)
npm run prisma:studio
npm run db:reset        # CAUTION: drops & recreates data
```

### GitHub Actions (Container Image CI)
Add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repo secrets. The workflow (`.github/workflows/docker-image.yml`) builds multi‑arch images on pushes & tags. For how those images are consumed in deployment, see the Docker Hub README.

### Image Version Injection During Docker Build

The `Dockerfile` accepts a build arg `APP_VERSION`. Early in the build it rewrites the `package.json` `version` field so the running container (and any diagnostics/UI referencing it) reflects the git tag version.

Key points:
- If the tag starts with a leading `v` (e.g. `v1.6.0`) it is automatically stripped → `1.6.0`.
- Semver is validated (`major.minor.patch[-prerelease]`). Invalid values fail the build early.
- Default when not supplied: `0.0.0-untagged`.

PowerShell local build example:
```powershell
$tag = git describe --tags --abbrev=0
docker build --build-arg APP_VERSION=$tag -t yourrepo/ownchatbot:$tag .
```

GitHub Actions snippet:
```yaml
jobs:
	build:
		runs-on: ubuntu-latest
		steps:
			- uses: actions/checkout@v4
			- name: Derive tag
				run: echo "TAG=${GITHUB_REF##*/}" >> $GITHUB_ENV
			- name: Build image
				run: docker build --build-arg APP_VERSION=${TAG} -t yourrepo/ownchatbot:${TAG#v} .
			- name: Push
				run: |
					echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
					docker push yourrepo/ownchatbot:${TAG#v}
```

docker-compose override example:
```yaml
services:
	app:
		build:
			context: .
			args:
				APP_VERSION: v1.6.0
```

To confirm inside a running container:
```bash
docker exec -it ownchatbot-app node -p "require('./package.json').version"
```

---
## 9. 💾 Data & Migration
- Primary persistence: PostgreSQL
- Schema tracked via Prisma migrations (baseline + future diffs under `prisma/migrations`)
- Logical export/import: Application endpoints (JSON) for characters, personas, sessions, messages, settings

For container backup/restore procedures (volumes, `pg_dump`, automated backup sidecar, retention policies) refer to the Docker Hub documentation.

---
## 10. 🐛 Troubleshooting (Development)

Issue: DeepSeek key not recognized
- Re‑set in Settings UI (provider-specific)
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

Issue: Port already in use (dev server)
- Change `APP_PORT` or free the existing process

Issue: Need container / deployment troubleshooting
- See Docker Hub page: https://hub.docker.com/r/dabomber/ownchatbot

Issue: Multi‑instance auth / JWT secret rotation
- Covered in Docker Hub docs (production scope)

---

## 11. 🧬 Character Generation Tool

The Character Generation Tool streamlines creating rich character profiles by using a two‑phase, AI‑assisted workflow with tunable style & behavior sliders.

### Overview
| Phase | What You Do | What Happens |
|-------|-------------|--------------|
| Input | Provide a concept description, pick POV (First / Third), optionally tweak sliders | Sends structured prompt to AI; generated fields appear (Scenario, Personality, First Message, Example Dialogue) |
| Generated | Review / edit the generated text; optionally Show Sliders again and adjust + Regenerate | New generation overwrites those four sections (your manual edits are replaced on regenerate) |

### Key UI Elements
- AI Generation Setup panel (shown while sliders are visible):
	- Perspective toggle (First vs Third Person). First person frames the character as the active narrator; third person allows a more external narrative voice.
	- Show Advanced checkbox reveals additional less‑common sliders.
	- Concept Description textarea (only editable before the first generation; preserved after hide/show of sliders).  
- Sliders are grouped: Personality, Scenario, Writing Style, Initial Message.
	- Core sliders are always visible; advanced sliders default to Auto and are hidden until enabled.
	- Advanced sliders start in Auto mode (AI chooses their influence value).
	- Moving a slider automatically unchecks its Auto box.
	- When dev mode is enabled (see Settings) raw numeric values are shown; otherwise numbers are hidden for a cleaner feel.
	- Categories collapse only visually; values are always collected if not Auto.
	- Hover text (help) clarifies Low → High semantics for each dimension.

### Show / Hide Behavior
- After a successful generation the sliders auto‑hide to focus on the resulting content.
- A "Show Sliders (Adjust & Regenerate)" button appears; clicking it restores the setup panel and sliders for refinement.
- Hiding sliders does NOT discard their values; they persist in state until you reset or complete character creation.

### Regeneration Rules
- Regenerate replaces: Scenario, Personality, First Message, Example Dialogue.
- Fields you manually edited after the first generation will still be overwritten on regenerate—copy anything you want to keep before regenerating.
- Bio, Group, and other metadata are never touched by the generation endpoint.

### Slider Data Semantics
- Range: 0–100 (internally passed as raw integers in the `sliders` object of the request body when not Auto).
- Auto: Value omitted from payload → model is free to infer.
- Prompt includes a compact `Parameters:` segment listing only non‑Auto entries (`Trait: value; Trait2: value; ...`).

### Perspective Handling
- The system prompt includes distinct guidance depending on First vs Third Person.
- First Person adds instructions to embed limited third‑person context between asterisks when useful.
- Placeholder `{{user}}` is always specified for downstream conversation alignment.

### Backend Mechanics
- Endpoint: `POST /api/characters/generate`
- Body shape (simplified):
	```jsonc
	{
		"name": "String",
		"profileName": "Optional String",
		"description": "Concept text",
		"sliders": { "TraitKey": 0-100, ... },
		"perspective": "first" | "third"
	}
	```
- Temperature & max tokens are applied from persisted Settings (DB) each call; temperature is normalized per provider.
- Token limit field name is provider‑aware via `tokenFieldFor`.
- The model is instructed to return strict JSON; fallback parsing attempts extract a JSON object if extra prose slips in.

### Dev Mode Extras
- Enable in Settings to display numeric slider values (debugging / reproducibility).
- Could be extended (future ideas): copyable seed prompt, export slider preset, diff last vs current slider set.

### Resetting / Starting Over
- Cancel button resets generation state and clears draft fields.
- To entirely change concept after first generation: Hide Sliders → (optionally) Cancel & restart, or implement a future enhancement to re‑enable the concept description for later edits.

### Best Practices
1. Start with a concise but information‑rich description (themes, relationships, conflicts, atmosphere).
2. Leave most advanced sliders on Auto initially—only pin values you care strongly about.
3. If output feels unfocused, narrow Scenario/Personality scope or raise Stability / Consistency sliders (if present in future enhancements).
4. Regenerate only after making targeted slider adjustments to reduce randomness churn.
5. Use dev mode to record numeric settings for reproducible character styles.

### Planned / Potential Enhancements (Not Yet Implemented)
- Preset system to save / load slider configurations.
- Tooltip or transient numeric overlay when adjusting sliders in non‑dev mode.
- Compression of long slider lists into collapsible accordions.
- Selective partial regeneration (e.g., only First Message).

---

