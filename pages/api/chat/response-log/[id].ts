import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { requireAuth } from '../../../../lib/apiAuth';
import { parseId } from '../../../../lib/validate';
import { badRequest, notFound, serverError, methodNotAllowed } from '../../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return methodNotAllowed(res, req.method);
  }
  const sessionId = parseId(req.query.id);
  if (!sessionId) {
    return badRequest(res, 'Missing session id', 'MISSING_SESSION_ID');
  }
  try {
  const rows = await prisma.$queryRaw<Array<{ lastApiResponse: string | null }>>`SELECT "lastApiResponse" FROM chat_sessions WHERE id = ${sessionId}`;
  const lastApiResponse = rows[0]?.lastApiResponse;
    if (!lastApiResponse) {
      return notFound(res, 'Response log not found', 'RESPONSE_LOG_NOT_FOUND');
    }
    const payload = JSON.parse(lastApiResponse);
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error fetching response log:', error);
    return serverError(res, 'Failed to fetch response log', 'RESPONSE_LOG_FAILED');
  }
}
