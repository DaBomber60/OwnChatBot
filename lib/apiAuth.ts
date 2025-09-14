import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from './prisma';
import { getJwtSecret } from './jwtSecret';
import { unauthorized, serverError } from './apiErrors';

// Edge-safe base64url utilities for manual HS256 verification
function b64urlToUint8Array(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url.replace(/-/g, '+').replace(/_/g, '/')) + pad;
  const binary = Buffer.from(b64, 'base64');
  return new Uint8Array(binary);
}
function uint8ArrayToB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function verifyJwtHs256(token: string, secret: string): Promise<{ valid: boolean; payload?: any }>{
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const enc = new TextEncoder();
    const keyData = enc.encode(secret);
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const data = enc.encode(`${headerB64}.${payloadB64}`);
    const computed = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
    const computedB64 = uint8ArrayToB64url(computed);
    if (computedB64 !== sigB64) return { valid: false };
    const json = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

/**
 * Unified auth guard for API routes.
 * Implements Section 3 (Token / Session Invalidation Mechanics):
 *  - Tokens carry password version claim `v`.
 *  - Current version stored in Setting key `authPasswordVersion`.
 *  - Rejects token if versions mismatch.
 * Returns true if authorized; otherwise sends a 401/500 response and returns false.
 */
export async function requireAuth(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  // Public (unauthenticated) endpoints
  const publicPaths = [
    '/api/auth/login',
    '/api/auth/setup',
    '/api/auth/verify',
    '/api/auth/logout',
    '/api/health',
    '/api/internal/password-version'
  ];
  if (publicPaths.includes(req.url || '')) return true;

  const JWT_SECRET = await getJwtSecret();

  const cookieHeader = req.headers.cookie || '';
  const token = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('hcb_auth='))?.split('=')[1];
  if (!token) {
    unauthorized(res);
    return false;
  }

  try {
    const result = await verifyJwtHs256(token, JWT_SECRET);
    if (!result.valid) {
      unauthorized(res, 'Invalid or expired token');
      return false;
    }
    const decoded = result.payload as { v?: number };
    // Fetch current password version (defaults to 1 if not set) and compare
    const versionSetting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
    const currentVersion = versionSetting ? parseInt(versionSetting.value, 10) || 1 : 1;
    if (decoded.v !== currentVersion) {
      unauthorized(res, 'Session expired', 'TOKEN_VERSION_MISMATCH');
      return false;
    }
    return true;
  } catch (e) {
    unauthorized(res, 'Invalid or expired token');
    return false;
  }
}
