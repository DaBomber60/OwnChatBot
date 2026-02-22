import prisma from '../../../../lib/prisma';
import { schemas, validateBody } from '../../../../lib/validate';
import { badRequest, serverError } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  POST: async (req, res, { id }) => {
    const body = validateBody(schemas.summaryUpdate, req, res);
    if (!body) return;
    const { summary } = body as any;
    // Dynamic summary limit enforcement
    try {
      const limitSetting = await prisma.setting.findUnique({ where: { key: 'limit_summary' } });
      const dynLimit = limitSetting ? parseInt(limitSetting.value) : undefined;
      if (dynLimit && summary.length > dynLimit) {
        return badRequest(res, `Summary exceeds dynamic limit of ${dynLimit} characters`, 'SUMMARY_TOO_LONG');
      }
    } catch {}
    try {
      const updatedSession = await prisma.chatSession.update({
        where: { id },
        data: { summary, updatedAt: new Date() }
      });
      return res.status(200).json(updatedSession);
    } catch (error) {
      console.error('Failed to update session summary:', error);
      return serverError(res, 'Failed to save summary', 'SUMMARY_UPDATE_FAILED');
    }
  },
});
