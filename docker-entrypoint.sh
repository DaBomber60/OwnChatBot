#!/bin/sh
set -e

echo "🚀 Starting OwnChatBot (uid=$(id -u) gid=$(id -g))..."

# Ensure data directory exists (for persistent generated secrets)
DATA_DIR="/app/data"
mkdir -p "$DATA_DIR"

# If running as root, ensure correct ownership (volume mounts may default to root:root)
if [ "$(id -u)" = "0" ]; then
    # Only chown if not already owned to reduce startup cost
    CURRENT_OWNER="$(stat -c '%u:%g' "$DATA_DIR" 2>/dev/null || echo '')"
    if [ "$CURRENT_OWNER" != "1001:1001" ]; then
        chown -R nextjs:nodejs "$DATA_DIR" || echo "⚠️  Could not chown $DATA_DIR (continuing)"
    fi
fi

# Auto-generate persistent JWT secret if not provided.
# We store it in data/jwt-secret so that restarts reuse the same value (volume recommended).
if [ -z "$JWT_SECRET" ]; then
    if [ -f "$DATA_DIR/jwt-secret" ]; then
        export JWT_SECRET="$(cat $DATA_DIR/jwt-secret | tr -d '\r' | tr -d '\n')"
        echo "🔐 Loaded existing JWT secret from $DATA_DIR/jwt-secret"
    else
        echo "🧪 No JWT_SECRET provided. Generating a new one..."
        # 32 bytes hex
        GEN_SECRET=$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | head -c 64)
        echo "$GEN_SECRET" > "$DATA_DIR/jwt-secret"
        chmod 600 "$DATA_DIR/jwt-secret"
        export JWT_SECRET="$GEN_SECRET"
        echo "✅ Generated and stored JWT secret at $DATA_DIR/jwt-secret"
    fi
else
    echo "🔐 Using provided JWT_SECRET (length: ${#JWT_SECRET})"
fi

# Function to wait for PostgreSQL to be ready
wait_for_postgres() {
    echo "⏳ Waiting for PostgreSQL to be ready..."
    
    # Extract connection details from DATABASE_URL if it's PostgreSQL
    if echo "$DATABASE_URL" | grep -q "postgresql://"; then
        # Parse DATABASE_URL to get host and port
        # This is a simple parser - works for most standard URLs
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        
        # Default to localhost:5432 if parsing fails
        DB_HOST=${DB_HOST:-localhost}
        DB_PORT=${DB_PORT:-5432}
        
        echo "🔍 Checking PostgreSQL connection to $DB_HOST:$DB_PORT..."
        
        # Wait for PostgreSQL to accept connections
        while ! nc -z "$DB_HOST" "$DB_PORT"; do
            echo "⏳ PostgreSQL is not ready yet. Waiting 2 seconds..."
            sleep 2
        done
        
        echo "✅ PostgreSQL is accepting connections"
        
        # Additional wait to ensure PostgreSQL is fully ready
        sleep 3
    else
        echo "ℹ️  Using SQLite database - no connection wait needed"
    fi
}

# Check if netcat is available (for PostgreSQL connection check)
if command -v nc >/dev/null 2>&1; then
    wait_for_postgres
else
    echo "⚠️  netcat not available - skipping PostgreSQL connection check"
    echo "⏳ Waiting 10 seconds for database to be ready..."
    sleep 10
fi

# Wait for database to be ready and run migrations
echo "⏳ Running database migrations..."

# Capture output to detect specific errors like P3009
set +e
# Sanitize migration SQL files for stray null bytes (Windows encoding edge cases)
if [ -d prisma/migrations ]; then
    find prisma/migrations -type f -name 'migration.sql' -print0 2>/dev/null | while IFS= read -r -d '' f; do
        # Remove any embedded NULs (defensive) by rewriting file
        if tr <"$f" -d '\000' | cmp -s - "$f"; then
            : # unchanged
        else
            echo "🔧 Sanitizing null bytes in $f"
            tmpfile="$f.tmp"
            tr <"$f" -d '\000' >"$tmpfile" && mv "$tmpfile" "$f" || echo "⚠️  Failed to sanitize $f (continuing)"
        fi
        # Strip UTF-8 BOM if present (ef bb bf)
        BOM_HEX=$(head -c3 "$f" | od -An -t x1 | tr -d ' \n')
        if [ "$BOM_HEX" = "efbbbf" ]; then
            echo "🔧 Removing UTF-8 BOM from $f"
            tail -c +4 "$f" > "$f.bomtmp" && mv "$f.bomtmp" "$f" || echo "⚠️  Failed removing BOM from $f"
        fi
        # Remove any leading non-printable/control bytes (defensive)
        # Keep first line safe by filtering through awk printable test
        awk 'NR==1{sub(/^([^[:print:]]+)/,"");} {print}' "$f" > "$f.clean" 2>/dev/null && mv "$f.clean" "$f" || true
        # Ensure file ends with newline
        printf '\n' >> "$f"
    done
