import prisma from '../../../../lib/prisma';
import { serverError, notFound } from '../../../../lib/apiErrors';
import { schemas, validateBody } from '../../../../lib/validate';
import { withApiHandler } from '../../../../lib/withApiHandler';

/**
 * DELETE /api/lorebooks/:id/unlink
 * Unlink a lorebook from a character
 *
 * Body: { characterId: number }
 */
export default withApiHandler({}, {
  DELETE: async (req, res) => {
    const lorebookId = parseInt(req.query.id as string, 10);
    if (isNaN(lorebookId)) {
      return res.status(400).json({ error: 'Invalid lorebook ID', code: 'INVALID_ID' });
    }

    const body = validateBody(schemas.unlinkLorebook, req, res);
    if (!body) return;
    const { characterId } = body as any;

    try {
      const link = await prisma.characterLorebook.findUnique({
        where: { characterId_lorebookId: { characterId, lorebookId } },
      });
      if (!link) {
        return notFound(res, 'Link not found', 'LINK_NOT_FOUND');
      }

      await prisma.characterLorebook.delete({
        where: { characterId_lorebookId: { characterId, lorebookId } },
      });

      return res.status(204).send(null);
    } catch {
      return serverError(res, 'Failed to unlink lorebook from character', 'LINK_DELETE_FAILED');
    }
  },
});
