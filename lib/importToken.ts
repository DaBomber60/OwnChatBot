// Utility to derive an import bearer token that is:
// - Stable while the password version stays the same
// - Automatically changes when the password version increments (e.g., on password change)
// We derive an HMAC-SHA256 using the JWT secret and the string `import:${version}` and
// base64url encode the full digest, truncating for brevity.

import { toBase64Url } from './base64url';

export async function deriveImportToken(version: number, secret: string): Promise<string> {
  const dataStr = `import:${version}`;
  // Use WebCrypto subtle if available (edge/runtime safe), else Node crypto
  try {
    if (typeof crypto !== 'undefined' && (crypto as any).subtle) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(dataStr)));
      return toBase64Url(sig).slice(0, 40); // truncate to 40 chars for usability
    }
  } catch {
    // fallback below
  }
  // Node.js fallback
  // Use dynamic import to avoid CommonJS require (ESLint compliant)
  const { createHmac } = await import('crypto');
  const h = createHmac('sha256', secret).update(dataStr).digest();
  return toBase64Url(h).slice(0, 40);
}

// Convenience helper to memoize per process (light optimization for server endpoints)
let cached: { v: number; token: string } | null = null;
export async function getCachedImportToken(version: number, secret: string): Promise<string> {
  if (cached && cached.v === version) return cached.token;
  const t = await deriveImportToken(version, secret);
  cached = { v: version, token: t };
  return t;
}
