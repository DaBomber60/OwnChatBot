import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (req, res) => {
    // Optional query params: ?limit=N&sort=updatedAt
    const limitParam = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const take = limitParam && !isNaN(limitParam) && limitParam > 0 ? limitParam : undefined;
    const sortField = req.query.sort === 'updatedAt' ? 'updatedAt' as const : 'createdAt' as const;

    // Run count in parallel with findMany when a limit is applied (cheap COUNT(*) query)
    const [sessions, totalCount] = await Promise.all([
      prisma.chatSession.findMany({
        select: {
          id: true,
          personaId: true,
          characterId: true,
          updatedAt: true,
          summary: true,
          description: true,
          persona: { select: { id: true, name: true, profileName: true } },
          character: { select: { id: true, name: true, profileName: true } },
          _count: { select: { messages: true } }
        },
        orderBy: { [sortField]: 'desc' },
        ...(take ? { take } : {})
      }),
      take ? prisma.chatSession.count() : Promise.resolve(undefined)
    ]);

    const shapedSessions = sessions.map(session => ({
      id: session.id,
      personaId: session.personaId,
      characterId: session.characterId,
      updatedAt: session.updatedAt,
      summary: session.summary,
      description: session.description,
      messageCount: session._count.messages,
      persona: session.persona,
      character: session.character
    }));

    if (totalCount !== undefined) {
      res.setHeader('X-Total-Count', String(totalCount));
    }
    return res.status(200).json(shapedSessions);
  },

  POST: async (req, res) => {
    const body = validateBody(schemas.createSession, req, res);
    if (!body) return;
    const { personaId, characterId, skipFirstMessage } = body as any;
    // create session
    const session = await prisma.chatSession.create({ data: { personaId, characterId } });

    // Only seed first assistant message if not explicitly skipped
    if (!skipFirstMessage) {
      const persona = await prisma.persona.findUnique({ where: { id: personaId } });
      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (persona && character) {
        const content = character.firstMessage
          .replace(/{{user}}/g, persona.name)
          .replace(/{{char}}/g, character.name);
        await prisma.chatMessage.create({ data: { sessionId: session.id, role: 'assistant', content } });
      }
    }

    return res.status(201).json(session);
  },
});
