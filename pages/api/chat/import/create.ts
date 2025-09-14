import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { requireAuth } from '../../../../lib/apiAuth';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CreateChatData {
  characterId?: number;
  newCharacter?: {
    name: string;
    profileName: string;
    personality: string;
    scenario: string;
    exampleDialogue: string;
    firstMessage: string;
  };
  personaName: string;
  chatMessages: ChatMessage[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { characterId, newCharacter, personaName, chatMessages }: CreateChatData = req.body;

    if (!personaName || !chatMessages || !Array.isArray(chatMessages)) {
      return res.status(400).json({ error: 'Missing required data' });
    }

    let finalCharacterId: number | undefined = characterId;

    // Create new character if needed
    if (!characterId && newCharacter) {
      // Check if character with same name+profile combination already exists
      const existingChar = await prisma.character.findFirst({
        where: {
          name: newCharacter.name,
          profileName: newCharacter.profileName
        }
      });

      if (existingChar) {
        return res.status(400).json({ error: `Character "${newCharacter.name}" with profile "${newCharacter.profileName}" already exists` });
      }

      const createdCharacter = await prisma.character.create({
        data: {
          name: newCharacter.name,
          profileName: newCharacter.profileName,
          personality: newCharacter.personality,
          scenario: newCharacter.scenario,
          exampleDialogue: newCharacter.exampleDialogue,
          firstMessage: newCharacter.firstMessage
        }
      });
      finalCharacterId = createdCharacter.id;
    }

    if (!finalCharacterId) {
      return res.status(400).json({ error: 'No character specified or created' });
    }

    // Find or create persona
    let persona = await prisma.persona.findFirst({
      where: { name: personaName }
    });

    if (!persona) {
      persona = await prisma.persona.create({
        data: {
          name: personaName,
          profile: `Imported persona: ${personaName}`
        }
      });
    }

    // Create chat session
    const session = await prisma.chatSession.create({
      data: {
        personaId: persona.id,
        characterId: finalCharacterId
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
      message: `Chat imported successfully with ${chatMessages.length} messages`
    });

  } catch (error) {
    console.error('Chat creation error:', error);
    return res.status(500).json({ error: 'Failed to create chat' });
  }
}