fi

MIGRATE_OUTPUT=$(npx prisma migrate deploy 2>&1)
MIGRATE_STATUS=$?
echo "$MIGRATE_OUTPUT"
set -e

if [ $MIGRATE_STATUS -ne 0 ]; then
        if echo "$MIGRATE_OUTPUT" | grep -q 'P3009'; then
        echo "⚠️  Detected Prisma error P3009 (failed prior migration)."
        if [ "${PRISMA_AUTO_RESOLVE_P3009:-1}" = "1" ]; then
            echo "🛠  Attempting automatic resolution (marking failed migration rolled back)..."
            # Identify first migration directory
            FIRST_MIGRATION=$(ls -1 prisma/migrations | head -n1 || true)
            if [ -n "$FIRST_MIGRATION" ]; then
                echo "   -> Using migration: $FIRST_MIGRATION"
                npx prisma migrate resolve --rolled-back "$FIRST_MIGRATION" || echo "⚠️  resolve --rolled-back failed (continuing)"
                echo "🔁 Re-running migrate deploy..."
                if ! npx prisma migrate deploy; then
                                        echo "❌ Prisma migrate failed again after attempted auto-resolve.";
                                        if [ "${PRISMA_FALLBACK_DB_PUSH:-0}" = "1" ]; then
                                            echo "🩹 Falling back to 'prisma db push' (schema sync without migration history)."
                                            if npx prisma db push --accept-data-loss; then
                                                echo "✅ prisma db push completed (migration history skipped)."
                                            else
                                                echo "❌ prisma db push fallback failed."; exit 1
                                            fi
                                        else
                                            exit 1
                                        fi
                fi
            else
                echo "❌ No migrations found to resolve."; exit 1
            fi
        else
            echo "❌ Migration failed with P3009 and auto-resolve disabled (PRISMA_AUTO_RESOLVE_P3009=0)."; exit 1
        fi
        elif echo "$MIGRATE_OUTPUT" | grep -q 'P3018'; then
                echo "⚠️  Detected Prisma error P3018 (migration apply failure)."
                if [ "${PRISMA_FALLBACK_DB_PUSH:-0}" = "1" ]; then
                    echo "🩹 Falling back to 'prisma db push' (will create/update tables directly)."
                    if npx prisma db push --accept-data-loss; then
                        echo "✅ prisma db push completed after P3018."
                    else
                        echo "❌ prisma db push fallback failed."; exit 1
                    fi
                else
                    echo "❌ P3018 encountered. Set PRISMA_FALLBACK_DB_PUSH=1 to attempt non-migration schema sync or clear the database volume."; exit 1
                fi
    else
        echo "⚠️  'npx prisma migrate deploy' failed (status $MIGRATE_STATUS). Attempting direct fallback binary..."
        if [ -x ./node_modules/.bin/prisma ]; then
            set +e
            FALLBACK_OUTPUT=$(./node_modules/.bin/prisma migrate deploy 2>&1)
            FALLBACK_STATUS=$?
            echo "$FALLBACK_OUTPUT"
            set -e
            if [ $FALLBACK_STATUS -ne 0 ]; then
                                if echo "$FALLBACK_OUTPUT" | grep -q 'P3018' && [ "${PRISMA_FALLBACK_DB_PUSH:-0}" = "1" ]; then
                                     echo "🩹 Falling back to prisma db push after binary migrate failure."
                                     if npx prisma db push --accept-data-loss; then
                                            echo "✅ prisma db push completed."
                                     else
                                            echo "❌ prisma db push fallback failed."; exit 1
                                     fi
                                else
                                     echo "❌ Prisma migrate failed"; exit 1
                                fi
            fi
        else
            echo "❌ Prisma CLI not found in node_modules/.bin. Listing node_modules/prisma contents for debug:";
            ls -al ./node_modules/prisma || true
            exit 1
        fi
    fi
fi
echo "✅ Database migrations completed"

# Generate Prisma client (in case of any schema changes)
echo "🔧 Generating Prisma client..."
if ! npx prisma generate; then
    echo "⚠️  'npx prisma generate' failed. Trying direct binary..."
    if [ -x ./node_modules/.bin/prisma ]; then
        ./node_modules/.bin/prisma generate || { echo "❌ Prisma generate failed"; exit 1; }
    else
        echo "❌ Prisma CLI still not available. Aborting."; exit 1
    fi
fi
echo "✅ Prisma client generated"

echo "🎉 Starting application..."

# Drop privileges to nextjs if we are root
if [ "$(id -u)" = "0" ]; then
    if command -v su-exec >/dev/null 2>&1; then
        exec su-exec nextjs:nodejs "$@"
    else
        echo "⚠️  su-exec not found, running as root (less secure)." >&2
        exec "$@"
    fi
else
    exec "$@"
fi
