// Central JWT secret accessor. We now REQUIRE the runtime to provide JWT_SECRET.
// The docker-entrypoint auto-generates and exports a stable secret stored in /app/data/jwt-secret
// so self-hosters do not have to configure anything manually. We keep an async signature so existing
// imports do not need to change.

let cached: string | null = null;

export async function getJwtSecret(): Promise<string> {
  if (cached) return cached;
  const raw = process.env.JWT_SECRET?.trim();
  if (!raw) {
    // Fail fast – this should never happen if entrypoint executed correctly.
    throw new Error('JWT_SECRET missing at runtime. Entry point did not generate or export it.');
  }
  if (raw === 'dev-fallback-insecure-secret-change-me') {
    console.warn('[jwtSecret] Using insecure fallback secret. This should not occur in production image.');
  }
  cached = raw;
  return cached;
}

export function clearJwtSecretCache() { cached = null; }
