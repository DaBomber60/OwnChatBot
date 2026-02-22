import prisma from '../../../lib/prisma';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { notFound, serverError, tooManyRequests } from '../../../lib/apiErrors';
import { enforceBodySize } from '../../../lib/bodyLimit';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CreateChatData {
  personaId: number;
  characterId: number;
  chatMessages: ChatMessage[];
  summary?: string;
}

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
    const persona = await prisma.persona.findUnique({
      where: { id: personaId }
    });
    
    if (!persona) {
      return notFound(res, 'Persona not found', 'PERSONA_NOT_FOUND');
    }

    const character = await prisma.character.findUnique({
      where: { id: characterId }
    });
    
    if (!character) {
      return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
    }

    // Create chat session
    const session = await prisma.chatSession.create({
      data: {
        personaId: personaId,
        characterId: characterId,
        summary: summary || undefined
      }
    });

    // Create chat messages
    for (const message of chatMessages) {
      await prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: message.role,
          content: message.content
        }
      });
    }

    // Update session timestamp
    await prisma.chatSession.update({
      where: { id: session.id },
      data: { updatedAt: new Date() }
    });

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      message: `Chat created successfully with ${chatMessages.length} messages`
    });
  },
});
