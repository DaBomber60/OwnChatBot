import type { NextApiRequest, NextApiResponse } from 'next';
import { getCachedImportToken } from '../../../lib/importToken';
import { getPasswordVersion } from '../../../lib/passwordVersion';
import { FALLBACK_JWT_SECRET } from '../../../lib/jwtSecret';
import { methodNotAllowed } from '../../../lib/apiErrors';

// This endpoint returns the current import bearer token (requires regular auth via middleware).
// The token changes when the password version changes.

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return methodNotAllowed(res, req.method);
  }
  try {
    const version = await getPasswordVersion();
    const token = await getCachedImportToken(version, FALLBACK_JWT_SECRET);
    res.status(200).json({ token, version });
  } catch (e) {
    console.error('Failed to produce import token', e);
    res.status(500).json({ error: 'Failed to derive token' });
  }
}
