import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { requireAuth } from '../../../../lib/apiAuth';
import { badRequest, notFound, serverError, methodNotAllowed } from '../../../../lib/apiErrors';
import { parseId } from '../../../../lib/validate';

// POST /api/sessions/:id/clone
// Clones a session, duplicating: session row (summary, description, notes, lastSummary),
// messages (with versions), preserving original createdAt ordering.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const sessionId = parseId(req.query.id);
  if (sessionId === null) {
    return badRequest(res, 'Invalid session ID', 'INVALID_SESSION_ID');
  }

  try {
    const original = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { versions: { orderBy: { version: 'asc' } } }
        }
      }
    });

    if (!original) {
      return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    }

    const newSession = await prisma.$transaction(async (tx) => {
      // Duplicate session base row (excluding PK + timestamps auto-handled)
      const clonedSession = await tx.chatSession.create({
        data: {
          personaId: original.personaId,
            characterId: original.characterId,
            summary: original.summary ?? null,
            description: original.description ?? null,
            notes: (original as any).notes ?? null,
            lastSummary: original.lastSummary ?? null,
          }
      });

      // Recreate messages preserving their relative createdAt ordering.
      // We keep original createdAt values to preserve chronology context.
      for (const msg of original.messages) {
        const newMsg = await tx.chatMessage.create({
          data: {
            sessionId: clonedSession.id,
            role: msg.role,
            content: msg.content,
            createdAt: msg.createdAt
          }
        });
        if (msg.versions?.length) {
          for (const ver of msg.versions) {
            await tx.messageVersion.create({
              data: {
                messageId: newMsg.id,
                content: ver.content,
                version: ver.version,
                isActive: ver.isActive,
                createdAt: ver.createdAt
              }
            });
          }
        }
      }

      return clonedSession;
    });

    return res.status(201).json({ id: newSession.id });
  } catch (error) {
    console.error('Clone session error:', error);
    return serverError(res, 'Failed to clone session', 'CLONE_FAILED');
  }
}
