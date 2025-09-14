import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { requireAuth } from '../../../../lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  
  const { id } = req.query;
  const sessionId = Array.isArray(id) ? id[0] : id;
  
  if (!sessionId) {
    return res.status(400).json({ error: 'Missing session id' });
  }

  try {
    const rows = await prisma.$queryRaw<Array<{ lastApiRequest: string | null }>>`SELECT "lastApiRequest" FROM chat_sessions WHERE id = ${parseInt(sessionId)}`;
    const lastApiRequest = rows[0]?.lastApiRequest;
    if (!lastApiRequest) {
      return res.status(404).json({ error: 'Request log not found' });
    }
    const payload = JSON.parse(lastApiRequest);
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching request log:', error);
    return res.status(500).json({ error: 'Failed to fetch request log' });
  }
}
