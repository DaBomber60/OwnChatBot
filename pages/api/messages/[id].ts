import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { methodNotAllowed } from '../../../lib/apiErrors';
import { parseId } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const messageId = parseId(req.query.id);

  if (messageId === null) {
    return res.status(400).json({ error: 'Invalid message ID' });
  }

  if (req.method === 'PUT') {
    // Update a single message's content
    try {
      const { content } = req.body;
      
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Content is required' });
      }

      const updatedMessage = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { content: content.trim() }
      });

      // Update session's updatedAt timestamp
      await prisma.chatSession.update({
        where: { id: updatedMessage.sessionId },
        data: { updatedAt: new Date() }
      });

      return res.status(200).json(updatedMessage);
    } catch (error) {
      console.error('Error updating message:', error);
      return res.status(500).json({ error: 'Failed to update message' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      // Find the message to get sessionId for updatedAt bump (and to scope truncation)
      const existing = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { sessionId: true, id: true } });
      if (!existing) return res.status(404).json({ error: 'Message not found' });

      const truncate = req.query.truncate === '1' || req.query.truncate === 'true';

      if (truncate) {
        // Delete this message and all subsequent (higher id) messages in the SAME session.
        // We rely on monotonically increasing primary key ids; this is safe since id is autoincrement.
        await prisma.chatMessage.deleteMany({
          where: {
            sessionId: existing.sessionId,
            id: { gte: existing.id }
          }
        });
      } else {
        // Single message deletion (existing behavior)
        await prisma.chatMessage.delete({ where: { id: existing.id } });
      }

      await prisma.chatSession.update({ where: { id: existing.sessionId }, data: { updatedAt: new Date() } });
      return res.status(204).end();
    } catch (error) {
      console.error('Error deleting message:', error);
      return res.status(500).json({ error: 'Failed to delete message' });
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return methodNotAllowed(res, req.method);
}
