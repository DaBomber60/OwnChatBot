import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const all = await prisma.setting.findMany();
    const result: Record<string, string> = {};
    all.forEach((s: { key: string; value: string }) => { result[s.key] = s.value; });
    return res.status(200).json(result);
  },

  POST: async (req, res) => {
    const body = validateBody(schemas.upsertSettings, req, res);
    if (!body) return;
    const upserts = Object.entries(body as any).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) }
      })
    );
    await Promise.all(upserts);
    return res.status(200).json({ success: true });
  },
});
