import { getJwtSecret } from '../../../lib/jwtSecret';
import { serverError, unauthorized } from '../../../lib/apiErrors';
import { getPasswordVersion } from '../../../lib/passwordVersion';
import { withApiHandler } from '../../../lib/withApiHandler';
import { verifyJwtHs256 } from '../../../lib/jwtCrypto';

// Dynamic secret (env override or DB persisted)

export default withApiHandler(
  { auth: false },
  {
    POST: async (req, res) => {
      const JWT_SECRET = await getJwtSecret();

      // Read cookie
      const cookieHeader = req.headers.cookie || '';
      const token = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('hcb_auth='))?.split('=')[1];

      if (!token) {
        console.warn('[auth/verify] No auth cookie present. Raw cookie header:', cookieHeader);
        return unauthorized(res, 'No auth cookie', 'NO_AUTH_COOKIE');
      }

      try {
        const result = await verifyJwtHs256(token, JWT_SECRET);
        if (!result.valid || !result.payload?.authenticated) {
          console.warn('[auth/verify] Token invalid or missing authenticated flag.');
          return unauthorized(res, 'Invalid token', 'INVALID_TOKEN');
        }
        const decoded = result.payload as { authenticated?: boolean; v?: number };

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
    },
  }
);
