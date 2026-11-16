import prisma from '../../../../lib/prisma';
import { notFound } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { getCharacterDefaultLorebookIds, setCharacterDefaultLorebooks } from '../../../../lib/lorebook/sessionLorebooks';

/**
 * GET /api/characters/:id/lorebooks
 *   → { lorebookIds, existingChatCount }
 * PUT /api/characters/:id/lorebooks
 *   Body: { lorebookIds: number[], applyToExistingChats?: boolean }
 *   Replaces the character's default lorebooks (copied into new chats). With applyToExistingChats,
 *   newly added defaults are also attached to the character's existing chats.
 */
export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    const character = await prisma.character.findUnique({
      where: { id },
      select: { _count: { select: { sessions: true } } },
    });
    if (!character) return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');

    const lorebookIds = await getCharacterDefaultLorebookIds(id);
    return res.status(200).json({ lorebookIds, existingChatCount: character._count.sessions });
  },

  PUT: async (req, res, { id }) => {
    const body = validateBody<{ lorebookIds: number[]; applyToExistingChats: boolean }>(schemas.updateCharacterLorebooks, req, res);
    if (!body) return;

    const result = await setCharacterDefaultLorebooks(id, body.lorebookIds, body.applyToExistingChats);
    if (!result) return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
    return res.status(200).json(result);
  },
});
