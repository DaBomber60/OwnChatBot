import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { requireAuth } from '../../../../lib/apiAuth';
import { schemas, validateBody } from '../../../../lib/validate';
import { badRequest, notFound, serverError } from '../../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const { id } = req.query;
  const sessionId = parseInt(id as string, 10);

  if (isNaN(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  try {
    if (req.method === 'GET') {
      // Get notes for the session
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId }
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      return res.status(200).json({ notes: (session as any).notes || '' });
    }

    if (req.method === 'POST') {
      const body = validateBody(schemas.notesUpdate, req, res);
      if (!body) return;
      const { notes } = body as any;
      try {
        const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
        if (!session) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
        await prisma.chatSession.update({ where: { id: sessionId }, data: { notes } as any });
        return res.status(200).json({ success: true });
      } catch (err) {
        console.error('Notes update error:', err);
        return serverError(res, 'Failed to update notes', 'NOTES_UPDATE_FAILED');
      }
    }

    // Method not allowed
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Notes API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
