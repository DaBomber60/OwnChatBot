import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { badRequest, notFound, serverError, methodNotAllowed, tooManyRequests } from '../../../lib/apiErrors';
import { enforceBodySize } from '../../../lib/bodyLimit';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const ip = clientIp(req as any);
  const rl = limiters.importCreateChat(ip);
  if (!rl.allowed) {
    return tooManyRequests(res, 'Import chat creation rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
  }
  if (!enforceBodySize(req as any, res, 5 * 1024 * 1024)) return; // 5MB limit for bulk chat creation payload

  try {
    const { personaId, characterId, chatMessages, summary }: CreateChatData = req.body;

    if (!personaId || !characterId || !chatMessages || !Array.isArray(chatMessages)) {
      return badRequest(res, 'Missing required data: personaId, characterId, and chatMessages are required', 'MISSING_IMPORT_CHAT_DATA');
    }

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

  } catch (error) {
    console.error('Chat creation error:', error);
    return serverError(res, 'Failed to create chat', 'IMPORT_CHAT_CREATE_FAILED');
  }
}
