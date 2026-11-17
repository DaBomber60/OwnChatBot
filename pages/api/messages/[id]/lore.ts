import { notFound } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { getMessageLore } from '../../../../lib/lorebook/lorebookData';
import { getLoreKeepActiveTurns } from '../../../../lib/aiProvider';
import type { MessageLoreResponse } from '../../../../types/models';

/**
 * GET /api/messages/:id/lore
 *   → MessageLoreResponse: the keyword-triggered lore entries added to the prompt for this reply.
 */
export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    const [lore, keepActiveTurns] = await Promise.all([getMessageLore(id), getLoreKeepActiveTurns()]);
    if (!lore) return notFound(res, 'Message not found', 'MESSAGE_NOT_FOUND');
    const body: MessageLoreResponse = { ...lore, keepActiveTurns };
    return res.status(200).json(body);
  },
});
