import prisma from '../../../lib/prisma';
import { notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  PUT: async (req, res, { id }) => {
    // Update a single message's content
    try {
      const body = validateBody<{ content: string }>(schemas.updateMessageContent, req, res);
      if (!body) return;
      const { content } = body;

      const updatedMessage = await prisma.chatMessage.update({
        where: { id },
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
  },

  DELETE: async (req, res, { id }) => {
    try {
      // Find the message to get sessionId for updatedAt bump (and to scope truncation)
      const existing = await prisma.chatMessage.findUnique({ where: { id }, select: { sessionId: true, id: true } });
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
  },
});
