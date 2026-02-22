import prisma from '../../../lib/prisma';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ auth: false }, {
  GET: async (_req, res) => {
    try {
      const versionSetting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
      const version = versionSetting ? parseInt(versionSetting.value, 10) || 1 : 1;
      res.status(200).json({ version });
    } catch (e) {
      res.status(200).json({ version: 1 });
    }
  },
});
