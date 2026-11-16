import prisma from '../../../lib/prisma';
import { conflict, serverError, badRequest } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const lorebooks = await prisma.lorebook.findMany({
      include: { entries: true, characters: { include: { character: true } } }
    });
    return res.status(200).json(lorebooks);
  },

  POST: async (req, res) => {
    console.log('[/api/lorebooks] Incoming body:', req.body);
    const body = validateBody(schemas.createLorebook, req, res);
    if (!body) return;
    const { name, description } = body as any;

    try {
      const existing = await prisma.lorebook.findUnique({ where: { name } });
      if (existing) {
        return conflict(res, 'A lorebook with this name already exists', 'LOREBOOK_DUPLICATE');
      }

      const lorebook = await prisma.lorebook.create({
        data: {
          name,
          description: description || null,
        },
        include: { entries: true, characters: { include: { character: true } } },
      });
      return res.status(201).json(lorebook);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A lorebook with this name already exists', 'LOREBOOK_DUPLICATE');
      }
      return serverError(res, 'Failed to create lorebook', 'LOREBOOK_CREATE_FAILED');
    }
  },
});
