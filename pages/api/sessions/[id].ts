import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { badRequest, notFound, serverError } from '../../../lib/apiErrors';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (req, res, { id }) => {
    // Optional pagination: latest messages bottom-up
    const limitParam = req.query.limit as string | undefined;
    const beforeIdParam = req.query.beforeId as string | undefined;
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 500) : undefined; // cap at 500
    const beforeId = beforeIdParam ? parseInt(beforeIdParam, 10) : undefined;

    // If no limit requested, single full fetch (avoids double query)
    if (!limit) {
      const fullSession = await prisma.chatSession.findUnique({
        where: { id },
        include: {
          persona: true,
          character: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            include: { versions: { orderBy: { version: 'asc' } } }
          }
        }
      });
      if (!fullSession) {
        return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
      }
      return res.status(200).json(fullSession);
    }

    // Paginated path: fetch session meta first
    const sessionMeta = await prisma.chatSession.findUnique({
      where: { id },
      include: { persona: true, character: true }
    });
    if (!sessionMeta) {
      return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    }

    // We paginate by createdAt (stable) using an optional beforeId cursor.
    // Strategy: query (limit + 1) ordered desc, then reverse to asc for client display; hasMore derived from extra record.
    let cursorCreatedAt: Date | undefined = undefined;
    if (beforeId) {
      const cursorMessage = await prisma.chatMessage.findUnique({ where: { id: beforeId }, select: { createdAt: true, sessionId: true } });
      if (!cursorMessage || cursorMessage.sessionId !== id) {
        return badRequest(res, 'Invalid beforeId cursor', 'INVALID_CURSOR');
      }
      cursorCreatedAt = cursorMessage.createdAt;
    }

    const pageMessagesDesc = await prisma.chatMessage.findMany({
      where: {
        sessionId: id,
        ...(cursorCreatedAt ? { createdAt: { lt: cursorCreatedAt } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // fetch one extra to detect more
      include: { versions: { orderBy: { version: 'asc' } } }
    });

    const hasMore = pageMessagesDesc.length > limit;
    const sliced = hasMore ? pageMessagesDesc.slice(0, limit) : pageMessagesDesc;
    const messagesAsc = [...sliced].reverse();

    return res.status(200).json({
      id: sessionMeta.id,
      personaId: sessionMeta.personaId,
      characterId: sessionMeta.characterId,
      summary: sessionMeta.summary,
      lastSummary: sessionMeta.lastSummary,
      description: sessionMeta.description,
      notes: sessionMeta.notes,
      persona: sessionMeta.persona,
      character: sessionMeta.character,
      messages: messagesAsc,
      hasMore
    });
  },

  PUT: async (req, res, { id }) => {
    const body = validateBody<{ messages: { role: string; content: string }[] }>(schemas.replaceSessionMessages, req, res);
    if (!body) return;
    const { messages } = body;

    // Delete existing messages and recreate them with the new content
    // This is a simple approach - in production you might want to be more granular
    await prisma.chatMessage.deleteMany({ where: { sessionId: id } });
    
    // Recreate messages in order
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      await prisma.chatMessage.create({
        data: {
          sessionId: id,
          role: msg.role,
          content: msg.content,
          createdAt: new Date(Date.now() + i) // Ensure proper ordering
        }
      });
    }

    // Update session's updatedAt timestamp
    await prisma.chatSession.update({
      where: { id },
      data: { updatedAt: new Date() }
    });

    return res.status(200).json({ success: true });
  },

  PATCH: async (req, res, { id }) => {
    const body = validateBody(schemas.updateSessionDescription, req, res);
    if (!body) return;
    const { description } = body as any;
    try {
      const updatedSession = await prisma.chatSession.update({
        where: { id },
        data: { 
          description: description,
          updatedAt: new Date()
        }
      });
      return res.status(200).json(updatedSession);
    } catch (error) {
      console.error('Error updating session description:', error);
      return serverError(res, 'Failed to update description', 'DESCRIPTION_UPDATE_FAILED');
    }
  },

  DELETE: async (req, res, { id }) => {
    // remove related messages first to satisfy FK constraints
    await prisma.chatMessage.deleteMany({ where: { sessionId: id } });
    await prisma.chatSession.delete({ where: { id } });
    return res.status(204).end();
  },
});
