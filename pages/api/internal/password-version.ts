import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end('Method Not Allowed');
  }
  try {
    const versionSetting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
    const version = versionSetting ? parseInt(versionSetting.value, 10) || 1 : 1;
    res.status(200).json({ version });
  } catch (e) {
    res.status(200).json({ version: 1 });
  }
}
