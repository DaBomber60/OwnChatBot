import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../../lib/jwtSecret';
import { methodNotAllowed, serverError, unauthorized } from '../../../lib/apiErrors';
import { getPasswordVersion } from '../../../lib/passwordVersion';

// Dynamic secret (env override or DB persisted)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const JWT_SECRET = await getJwtSecret();

  // Read cookie
  const cookieHeader = req.headers.cookie || '';
  const token = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('hcb_auth='))?.split('=')[1];

  if (!token) {
    console.warn('[auth/verify] No auth cookie present. Raw cookie header:', cookieHeader);
    return unauthorized(res, 'No auth cookie', 'NO_AUTH_COOKIE');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { authenticated?: boolean; v?: number };
    if (!decoded.authenticated) {
      console.warn('[auth/verify] Token decoded but missing authenticated flag. Decoded:', decoded);
      return unauthorized(res, 'Invalid token', 'INVALID_TOKEN');
    }

    const currentVersion = await getPasswordVersion();
    if (decoded.v !== currentVersion) {
      console.warn('[auth/verify] Version mismatch. Token v:', decoded.v, 'Current v:', currentVersion);
      return unauthorized(res, 'Token version outdated', 'TOKEN_VERSION_OUTDATED');
    }

    // Success diagnostic (throttled: only log occasionally)
    if (Math.random() < 0.05) {
      console.log('[auth/verify] Success for token v', decoded.v);
    }
    return res.status(200).json({ valid: true });
  } catch (err: any) {
    console.warn('[auth/verify] JWT verify error:', err?.name, err?.message);
    return unauthorized(res, 'Invalid or expired token', 'INVALID_OR_EXPIRED_TOKEN');
  }
}
