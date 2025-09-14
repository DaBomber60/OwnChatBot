import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody } from '../../../lib/validate';
import { validationError } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method === 'GET') {
    const all = await prisma.setting.findMany();
    const result: Record<string, string> = {};
    all.forEach((s: { key: string; value: string }) => { result[s.key] = s.value; });
    return res.status(200).json(result);
  }
  if (req.method === 'POST') {
    const body = validateBody(schemas.upsertSettings, req, res);
    if (!body) return;
    const upserts = Object.entries(body as any).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      })
    );
    await Promise.all(upserts);
    return res.status(200).json({ success: true });
  }
  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
