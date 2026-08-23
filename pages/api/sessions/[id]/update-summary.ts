import { badRequest } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';
import { requireSessionForSummary, runSummary } from '../../../../lib/summaryGeneration';

export default withApiHandler({ parseId: true }, {
  POST: async (_req, res, { id }) => {
    const session = await requireSessionForSummary(res, id);
    if (!session) return;

    const result = await runSummary(res, session, {
      mode: 'update',
      selectMessages: (s) => {
        if (!s.lastSummary) {
          badRequest(res, 'No previous summary found. Use generate summary instead.', 'NO_PREVIOUS_SUMMARY');
          return null;
        }
        const newMessages = s.messages.filter(m => m.id > s.lastSummary!);
        if (newMessages.length === 0) {
          badRequest(res, 'No new messages to summarize since last summary.', 'NO_NEW_MESSAGES');
          return null;
        }
        return newMessages;
      },
    });
    if (!result) return;

    return res.status(200).json({
      summary: result.newSummary,
      generatedUpdate: result.generated,
      lastSummary: result.lastSummary,
      newMessagesCount: result.summarizedCount,
    });
  },
});
