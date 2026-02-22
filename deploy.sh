#!/bin/bash
# NOTE: This file must use LF line endings (enforced via .gitattributes)

# OwnChatBot Deployment Script
# Usage: ./deploy.sh [--rebuild] [--logs] [--nginx] [--passwordreset]
# Tip: To run a one-off database backup before deploy, you can call:
#   ./scripts/backup-now.sh predeploy

set -e

# Detect Docker Compose command (V1 vs V2)
if command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
elif docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
else
    echo "❌ Error: Docker Compose not found!"
    echo "Please install Docker and Docker Compose:"
    echo "  - Docker Compose V1: install docker-compose"
    echo "  - Docker Compose V2: use 'docker compose' (included with Docker)"
    exit 1
fi

echo "🚀 OwnChatBot Deployment Script"
echo "================================="
echo "📦 Using: $DOCKER_COMPOSE"

# Default values
REBUILD=false
SHOW_LOGS=false
NGINX_PROFILE=""

# Parse arguments
PASSWORD_RESET=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --rebuild)
      REBUILD=true
      shift
      ;;
    --logs)
      SHOW_LOGS=true
      shift
      ;;
        --nginx)
      NGINX_PROFILE="--profile nginx"
      shift
      ;;
        --passwordreset)
            PASSWORD_RESET=true
            shift
            ;;
    *)
      echo "Unknown option $1"
      echo "Usage: $0 [--rebuild] [--logs] [--nginx]"
      exit 1
      ;;
  esac
done

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found!"
    echo "📝 Creating .env from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✅ .env created from .env.example"
        echo "ℹ️  Example includes optional variables (STREAM_TIMEOUT_MS, IMPORT_ALLOWED_ORIGINS, debug flags, etc.)."
    else
        echo "❌ No .env.example template found. Aborting."
        exit 1
    fi
    echo "🔧 Auto-configuring secrets for deployment..."
fi

# Validate required environment variables
echo "🔍 Validating configuration..."

# Check if PostgreSQL password is using default (insecure) value
if grep -q "POSTGRES_PASSWORD=ownchatbot_secure_password" .env; then
    echo "🔐 Generating secure PostgreSQL password..."
    # Generate a secure random password
    POSTGRES_PASSWORD=$(openssl rand -base64 32 2>/dev/null | tr -d "=+/" | cut -c1-25 || \
                       head -c 25 /dev/urandom 2>/dev/null | base64 | tr -d "=+/" | head -c 25 || \
                       echo "secure_$(date +%s)_$(whoami)" | sha256sum | cut -d' ' -f1 | head -c 25)
    
    # Update the .env file with secure password
    sed -i "s/POSTGRES_PASSWORD=ownchatbot_secure_password/POSTGRES_PASSWORD=$POSTGRES_PASSWORD/" .env
    echo "✅ Secure PostgreSQL password generated"
fi

# Check if JWT_SECRET exists and is not empty
if ! grep -q "JWT_SECRET=" .env || grep -q "JWT_SECRET=$" .env; then
    echo "🔑 Generating random JWT_SECRET..."
    # Generate a secure random JWT secret (64 characters)
    # Try multiple methods for cross-platform compatibility
    JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || \
                 xxd -l 32 -p /dev/urandom 2>/dev/null | tr -d '\n' || \
                 head -c 64 /dev/urandom 2>/dev/null | base64 | tr -d '\n' | head -c 64 || \
                 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || \
                 echo "$(date +%s)_$(whoami)_$(hostname)" | sha256sum | cut -d' ' -f1 2>/dev/null || \
                 { echo "❌ FATAL: Could not generate a secure JWT_SECRET. Install openssl or node and retry."; exit 1; })
    
    # Update the .env file
    if grep -q "JWT_SECRET=" .env; then
        # Replace existing empty JWT_SECRET
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    else
        # Add JWT_SECRET if it doesn't exist
        echo "JWT_SECRET=$JWT_SECRET" >> .env
    fi
    echo "✅ JWT_SECRET generated and saved to .env"
fi

echo "✅ Configuration ready"

# Optional password reset (clears authPassword & bumps version)
if [ "$PASSWORD_RESET" = true ]; then
    echo "🔐 Resetting application password (clearing stored hash)..."
    # Execute a one-off node script inside running container after start later.
    DO_PASSWORD_RESET=1
fi

# Optional: try to perform a quick backup before stopping containers (best-effort)
if [ -x ./scripts/backup-now.sh ]; then
    echo "💾 Creating database backup (predeploy)..."
    ./scripts/backup-now.sh predeploy || echo "⚠️  Predeploy backup failed (continuing)."
fi

# Stop existing containers
echo "🛑 Stopping existing containers..."
$DOCKER_COMPOSE down

# Rebuild if requested
if [ "$REBUILD" = true ]; then
    echo "🔨 Rebuilding containers..."
    $DOCKER_COMPOSE build --no-cache
fi

