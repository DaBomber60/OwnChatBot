import { withApiHandler } from '../../../../lib/withApiHandler';
import { requireSessionForSummary, runSummary } from '../../../../lib/summaryGeneration';

export default withApiHandler({ parseId: true }, {
  POST: async (_req, res, { id }) => {
    const session = await requireSessionForSummary(res, id);
    if (!session) return;

    const result = await runSummary(res, session, {
      mode: 'generate',
      selectMessages: (s) => s.messages,
    });
    if (!result) return;

    return res.status(200).json({
      summary: result.newSummary,
      generatedSummary: result.generated,
      lastSummary: result.lastSummary,
    });
  },
});
