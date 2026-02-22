## syntax=docker/dockerfile:1.7
# Layer-reduced multi-stage build for Next.js + Prisma
# Goals:
#  - Consolidate RUN steps
#  - Produce a single artifact directory then one COPY into final image
#  - Use BuildKit cache mounts for faster npm ci + build

FROM node:24.3.0-alpine3.21 AS build
ARG APP_VERSION=0.0.0-untagged
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION} \
    APP_VERSION=${APP_VERSION}
WORKDIR /app

# System packages needed during build (prisma engines, openssl) and for generating standalone output
RUN set -eux; \
    apk add --no-cache libc6-compat openssl netcat-openbsd; \
    apk upgrade --no-cache busybox; \
    if apk version -l '<' busybox=1.37.0-r20 | grep -q busybox; then \
        echo "BusyBox upgrade did not reach required version (>=1.37.0-r20)" >&2; \
        apk list --installed busybox >&2; \
        exit 1; \
    fi; \
    apk upgrade --no-cache openssl; \
    apk list --installed busybox openssl

# Copy only manifests + prisma schema first for better dependency layer caching
COPY package.json package-lock.json* ./
# Rewrite package.json version field early so subsequent layers (install/build) embed correct version
RUN node -e "const fs=require('fs');const p=require('./package.json');const raw=(process.env.NEXT_PUBLIC_APP_VERSION||'0.0.0').trim();const normalized=raw.startsWith('v')?raw.slice(1):raw;if(!/^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$/.test(normalized)){console.error('Invalid APP_VERSION semver:',normalized,'from',raw);process.exit(1);}p.version=normalized;fs.writeFileSync('package.json',JSON.stringify(p,null,2));console.log('Updated package.json version to',normalized,'(raw:',raw,')');"
COPY prisma ./prisma

# TARGETARCH is auto-set by BuildKit (amd64, arm64, etc.) — used to isolate
# npm cache mounts per platform so parallel multi-arch builds don't corrupt each other.
ARG TARGETARCH

# Install all dependencies (dev + prod) with cache mount; fall back if lockfile missing
RUN --mount=type=cache,target=/root/.npm,id=npm-${TARGETARCH} \
    if [ -f package-lock.json ]; then \
      echo "Using package-lock.json with npm ci" && npm ci; \
    else \
      echo "WARNING: package-lock.json not found. Falling back to 'npm install' (consider committing a lockfile)." && npm install; \
    fi && \
    npm cache clean --force

# Copy full source (after deps to keep cache stable on code-only changes)
COPY . .

# Generate Prisma client, build Next.js (standalone), then prune dev deps in a single layer
RUN --mount=type=cache,target=/root/.npm,id=npm-${TARGETARCH} \
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

FROM node:24.3.0-alpine3.21 AS runner
ARG APP_VERSION=0.0.0-untagged
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION} \
    APP_VERSION=${APP_VERSION}
WORKDIR /app

# Install only runtime packages & create user in a single layer
# npm/npx are NOT needed at runtime — prisma binary is invoked directly via PATH.
# Removing npm eliminates its transitive CVEs (tar, @isaacs/brace-expansion, diff).
RUN set -eux; \
    apk add --no-cache netcat-openbsd openssl su-exec; \
    apk upgrade --no-cache busybox; \
    if apk version -l '<' busybox=1.37.0-r20 | grep -q busybox; then \
        echo "BusyBox upgrade did not reach required version (>=1.37.0-r20)" >&2; \
        apk list --installed busybox >&2; \
        exit 1; \
    fi; \
    apk upgrade --no-cache openssl; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx; \
    addgroup --system --gid 1001 nodejs; \
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
