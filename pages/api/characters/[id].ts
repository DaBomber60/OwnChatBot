import prisma from '../../../lib/prisma';
import { conflict, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  PUT: async (req, res, { id }) => {
    const body = validateBody(schemas.updateCharacter, req, res);
    if (!body) return;
    const { name, profileName, bio, scenario, personality, firstMessage, exampleDialogue } = body as any;
    const normalizedProfileName = (profileName !== undefined && profileName !== null && profileName.toString().trim().length > 0)
      ? profileName.toString().trim()
      : null;
    try {
      if (normalizedProfileName === null) {
        // Ensure another character (not this one) does not already have same name with null profile
        const existing = await prisma.character.findFirst({ where: { name: name, profileName: null, NOT: { id } } });
        if (existing) {
          return conflict(res, 'Another character with this name already exists without a profile name. Provide a profile name or change the character name.', 'CHARACTER_NAME_CONFLICT_NULL_PROFILE');
        }
      } else {
        const existingCombo = await prisma.character.findFirst({ where: { name: name, profileName: normalizedProfileName, NOT: { id } } });
        if (existingCombo) {
          return conflict(res, 'This character name + profile name combination already exists.', 'CHARACTER_NAME_PROFILE_CONFLICT');
        }
      }
      const updated = await prisma.character.update({
        where: { id },
        data: {
          name,
          scenario: scenario || '',
          personality: personality || '',
          firstMessage: firstMessage || "You didn't enter a first message for this character :(",
          exampleDialogue: exampleDialogue || '',
          ...(profileName !== undefined && { profileName: normalizedProfileName }),
          ...(bio !== undefined && { bio })
        }
      });
      return res.status(200).json(updated);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A character with this name and profile name combination already exists', 'CHARACTER_DUPLICATE');
      }
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
      }
      return serverError(res, 'Failed to update character', 'CHARACTER_UPDATE_FAILED');
    }
  },

  DELETE: async (_req, res, { id }) => {
    try {
      await prisma.chatMessage.deleteMany({ where: { session: { characterId: id } } });
      await prisma.chatSession.deleteMany({ where: { characterId: id } });
      await prisma.character.delete({ where: { id } });
      return res.status(204).end();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
      }
      return serverError(res, 'Failed to delete character', 'CHARACTER_DELETE_FAILED');
    }
  },
});
