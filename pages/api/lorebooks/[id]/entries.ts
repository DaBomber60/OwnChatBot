import prisma from '../../../../lib/prisma';
import { serverError, notFound, badRequest, forbidden } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { GLOBAL_LOREBOOK_ID } from '../../../../lib/globalLorebook';

export default withApiHandler({}, {
  POST: async (req, res) => {
    const lorebookId = parseInt(req.query.id as string, 10);
    if (isNaN(lorebookId)) {
      return res.status(400).json({ error: 'Invalid lorebook ID', code: 'INVALID_ID' });
    }

    const body = validateBody(schemas.createLoreEntry, req, res);
    if (!body) return;
    let { title, content, keys, constant, enabled, priority } = body as any;

    try {
      // Verify lorebook exists
      const lorebook = await prisma.lorebook.findUnique({ where: { id: lorebookId } });
      if (!lorebook) {
        return notFound(res, 'Lorebook not found', 'LOREBOOK_NOT_FOUND');
      }

      // Global lorebook entries must be trigger-based only (no permanent entries)
      if (lorebookId === GLOBAL_LOREBOOK_ID && constant === true) {
        return badRequest(
          res,
          'Global lorebook entries cannot be permanent (constant). They must be trigger-based only.',
          'GLOBAL_LOREBOOK_TRIGGER_ONLY'
        );
      }

      // Force constant to false for global lorebook
      if (lorebookId === GLOBAL_LOREBOOK_ID) {
        constant = false;
      }

      const entry = await prisma.loreEntry.create({
        data: {
          lorebookId,
          title,
          content,
          keys: (keys || []).join(' '),
          constant: constant ?? false,
          enabled: enabled ?? true,
          priority: priority ?? 100,
        },
      });

      return res.status(201).json(entry);
    } catch (error: unknown) {
      return serverError(res, 'Failed to create lore entry', 'LORE_ENTRY_CREATE_FAILED');
    }
  },
});
