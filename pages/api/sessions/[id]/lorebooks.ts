import prisma from '../../../../lib/prisma';
import { notFound } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';
import {
  getCharacterDefaultLorebookIds,
  getSessionLoreConfig,
  setSessionLore,
} from '../../../../lib/lorebook/sessionLorebooks';

/**
 * GET /api/sessions/:id/lorebooks
 *   → { globalLoreEnabled, lorebookIds, characterDefaultIds }
 * PUT /api/sessions/:id/lorebooks
 *   Body: { lorebookIds: number[], globalLoreEnabled?: boolean } — replaces the chat's lorebook set.
 */
export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    const session = await prisma.chatSession.findUnique({ where: { id }, select: { characterId: true } });
    if (!session) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');

    const [config, characterDefaultIds] = await Promise.all([
      getSessionLoreConfig(id),
      getCharacterDefaultLorebookIds(session.characterId),
    ]);
    if (!config) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');

    return res.status(200).json({ ...config, characterDefaultIds });
  },

  PUT: async (req, res, { id }) => {
    const body = validateBody<{ lorebookIds: number[]; globalLoreEnabled?: boolean }>(schemas.updateSessionLorebooks, req, res);
    if (!body) return;

    const config = await setSessionLore(id, body);
    if (!config) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    return res.status(200).json(config);
  },
});
