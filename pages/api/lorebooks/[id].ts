import prisma from '../../../lib/prisma';
import { badRequest, conflict, forbidden, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';
import { GLOBAL_LOREBOOK_ID } from '../../../lib/globalLorebook';
import { getLorebookDetail, parseLorebookId } from '../../../lib/lorebook/lorebookData';

export default withApiHandler({}, {
  GET: async (req, res) => {
    const id = parseLorebookId(req.query.id);
    if (id === null) return badRequest(res, 'Invalid ID', 'INVALID_ID');

    const lorebook = await getLorebookDetail(id);
    if (!lorebook) return notFound(res, 'Lorebook not found', 'LOREBOOK_NOT_FOUND');
    return res.status(200).json(lorebook);
  },

  PATCH: async (req, res) => {
    const id = parseLorebookId(req.query.id);
    if (id === null) return badRequest(res, 'Invalid ID', 'INVALID_ID');

    // The global lorebook's name and description are fixed.
    if (id === GLOBAL_LOREBOOK_ID) {
      return forbidden(res, 'Cannot edit global lorebook metadata', 'GLOBAL_LOREBOOK_IMMUTABLE');
    }

    const body = validateBody<{ name?: string; description?: string | null }>(schemas.updateLorebook, req, res);
    if (!body) return;
    const { name, description } = body;

    try {
      const existing = await prisma.lorebook.findUnique({ where: { id } });
      if (!existing) return notFound(res, 'Lorebook not found', 'LOREBOOK_NOT_FOUND');

      if (name && name !== existing.name) {
        const clash = await prisma.lorebook.findUnique({ where: { name } });
        if (clash) return conflict(res, 'A lorebook with this name already exists', 'LOREBOOK_DUPLICATE');
      }

      await prisma.lorebook.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(description !== undefined ? { description: description || null } : {}),
        },
      });
      return res.status(200).json(await getLorebookDetail(id));
    } catch (error: unknown) {
      return serverError(res, 'Failed to update lorebook', 'LOREBOOK_UPDATE_FAILED');
    }
  },

  DELETE: async (req, res) => {
    const id = parseLorebookId(req.query.id);
    if (id === null) return badRequest(res, 'Invalid ID', 'INVALID_ID');

    if (id === GLOBAL_LOREBOOK_ID) {
      return forbidden(res, 'Cannot delete global lorebook', 'GLOBAL_LOREBOOK_IMMUTABLE');
    }

    try {
      // Entries, character defaults and chat links cascade.
      const deleted = await prisma.lorebook.deleteMany({ where: { id } });
      if (deleted.count === 0) return notFound(res, 'Lorebook not found', 'LOREBOOK_NOT_FOUND');
      return res.status(204).end();
    } catch (error: unknown) {
      return serverError(res, 'Failed to delete lorebook', 'LOREBOOK_DELETE_FAILED');
    }
  },
});
