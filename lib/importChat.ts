import prisma from './prisma';
import { resolveInitialSessionLore, sessionLoreCreateData } from './lorebook/sessionLorebooks';

export interface ImportMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CreateImportedChatOptions {
  personaId: number;
  characterId: number;
  messages: ImportMessage[];
  summary?: string;
}

/**
 * Shared core for both import flows: creates a ChatSession, bulk-inserts messages
 * via createMany, bumps the session timestamp, and returns the result.
 */
export async function createImportedChat(opts: CreateImportedChatOptions) {
  const { personaId, characterId, messages, summary } = opts;

  // Create session with the character's default lorebooks
  const lore = await resolveInitialSessionLore(characterId);
  const session = await prisma.chatSession.create({
    data: {
      personaId,
      characterId,
      ...(summary ? { summary } : {}),
      ...sessionLoreCreateData(lore),
    },
  });

  // Bulk-insert messages (single query instead of N sequential inserts)
  if (messages.length > 0) {
    await prisma.chatMessage.createMany({
      data: messages.map((m) => ({
        sessionId: session.id,
        role: m.role,
        content: m.content,
      })),
    });
  }

  // Bump session timestamp so it sorts correctly in "recent" lists
  await prisma.chatSession.update({
    where: { id: session.id },
    data: { updatedAt: new Date() },
  });

  return {
    success: true as const,
    sessionId: session.id,
    messageCount: messages.length,
  };
}
