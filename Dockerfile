# Use Node.js 24 Alpine for smaller image size and security updates
FROM node:24-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl netcat-openbsd
WORKDIR /app

# Copy manifest & schema first for better layer caching
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install ALL deps (dev + prod) so build tools (TypeScript, Tailwind, Prisma CLI) are available.
# If a lockfile is missing, fall back to npm install (less reproducible) but do not fail.
RUN if [ -f package-lock.json ]; then \
      echo "Using package-lock.json with npm ci" && npm ci; \
    else \
      echo "WARNING: package-lock.json not found. Falling back to 'npm install' (consider committing a lockfile)." && npm install; \
    fi \
    && npm cache clean --force

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client (will use local schema & full deps)
RUN npx prisma generate

# Build the application (Next.js standalone output)
RUN npm run build

# Now that prisma CLI is a production dependency, we can safely prune dev deps.
RUN npm prune --omit=dev || true

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

# Install required runtime packages (netcat for DB checks, openssl for secrets)
RUN apk add --no-cache netcat-openbsd openssl su-exec

ENV NODE_ENV=production

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Copy prisma CLI and related packages to avoid dynamic install during migrations
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
## Copy @prisma namespace (engines, platform helpers, etc.) needed by the CLI
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
## Copy entire .bin to preserve prisma symlink & any other required binaries
COPY --from=builder /app/node_modules/.bin ./node_modules/.bin
## (Optional) Ensure PATH includes local binaries
ENV PATH="/app/node_modules/.bin:${PATH}"
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=builder /app/healthcheck.js ./healthcheck.js

# Fix line endings and set permissions for entrypoint script
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

# Change ownership to nextjs user for existing files (volumes may override later)
RUN chown -R nextjs:nodejs /app

# Stay as root for entrypoint so we can fix ownership of mounted volumes at runtime; entrypoint will drop privileges.
# (Security note: entrypoint uses su-exec to run the final process as nextjs.)

# Expose the port the app runs on
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check (ensure healthcheck.js present in final image)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node healthcheck.js

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
