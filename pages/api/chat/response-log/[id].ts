import prisma from '../../../../lib/prisma';
import { notFound, serverError } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    try {
      const rows = await prisma.$queryRaw<Array<{ lastApiResponse: string | null }>>`SELECT "lastApiResponse" FROM chat_sessions WHERE id = ${id}`;
      const lastApiResponse = rows[0]?.lastApiResponse;
      if (!lastApiResponse) {
        return notFound(res, 'Response log not found', 'RESPONSE_LOG_NOT_FOUND');
      }
      const payload = JSON.parse(lastApiResponse);
      res.status(200).json(payload);
    } catch (error) {
      console.error('Error fetching response log:', error);
      return serverError(res, 'Failed to fetch response log', 'RESPONSE_LOG_FAILED');
    }
  },
});
