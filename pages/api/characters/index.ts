import prisma from '../../../lib/prisma';
import { conflict, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const characters = await prisma.character.findMany({
      include: { group: true }
    });
    return res.status(200).json(characters);
  },

  POST: async (req, res) => {
    console.log('[/api/characters] Incoming body:', req.body);
    const body = validateBody(schemas.createCharacter, req, res);
    if (!body) return;
    const { name, profileName, bio, scenario, personality, firstMessage, exampleDialogue, groupId } = body as any;
    // Normalize blank profileName to null
    const normalizedProfileName = (profileName && profileName.trim().length > 0) ? profileName.trim() : null;
    try {
      // Enforce custom rule: if profileName is null, name must be unique among null-profileName characters
      if (normalizedProfileName === null) {
        const existing = await prisma.character.findFirst({ where: { name: name, profileName: null } });
        if (existing) {
          return conflict(res, 'A character with this name already exists without a profile name. Either add a profile name or choose a different character name.', 'CHARACTER_NAME_CONFLICT_NULL_PROFILE');
        }
      } else {
        // For clarity provide early conflict detection (optional – DB constraint also catches this)
        const existingCombo = await prisma.character.findFirst({ where: { name: name, profileName: normalizedProfileName } });
        if (existingCombo) {
          return conflict(res, 'This character name + profile name combination already exists.', 'CHARACTER_NAME_PROFILE_CONFLICT');
        }
      }
      const character = await prisma.character.create({
        data: {
          name,
          scenario: scenario || '',
          personality: personality || '',
          firstMessage: firstMessage || "You didn't enter a first message for this character :(",
          exampleDialogue: exampleDialogue || '',
          ...(normalizedProfileName !== null && { profileName: normalizedProfileName }),
          ...(bio && { bio }),
          ...(groupId && { groupId })
        }
      });
      return res.status(201).json(character);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A character with this name and profile name combination already exists', 'CHARACTER_DUPLICATE');
      }
      return serverError(res, 'Failed to create character', 'CHARACTER_CREATE_FAILED');
    }
  },
});
