/**
 * Edge-safe & Node-safe JWT HS256 sign + verify using only Web Crypto API.
 *
 * Works in both Next.js Edge middleware and Node.js API routes (Node 18+).
 * Uses atob/btoa + crypto.subtle — no external dependencies.
 */

// ---------------------------------------------------------------------------
// Token lifetime constants (seconds)
// ---------------------------------------------------------------------------
export const TOKEN_LIFETIME = 14 * 24 * 60 * 60; // 14 days
export const TOKEN_RENEWAL_THRESHOLD = 7 * 24 * 60 * 60; // renew when >7 days old

// ---------------------------------------------------------------------------
// Base64-url helpers (atob/btoa — universally available in Edge & Node 18+)
// ---------------------------------------------------------------------------

function b64urlToUint8Array(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToB64url(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function strToB64url(str: string): string {
  // Encode as UTF-8 bytes first to handle non-Latin1 characters safely
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlToStr(b64url: string): string {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// HMAC key import (shared between sign & verify)
// ---------------------------------------------------------------------------

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface JwtVerifyResult {
  valid: boolean;
  payload?: Record<string, unknown>;
}

/**
 * Verify an HS256 JWT using Web Crypto.
 * Returns `{ valid: true, payload }` on success; `{ valid: false }` otherwise.
 * Checks `exp` claim automatically if present.
 */
export async function verifyJwtHs256(
  token: string,
  secret: string,
): Promise<JwtVerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const key = await importHmacKey(secret, ['sign']);
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const computed = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
    if (uint8ArrayToB64url(computed) !== sigB64) return { valid: false };
    const payload = JSON.parse(b64urlToStr(payloadB64));
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

/**
 * Sign an HS256 JWT using Web Crypto.
 * Automatically adds `iat` and `exp` (based on `lifetimeSec`, default 14 days).
 */
export async function signJwtHs256(
  payload: Record<string, unknown>,
  secret: string,
  lifetimeSec: number = TOKEN_LIFETIME,
): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: nowSec, exp: nowSec + lifetimeSec };
  const headerB64 = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = strToB64url(JSON.stringify(fullPayload));
  const key = await importHmacKey(secret, ['sign']);
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${headerB64}.${payloadB64}`)),
  );
  return `${headerB64}.${payloadB64}.${uint8ArrayToB64url(sig)}`;
}
