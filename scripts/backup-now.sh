#!/bin/bash
# One-off database backup using pg_dump from the postgres container
# Usage: ./scripts/backup-now.sh [label]
# Produces: ./backups/<db>_YYYYmmdd-HHMMSS_<label>.dump (custom format)

set -euo pipefail

if command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
elif docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
else
  echo "Docker Compose not found" >&2
  exit 1
fi

# Load env (best-effort) so we can read DB creds; fall back to defaults
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

POSTGRES_DB=${POSTGRES_DB:-ownchatbot}
POSTGRES_USER=${POSTGRES_USER:-ownchatbot}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-ownchatbot_secure_password}
LABEL=${1:-manual}
TS=$(date +%Y%m%d-%H%M%S)

mkdir -p backups

OUT="backups/${POSTGRES_DB}_${TS}_${LABEL}.dump"
echo "💾 Creating backup: $OUT"

# Use pg_dump inside the postgres container and stream to host file
$DOCKER_COMPOSE exec -T postgres sh -lc "export PGPASSWORD=\"$POSTGRES_PASSWORD\"; pg_dump -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -F c -Z 9" > "$OUT"

echo "✅ Backup completed: $OUT"
echo "📂 Backups directory: ./backups"
