import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, notFound, serverError, methodNotAllowed } from '../../../lib/apiErrors';
import { parseId, schemas, validateBody } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const messageId = parseId(req.query.id);

  if (messageId === null) {
    return badRequest(res, 'Invalid message ID', 'INVALID_MESSAGE_ID');
  }

  if (req.method === 'PUT') {
    // Update a single message's content
    try {
      const body = validateBody<{ content: string }>(schemas.updateMessageContent, req, res);
      if (!body) return;
      const { content } = body;

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
      return serverError(res, 'Failed to update message', 'MESSAGE_UPDATE_FAILED');
    }
  }

  if (req.method === 'DELETE') {
    try {
      // Find the message to get sessionId for updatedAt bump (and to scope truncation)
      const existing = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { sessionId: true, id: true } });
      if (!existing) return notFound(res, 'Message not found', 'MESSAGE_NOT_FOUND');

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
      return serverError(res, 'Failed to delete message', 'MESSAGE_DELETE_FAILED');
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return methodNotAllowed(res, req.method);
}
