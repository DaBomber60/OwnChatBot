## syntax=docker/dockerfile:1.7
# Layer-reduced multi-stage build for Next.js + Prisma
# Goals:
#  - Consolidate RUN steps
#  - Produce a single artifact directory then one COPY into final image
#  - Use BuildKit cache mounts for faster npm ci + build

FROM node:24-alpine AS build
WORKDIR /app

# System packages needed during build (prisma engines, openssl) and for generating standalone output
RUN apk add --no-cache libc6-compat openssl netcat-openbsd

# Copy only manifests + prisma schema first for better dependency layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install all dependencies (dev + prod) with cache mount; fall back if lockfile missing
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
      echo "Using package-lock.json with npm ci" && npm ci; \
    else \
      echo "WARNING: package-lock.json not found. Falling back to 'npm install' (consider committing a lockfile)." && npm install; \
    fi && \
    npm cache clean --force

# Copy full source (after deps to keep cache stable on code-only changes)
COPY . .

# Generate Prisma client, build Next.js (standalone), then prune dev deps in a single layer
RUN --mount=type=cache,target=/root/.npm \
    npx prisma generate && \
    npm run build && \
    npm prune --omit=dev || true

# Assemble minimal runtime artifact set under /out for a single COPY later
RUN set -eux; \
    mkdir -p /out; \
    cp -R public /out/public; \
    # Place standalone server files at root of /out (server.js, etc.). Use trailing '/.' to include dotfiles/directories like '.next'
    cp -R .next/standalone/. /out/; \
    # Static assets required by Next.js (standalone excludes static assets)
    mkdir -p /out/.next && cp -R .next/static /out/.next/static; \
    # Prisma schema and engines/CLI pieces (for migrations & runtime queries)
    cp -R prisma /out/prisma; \
    mkdir -p /out/node_modules; \
    cp -R node_modules/.prisma /out/node_modules/.prisma; \
    cp -R node_modules/prisma /out/node_modules/prisma; \
    cp -R node_modules/@prisma /out/node_modules/@prisma; \
    cp -R node_modules/.bin /out/node_modules/.bin; \
    cp docker-entrypoint.sh /out/docker-entrypoint.sh; \
    cp healthcheck.js /out/healthcheck.js

FROM node:24-alpine AS runner
WORKDIR /app

# Install only runtime packages & create user in a single layer
RUN apk add --no-cache netcat-openbsd openssl su-exec && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 \
    PATH="/app/node_modules/.bin:${PATH}"

# Single COPY of prepared artifacts; assign ownership directly
COPY --chown=nextjs:nodejs --from=build /out/ ./

# Normalize line endings & ensure entrypoint is executable
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node healthcheck.js || exit 1

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
