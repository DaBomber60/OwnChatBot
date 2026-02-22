import type { NextApiRequest, NextApiResponse } from 'next';
import { getJwtSecret } from './jwtSecret';
import { unauthorized, serverError } from './apiErrors';
import { verifyJwtHs256 } from './jwtCrypto';
import { getPasswordVersion } from './passwordVersion';

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
    const currentVersion = await getPasswordVersion();
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
