import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { methodNotAllowed } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return methodNotAllowed(res, req.method);
  }
  try {
    const versionSetting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
    const version = versionSetting ? parseInt(versionSetting.value, 10) || 1 : 1;
    res.status(200).json({ version });
  } catch (e) {
    res.status(200).json({ version: 1 });
  }
}
