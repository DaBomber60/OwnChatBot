import prisma from '../../../../../lib/prisma';
import { serverError, notFound, badRequest } from '../../../../../lib/apiErrors';
import { schemas, validateBody, parseId } from '../../../../../lib/validate';
import { withApiHandler } from '../../../../../lib/withApiHandler';
import { GLOBAL_LOREBOOK_ID } from '../../../../../lib/globalLorebook';
import { storedPriority, type LorePriority } from '../../../../../lib/lorebook/constants';
import { serializeKeywords, type LoreKeyword } from '../../../../../lib/lorebook/keywords';
import { parseLorebookId, toLoreEntry } from '../../../../../lib/lorebook/lorebookData';
import type { NextApiRequest, NextApiResponse } from 'next';

interface UpdateLoreEntryBody {
  title?: string;
  content?: string;
  keys?: Array<string | LoreKeyword>;
  constant?: boolean;
  enabled?: boolean;
  priority?: LorePriority | number;
}

/** The entry, but only when it belongs to the lorebook in the URL. Writes the error response otherwise. */
async function findEntryInLorebook(req: NextApiRequest, res: NextApiResponse) {
  const lorebookId = parseLorebookId(req.query.id);
  const entryId = parseId(req.query.entryId);
  if (lorebookId === null || entryId === null) {
    badRequest(res, 'Invalid lorebook or entry ID', 'INVALID_ID');
    return null;
  }
  const entry = await prisma.loreEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.lorebookId !== lorebookId) {
    notFound(res, 'Lore entry not found', 'LORE_ENTRY_NOT_FOUND');
    return null;
  }
  return entry;
}

/**
 * GET    /api/lorebooks/:id/entries/:entryId
 * PATCH  /api/lorebooks/:id/entries/:entryId  Body: any of { title, content, keys, constant, enabled, priority }
 * DELETE /api/lorebooks/:id/entries/:entryId
 */
export default withApiHandler({}, {
  GET: async (req, res) => {
    const entry = await findEntryInLorebook(req, res);
    if (!entry) return;
    return res.status(200).json(toLoreEntry(entry));
  },

  PATCH: async (req, res) => {
    const body = validateBody<UpdateLoreEntryBody>(schemas.updateLoreEntry, req, res);
    if (!body) return;

    try {
      const existing = await findEntryInLorebook(req, res);
      if (!existing) return;

      if (existing.lorebookId === GLOBAL_LOREBOOK_ID && body.constant === true) {
        return badRequest(
          res,
          'Global lorebook entries cannot be permanent (constant). They must be trigger-based only.',
          'GLOBAL_LOREBOOK_TRIGGER_ONLY'
        );
      }

      const { title, content, keys, constant, enabled, priority } = body;
      const updated = await prisma.loreEntry.update({
        where: { id: existing.id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content } : {}),
          ...(keys !== undefined ? { keys: serializeKeywords(keys) } : {}),
          ...(constant !== undefined ? { constant } : {}),
          ...(enabled !== undefined ? { enabled } : {}),
          ...(priority !== undefined ? { priority: storedPriority(priority) } : {}),
        },
      });

      return res.status(200).json(toLoreEntry(updated));
    } catch (error: unknown) {
      return serverError(res, 'Failed to update lore entry', 'LORE_ENTRY_UPDATE_FAILED');
    }
  },

  DELETE: async (req, res) => {
    try {
      const existing = await findEntryInLorebook(req, res);
      if (!existing) return;

      await prisma.loreEntry.delete({ where: { id: existing.id } });
      return res.status(204).end();
    } catch (error: unknown) {
      return serverError(res, 'Failed to delete lore entry', 'LORE_ENTRY_DELETE_FAILED');
    }
  },
});
