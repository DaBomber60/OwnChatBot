import prisma from '../../../../lib/prisma';
import { notFound, serverError } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    try {
      const rows = await prisma.$queryRaw<Array<{ lastApiRequest: string | null }>>`SELECT "lastApiRequest" FROM chat_sessions WHERE id = ${id}`;
      const lastApiRequest = rows[0]?.lastApiRequest;
      if (!lastApiRequest) {
        return notFound(res, 'Request log not found', 'REQUEST_LOG_NOT_FOUND');
      }
      const payload = JSON.parse(lastApiRequest);
      res.status(200).json(payload);
    } catch (error) {
      console.error('Error fetching request log:', error);
      return serverError(res, 'Failed to fetch request log', 'REQUEST_LOG_FAILED');
    }
  },
});
