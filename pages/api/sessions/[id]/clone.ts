import prisma from '../../../../lib/prisma';
import { notFound, serverError } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';

// POST /api/sessions/:id/clone
// Clones a session, duplicating: session row (summary, description, notes, lastSummary),
// messages (with versions), preserving original createdAt ordering.
export default withApiHandler({ parseId: true }, {
  POST: async (req, res, { id }) => {
    try {
      const original = await prisma.chatSession.findUnique({
        where: { id },
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
  },
});
