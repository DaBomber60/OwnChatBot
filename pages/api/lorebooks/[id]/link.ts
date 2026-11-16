import prisma from '../../../../lib/prisma';
import { serverError, notFound, badRequest } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { GLOBAL_LOREBOOK_ID } from '../../../../lib/globalLorebook';

/**
 * POST /api/lorebooks/:id/link
 * Link a lorebook to a character
 *
 * Body: { characterId: number }
 */
export default withApiHandler({}, {
  POST: async (req, res) => {
    const lorebookId = parseInt(req.query.id as string, 10);
    if (isNaN(lorebookId)) {
      return res.status(400).json({ error: 'Invalid lorebook ID', code: 'INVALID_ID' });
    }
    if (lorebookId === GLOBAL_LOREBOOK_ID) {
      return badRequest(res, 'The global lorebook already applies to every chat and cannot be linked to a character', 'GLOBAL_LOREBOOK_NOT_LINKABLE');
    }

    const body = validateBody(schemas.linkLorebook, req, res);
    if (!body) return;
    const { characterId } = body as any;

    try {
      const lorebook = await prisma.lorebook.findUnique({ where: { id: lorebookId } });
      if (!lorebook) {
        return notFound(res, 'Lorebook not found', 'LOREBOOK_NOT_FOUND');
      }

      const character = await prisma.character.findUnique({ where: { id: characterId } });
      if (!character) {
        return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
      }

      // Check if link already exists
      const existing = await prisma.characterLorebook.findUnique({
        where: { characterId_lorebookId: { characterId, lorebookId } },
      });
      if (existing) {
        return res.status(409).json({ error: 'Character already has this lorebook linked', code: 'LINK_ALREADY_EXISTS' });
      }

      const link = await prisma.characterLorebook.create({
        data: { characterId, lorebookId },
      });

      return res.status(201).json(link);
    } catch {
      return serverError(res, 'Failed to link lorebook to character', 'LINK_CREATE_FAILED');
    }
  },
});
