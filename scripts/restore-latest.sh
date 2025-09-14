#!/bin/bash
# Restore the most recent backup dump into the running postgres container
# Usage: ./scripts/restore-latest.sh [database]
# CAUTION: This will DROP and recreate objects in the target database.

set -euo pipefail

if command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
elif docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
else
  echo "Docker Compose not found" >&2
  exit 1
fi

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

DB=${1:-${POSTGRES_DB:-ownchatbot}}
USER=${POSTGRES_USER:-ownchatbot}
PASS=${POSTGRES_PASSWORD:-ownchatbot_secure_password}

LATEST=$(ls -1t backups/${DB}_*.dump 2>/dev/null | head -n1 || true)
if [ -z "$LATEST" ]; then
  echo "No backup dump found in ./backups" >&2
  exit 1
fi

echo "⚠️  Restoring $LATEST into database '$DB' (container: postgres)"
read -p "Type 'YES' to continue: " CONFIRM
[ "$CONFIRM" = "YES" ] || { echo "Aborted"; exit 1; }

# Create the DB if missing and run pg_restore with clean
$DOCKER_COMPOSE exec -T postgres sh -lc "export PGPASSWORD=\"$PASS\"; psql -U \"$USER\" -tc \"SELECT 1 FROM pg_database WHERE datname='${DB}'\" | grep -q 1 || createdb -U \"$USER\" \"$DB\""
cat "$LATEST" | $DOCKER_COMPOSE exec -T postgres sh -lc "export PGPASSWORD=\"$PASS\"; pg_restore -U \"$USER\" -d \"$DB\" --clean --if-exists"

echo "✅ Restore completed"
