import { getCachedImportToken } from '../../../lib/importToken';
import { getPasswordVersion } from '../../../lib/passwordVersion';
import { FALLBACK_JWT_SECRET } from '../../../lib/jwtSecret';
import { serverError } from '../../../lib/apiErrors';
import { withApiHandler } from '../../../lib/withApiHandler';

// This endpoint returns the current import bearer token (requires regular auth via middleware).
// The token changes when the password version changes.

export default withApiHandler({ auth: false }, {
  GET: async (_req, res) => {
    try {
      const version = await getPasswordVersion();
      const token = await getCachedImportToken(version, FALLBACK_JWT_SECRET);
      res.status(200).json({ token, version });
    } catch (e) {
      console.error('Failed to produce import token', e);
      return serverError(res, 'Failed to derive token', 'TOKEN_DERIVATION_FAILED');
    }
  },
});
