import prisma from '../../../lib/prisma';
import { conflict, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';
import { getLorebookDetail, listLorebookSummaries } from '../../../lib/lorebook/lorebookData';

const isUniqueViolation = (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002';

export default withApiHandler({}, {
  // Lorebooks with entry/usage counts (global first). `?view=summary` is accepted for older callers.
  GET: async (_req, res) => {
    return res.status(200).json(await listLorebookSummaries());
  },

  POST: async (req, res) => {
    const body = validateBody<{ name: string; description?: string }>(schemas.createLorebook, req, res);
    if (!body) return;
    const { name, description } = body;

    try {
      const existing = await prisma.lorebook.findUnique({ where: { name } });
      if (existing) {
        return conflict(res, 'A lorebook with this name already exists', 'LOREBOOK_DUPLICATE');
      }

      const lorebook = await prisma.lorebook.create({
        data: { name, description: description || null },
      });
      return res.status(201).json(await getLorebookDetail(lorebook.id));
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        return conflict(res, 'A lorebook with this name already exists', 'LOREBOOK_DUPLICATE');
      }
      return serverError(res, 'Failed to create lorebook', 'LOREBOOK_CREATE_FAILED');
    }
  },
});
