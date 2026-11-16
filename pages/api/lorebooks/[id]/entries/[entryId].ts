import prisma from '../../../../../lib/prisma';
import { serverError, notFound } from '../../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../../lib/validate';
import { withApiHandler } from '../../../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (req, res) => {
    const entryId = parseInt(req.query.entryId as string, 10);
    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'Invalid entry ID', code: 'INVALID_ID' });
    }

    const entry = await prisma.loreEntry.findUnique({ where: { id: entryId } });
    if (!entry) {
      return notFound(res, 'Lore entry not found', 'LORE_ENTRY_NOT_FOUND');
    }

    return res.status(200).json(entry);
  },

  PATCH: async (req, res) => {
    const entryId = parseInt(req.query.entryId as string, 10);
    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'Invalid entry ID', code: 'INVALID_ID' });
    }

    const body = validateBody(schemas.updateLoreEntry, req, res);
    if (!body) return;
    const { title, content, keys, constant, enabled, priority } = body as any;

    try {
      const existing = await prisma.loreEntry.findUnique({ where: { id: entryId } });
      if (!existing) {
        return notFound(res, 'Lore entry not found', 'LORE_ENTRY_NOT_FOUND');
      }

      const updated = await prisma.loreEntry.update({
        where: { id: entryId },
        data: {
          ...(title && { title }),
          ...(content && { content }),
          ...(keys && { keys: keys.join(' ') }),
          ...(constant !== undefined && { constant }),
          ...(enabled !== undefined && { enabled }),
          ...(priority !== undefined && { priority }),
        },
      });

      return res.status(200).json(updated);
    } catch (error: unknown) {
      return serverError(res, 'Failed to update lore entry', 'LORE_ENTRY_UPDATE_FAILED');
    }
  },

  DELETE: async (req, res) => {
    const entryId = parseInt(req.query.entryId as string, 10);
    if (isNaN(entryId)) {
      return res.status(400).json({ error: 'Invalid entry ID', code: 'INVALID_ID' });
    }

    try {
      const existing = await prisma.loreEntry.findUnique({ where: { id: entryId } });
      if (!existing) {
        return notFound(res, 'Lore entry not found', 'LORE_ENTRY_NOT_FOUND');
      }

      await prisma.loreEntry.delete({ where: { id: entryId } });
      return res.status(204).send(null);
    } catch (error: unknown) {
      return serverError(res, 'Failed to delete lore entry', 'LORE_ENTRY_DELETE_FAILED');
    }
  },
});
