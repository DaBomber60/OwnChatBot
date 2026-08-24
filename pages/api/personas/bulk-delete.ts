import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  POST: async (req, res) => {
    const body = validateBody<{ ids: number[] }>(schemas.bulkDeletePersonas, req, res);
    if (!body) return;
    const ids = Array.from(new Set(body.ids));

    // Children before parents — the routes here never rely on FK cascade.
    const [, , , personas] = await prisma.$transaction([
      prisma.messageVersion.deleteMany({ where: { message: { session: { personaId: { in: ids } } } } }),
      prisma.chatMessage.deleteMany({ where: { session: { personaId: { in: ids } } } }),
      prisma.chatSession.deleteMany({ where: { personaId: { in: ids } } }),
      prisma.persona.deleteMany({ where: { id: { in: ids } } })
    ]);

    return res.status(200).json({ deleted: personas.count });
  },
});
