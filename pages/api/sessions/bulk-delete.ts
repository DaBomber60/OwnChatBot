import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  POST: async (req, res) => {
    const body = validateBody<{ ids: number[] }>(schemas.bulkDeleteSessions, req, res);
    if (!body) return;
    const ids = Array.from(new Set(body.ids));

    // Children before parents — the routes here never rely on FK cascade.
    const [, , sessions] = await prisma.$transaction([
      prisma.messageVersion.deleteMany({ where: { message: { sessionId: { in: ids } } } }),
      prisma.chatMessage.deleteMany({ where: { sessionId: { in: ids } } }),
      prisma.chatSession.deleteMany({ where: { id: { in: ids } } })
    ]);

    return res.status(200).json({ deleted: sessions.count });
  },
});
