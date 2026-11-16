import prisma from '../../../lib/prisma';
import { conflict, serverError, badRequest, forbidden } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';
import { GLOBAL_LOREBOOK_ID } from '../../../lib/globalLorebook';

export default withApiHandler({}, {
  GET: async (req, res) => {
    const id = parseInt(req.query.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });
    }

    const lorebook = await prisma.lorebook.findUnique({
      where: { id },
      include: { entries: true, characters: { include: { character: true } } },
    });

    if (!lorebook) {
      return res.status(404).json({ error: 'Lorebook not found', code: 'LOREBOOK_NOT_FOUND' });
    }

    return res.status(200).json(lorebook);
  },

  PATCH: async (req, res) => {
    const id = parseInt(req.query.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });
    }

    // Prevent editing the global lorebook metadata
    if (id === GLOBAL_LOREBOOK_ID) {
      return forbidden(res, 'Cannot edit global lorebook metadata', 'GLOBAL_LOREBOOK_IMMUTABLE');
    }

    const body = validateBody(schemas.updateLorebook, req, res);
    if (!body) return;
    const { name, description } = body as any;

    try {
      const existing = await prisma.lorebook.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Lorebook not found', code: 'LOREBOOK_NOT_FOUND' });
      }

      // Check if new name conflicts with another lorebook
      if (name && name !== existing.name) {
        const conflict_check = await prisma.lorebook.findUnique({ where: { name } });
        if (conflict_check) {
          return res.status(409).json({ error: 'Lorebook name already exists', code: 'LOREBOOK_DUPLICATE' });
        }
      }

      const updated = await prisma.lorebook.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
        },
        include: { entries: true, characters: { include: { character: true } } },
      });

      return res.status(200).json(updated);
    } catch (error: unknown) {
      return serverError(res, 'Failed to update lorebook', 'LOREBOOK_UPDATE_FAILED');
    }
  },

  DELETE: async (req, res) => {
    const id = parseInt(req.query.id as string, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID', code: 'INVALID_ID' });
    }

    // Prevent deleting the global lorebook
    if (id === GLOBAL_LOREBOOK_ID) {
      return forbidden(res, 'Cannot delete global lorebook', 'GLOBAL_LOREBOOK_IMMUTABLE');
    }

    try {
      const existing = await prisma.lorebook.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ error: 'Lorebook not found', code: 'LOREBOOK_NOT_FOUND' });
      }

      await prisma.lorebook.delete({ where: { id } });
      return res.status(204).send(null);
    } catch (error: unknown) {
      return serverError(res, 'Failed to delete lorebook', 'LOREBOOK_DELETE_FAILED');
    }
  },
});
