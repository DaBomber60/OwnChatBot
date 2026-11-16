import prisma from '../../../../lib/prisma';
import { serverError, notFound, badRequest } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { GLOBAL_LOREBOOK_ID } from '../../../../lib/globalLorebook';
import { DEFAULT_LORE_PRIORITY, storedPriority, type LorePriority } from '../../../../lib/lorebook/constants';
import { serializeKeywords, type LoreKeyword } from '../../../../lib/lorebook/keywords';
import { parseLorebookId, toLoreEntry } from '../../../../lib/lorebook/lorebookData';

interface CreateLoreEntryBody {
  title: string;
  content: string;
  keys?: Array<string | LoreKeyword>;
  constant?: boolean;
  enabled?: boolean;
  priority?: LorePriority | number;
}

/**
 * POST /api/lorebooks/:id/entries
 * Body: { title, content, keys?, constant?, enabled?, priority? }
 * keys: [{ text, wholeWord }] (plain strings are accepted as part-word matches)
 * priority: 'critical' | 'important' | 'helpful' | 'information' | 'minor' (default 'information')
 */
export default withApiHandler({}, {
  POST: async (req, res) => {
    const lorebookId = parseLorebookId(req.query.id);
    if (lorebookId === null) return badRequest(res, 'Invalid lorebook ID', 'INVALID_ID');

    const body = validateBody<CreateLoreEntryBody>(schemas.createLoreEntry, req, res);
    if (!body) return;
    const { title, content, keys, constant, enabled, priority } = body;

    // Global lorebook entries must be trigger-based only (no permanent entries)
    if (lorebookId === GLOBAL_LOREBOOK_ID && constant === true) {
      return badRequest(
        res,
        'Global lorebook entries cannot be permanent (constant). They must be trigger-based only.',
        'GLOBAL_LOREBOOK_TRIGGER_ONLY'
      );
    }

    try {
      const lorebook = await prisma.lorebook.findUnique({ where: { id: lorebookId }, select: { id: true } });
      if (!lorebook) return notFound(res, 'Lorebook not found', 'LOREBOOK_NOT_FOUND');

      const entry = await prisma.loreEntry.create({
        data: {
          lorebookId,
          title,
          content,
          keys: serializeKeywords(keys ?? []),
          constant: constant ?? false,
          enabled: enabled ?? true,
          priority: storedPriority(priority ?? DEFAULT_LORE_PRIORITY),
        },
      });

      return res.status(201).json(toLoreEntry(entry));
    } catch (error: unknown) {
      return serverError(res, 'Failed to create lore entry', 'LORE_ENTRY_CREATE_FAILED');
    }
  },
});
