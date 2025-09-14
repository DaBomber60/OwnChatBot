import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { getCachedImportToken } from '../../../lib/importToken';

// This endpoint returns the current import bearer token (requires regular auth via middleware).
// The token changes when the password version changes.

const FALLBACK_JWT_SECRET = process.env.JWT_SECRET || 'dev-fallback-insecure-secret-change-me';

async function getPasswordVersion(): Promise<number> {
  try {
    const setting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
    return setting ? parseInt(setting.value, 10) || 1 : 1;
  } catch {
    return 1;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
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
