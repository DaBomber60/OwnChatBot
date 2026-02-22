import prisma from '../../../../lib/prisma';
import { badRequest, conflict } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { createImportedChat } from '../../../../lib/importChat';

export default withApiHandler({}, {
  POST: async (req, res) => {
    const body = validateBody<{ characterId?: number; newCharacter?: { name: string; profileName: string; personality: string; scenario: string; exampleDialogue: string; firstMessage: string }; personaName: string; chatMessages: { role: 'user' | 'assistant'; content: string }[] }>(schemas.chatImportCreate, req, res);
    if (!body) return;
    const { characterId, newCharacter, personaName, chatMessages } = body;

    let finalCharacterId: number | undefined = characterId;

    // Create new character if needed
    if (!characterId && newCharacter) {
      const existingChar = await prisma.character.findFirst({
        where: { name: newCharacter.name, profileName: newCharacter.profileName },
      });
      if (existingChar) {
        return conflict(res, `Character "${newCharacter.name}" with profile "${newCharacter.profileName}" already exists`, 'CHARACTER_DUPLICATE');
      }
      const created = await prisma.character.create({ data: newCharacter });
      finalCharacterId = created.id;
    }

    if (!finalCharacterId) {
      return badRequest(res, 'No character specified or created', 'NO_CHARACTER');
    }

    // Find or create persona
    let persona = await prisma.persona.findFirst({ where: { name: personaName } });
    if (!persona) {
      persona = await prisma.persona.create({
        data: { name: personaName, profile: `Imported persona: ${personaName}` },
      });
    }

    const result = await createImportedChat({
      personaId: persona.id,
      characterId: finalCharacterId,
      messages: chatMessages,
    });

    return res.status(200).json({
      success: true,
      sessionId: result.sessionId,
      message: `Chat imported successfully with ${result.messageCount} messages`,
    });
  },
});
