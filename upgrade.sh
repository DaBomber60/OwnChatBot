#!/usr/bin/env bash
set -euo pipefail

echo "==> OwnChatBot Upgrade (Bash)"
COMPOSE_FILE_URL="https://raw.githubusercontent.com/dabomber60/ownchatbot/main/docker-compose.simple.yml"

# Determine docker compose command
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
else
  echo "ERROR: Docker Compose not found." >&2
  exit 1
fi

# If compose file missing, redownload minimal version
if [ ! -f docker-compose.yml ] && [ ! -f docker-compose.simple.yml ]; then
  echo "Compose file not found in current directory. Downloading minimal compose file..."
  curl -fsSL "$COMPOSE_FILE_URL" -o docker-compose.yml
  COMPOSE_FILE="docker-compose.yml"
else
  if [ -f docker-compose.yml ]; then
    COMPOSE_FILE="docker-compose.yml"
  else
    COMPOSE_FILE="docker-compose.simple.yml"
  fi
fi

# Ensure APP_IMAGE default (allows override by env)
export APP_IMAGE="${APP_IMAGE:-dabomber/ownchatbot:latest}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-ownchatbot}"

echo "Using compose file: $COMPOSE_FILE"
echo "Pulling latest image for: $APP_IMAGE"
$DOCKER_COMPOSE -f "$COMPOSE_FILE" pull app || $DOCKER_COMPOSE -f "$COMPOSE_FILE" pull

echo "Recreating container(s)..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d app || $DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d

echo "Upgrade complete. Currently running image:"
$DOCKER_COMPOSE -f "$COMPOSE_FILE" ps
