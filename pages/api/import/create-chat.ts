import prisma from '../../../lib/prisma';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { notFound, tooManyRequests } from '../../../lib/apiErrors';
import { enforceBodySize } from '../../../lib/bodyLimit';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';
import { createImportedChat } from '../../../lib/importChat';

export default withApiHandler({ auth: false }, {
  POST: async (req, res) => {
    const ip = clientIp(req as any);
    const rl = limiters.importCreateChat(ip);
    if (!rl.allowed) {
      return tooManyRequests(res, 'Import chat creation rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
    }
    if (!enforceBodySize(req as any, res, 5 * 1024 * 1024)) return; // 5MB limit for bulk chat creation payload

    const body = validateBody<{ personaId: number; characterId: number; chatMessages: { role: 'user' | 'assistant'; content: string }[]; summary?: string }>(schemas.importCreateChat, req, res);
    if (!body) return;
    const { personaId, characterId, chatMessages, summary } = body;

    // Verify persona and character exist
    const persona = await prisma.persona.findUnique({ where: { id: personaId } });
    if (!persona) return notFound(res, 'Persona not found', 'PERSONA_NOT_FOUND');

    const character = await prisma.character.findUnique({ where: { id: characterId } });
    if (!character) return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');

    const result = await createImportedChat({
      personaId,
      characterId,
      messages: chatMessages,
      summary,
    });

    return res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      message: `Chat created successfully with ${result.messageCount} messages`,
    });
  },
});