# Start services
echo "🐳 Starting services..."
$DOCKER_COMPOSE up -d $NGINX_PROFILE

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
timeout=60
while [ $timeout -gt 0 ]; do
    if $DOCKER_COMPOSE ps | grep -q "Up (healthy)"; then
        echo "✅ Services are healthy!"
        break
    fi
    echo "   Waiting... ($timeout seconds remaining)"
    sleep 5
    timeout=$((timeout - 5))
done

if [ $timeout -eq 0 ]; then
    echo "❌ Services failed to become healthy"
    echo "📋 Container status:"
    $DOCKER_COMPOSE ps
    echo "📝 Logs:"
    $DOCKER_COMPOSE logs --tail=50
    exit 1
fi

if [ "${DO_PASSWORD_RESET:-0}" = 1 ]; then
    echo "🧹 Clearing stored password and incrementing version..."
    # Run within app container (assumes service name is 'app' in compose)
    $DOCKER_COMPOSE exec -T app node -e "(async()=>{const { PrismaClient } = require('.prisma/client'); const p=new PrismaClient(); try { await p.setting.updateMany({ where:{ key:'authPassword'}, data:{ value:''}}); const v= await p.setting.findUnique({ where:{ key:'authPasswordVersion'}}); if(v){ const next=(parseInt(v.value)||1)+1; await p.setting.update({ where:{ key:'authPasswordVersion'}, data:{ value:String(next)}});} console.log('Password cleared. New version set.'); } catch(e){ console.error('Password reset error', e); process.exit(1);} finally { await p.$disconnect(); } })();" || { echo "❌ Password reset failed"; exit 1; }
    echo "✅ Password cleared. Next login will require setup or password change endpoint."
fi

# Stream application logs live and stop when fully ready (✓ Starting / ✓ Ready in)
echo "📝 Streaming application logs until ready..."

# App container name from docker-compose.yml
APP_CONTAINER="ownchatbot-app"

# Patterns to detect
PATTERN_START="✓ Starting"
PATTERN_READY="✓ Ready in"

# Timeout
APP_TIMEOUT=180 # seconds
start_ts=$(date +%s)
seen_start=0
seen_ready=0
ready_flag=0

# Pre-dump recent logs so the user sees what already happened
pre_logs=$(docker logs --tail 200 "$APP_CONTAINER" 2>&1 || true)
if [ -n "$pre_logs" ]; then
    # Strip any CRs to avoid odd output if CRLF slipped in
    printf "%s\n" "$pre_logs" | sed 's/\r$//'
    echo "$pre_logs" | grep -q "$PATTERN_START" && seen_start=1 || true
    echo "$pre_logs" | grep -q "$PATTERN_READY" && seen_ready=1 || true
fi

if [ $seen_start -eq 1 ] && [ $seen_ready -eq 1 ]; then
    ready_flag=1
else
    # Stream new logs and watch for readiness
    set +e
    while IFS= read -r line; do
        # Echo the line as-is (strip CR if present)
        printf "%s\n" "${line%$'\r'}"

        if [ $seen_start -eq 0 ] && printf "%s" "$line" | grep -q "$PATTERN_START"; then
            seen_start=1
        fi
        if [ $seen_ready -eq 0 ] && printf "%s" "$line" | grep -q "$PATTERN_READY"; then
            seen_ready=1
        fi

        if [ $seen_start -eq 1 ] && [ $seen_ready -eq 1 ]; then
            ready_flag=1
            break
        fi

        # Timeout check
        if [ $(( $(date +%s) - start_ts )) -ge $APP_TIMEOUT ]; then
            break
        fi
    done < <(docker logs -f --since 0s "$APP_CONTAINER" 2>&1)
    set -e
fi

if [ $ready_flag -ne 1 ]; then
    echo "❌ Timed out waiting for application to be fully ready based on logs"
    echo "📝 Recent app logs:"
    docker logs --tail 100 "$APP_CONTAINER" || true
    echo "💡 Hint: You can re-run with --logs to stream all logs."
    exit 1
fi

echo "✅ Application reports ready via logs"

# Show deployment info
echo ""
echo "🎉 OwnChatBot deployed successfully!"
echo "=================================="
echo "📱 Application: http://localhost:$(grep APP_PORT .env | cut -d= -f2 | head -1)"

if [ -n "$NGINX_PROFILE" ]; then
    echo "🌐 Nginx: http://localhost:$(grep NGINX_HTTP_PORT .env | cut -d= -f2 | head -1 || echo 80)"
fi

echo ""
echo "🔧 Useful commands:"
echo "   View logs: $DOCKER_COMPOSE logs -f"
echo "   Stop: $DOCKER_COMPOSE down"
echo "   Update: ./deploy.sh --rebuild"
echo ""

# Show logs if requested
if [ "$SHOW_LOGS" = true ]; then
    echo "📝 Live logs (Ctrl+C to exit):"
    $DOCKER_COMPOSE logs -f
fi
