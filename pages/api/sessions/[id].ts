import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody, parseId } from '../../../lib/validate';
import { badRequest, methodNotAllowed } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const sessionId = parseId(req.query.id);
  
  if (sessionId === null) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  if (req.method === 'GET') {
    // Optional pagination: latest messages bottom-up
    const limitParam = req.query.limit as string | undefined;
    const beforeIdParam = req.query.beforeId as string | undefined;
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 500) : undefined; // cap at 500
    const beforeId = beforeIdParam ? parseInt(beforeIdParam, 10) : undefined;

    // Always fetch session meta first
    const sessionMeta = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { persona: true, character: true }
    });
    if (!sessionMeta) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // If no limit requested, preserve existing full fetch behavior
    if (!limit) {
      const fullSession = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          persona: true,
          character: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            include: { versions: { orderBy: { version: 'asc' } } }
          }
        }
      });
      return res.status(200).json(fullSession);
    }

    // We paginate by createdAt (stable) using an optional beforeId cursor.
    // Strategy: query (limit + 1) ordered desc, then reverse to asc for client display; hasMore derived from extra record.
    let cursorCreatedAt: Date | undefined = undefined;
    if (beforeId) {
      const cursorMessage = await prisma.chatMessage.findUnique({ where: { id: beforeId }, select: { createdAt: true, sessionId: true } });
      if (!cursorMessage || cursorMessage.sessionId !== sessionId) {
        return res.status(400).json({ error: 'Invalid beforeId cursor' });
      }
      cursorCreatedAt = cursorMessage.createdAt;
    }

    const pageMessagesDesc = await prisma.chatMessage.findMany({
      where: {
        sessionId,
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
  }

  if (req.method === 'PUT') {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid messages data' });
    }

    // Delete existing messages and recreate them with the new content
    // This is a simple approach - in production you might want to be more granular
    await prisma.chatMessage.deleteMany({ where: { sessionId } });
    
    // Recreate messages in order
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      await prisma.chatMessage.create({
        data: {
          sessionId: sessionId,
          role: message.role,
          content: message.content,
          createdAt: new Date(Date.now() + i) // Ensure proper ordering
        }
      });
    }

    // Update session's updatedAt timestamp
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() }
    });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'PATCH') {
    const body = validateBody(schemas.updateSessionDescription, req, res);
    if (!body) return;
    const { description } = body as any;
    try {
      const updatedSession = await prisma.chatSession.update({
        where: { id: sessionId },
        data: { 
          description: description,
          updatedAt: new Date()
        }
      });
      return res.status(200).json(updatedSession);
    } catch (error) {
      console.error('Error updating session description:', error);
      return res.status(500).json({ error: 'Failed to update description' });
    }
  }

  if (req.method === 'DELETE') {
    // remove related messages first to satisfy FK constraints
    await prisma.chatMessage.deleteMany({ where: { sessionId } });
    await prisma.chatSession.delete({ where: { id: sessionId } });
    return res.status(204).end();
  }

  res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
  return methodNotAllowed(res, req.method);
}
