import prisma from '../../../../../lib/prisma';
import { notFound, serverError } from '../../../../../lib/apiErrors';
import { withApiHandler } from '../../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    try {
      const rows = await prisma.$queryRaw<Array<{ lastApiRequest: string | null }>>`SELECT "lastApiRequest" FROM chat_sessions WHERE id = ${id}`;
      const lastApiRequest = rows[0]?.lastApiRequest;
      if (!lastApiRequest) return notFound(res, 'Request log not found', 'REQUEST_LOG_NOT_FOUND');
      let parsed: any;
      try { parsed = JSON.parse(lastApiRequest); } catch { parsed = {}; }
      const meta = parsed?.__meta || {};
      const sentCount = Number.isFinite(meta?.sentCount) ? meta.sentCount : (Array.isArray(parsed?.messages) ? parsed.messages.length : undefined);
      const baseCount = Number.isFinite(meta?.baseCount) ? meta.baseCount : undefined;
      const wasTruncated = !!meta?.wasTruncated;
      const truncationLimit = Number.isFinite(meta?.truncationLimit) ? meta.truncationLimit : undefined;
      return res.status(200).json({ sentCount, baseCount, wasTruncated, truncationLimit });
    } catch (error) {
      console.error('Error fetching request meta:', error);
      return serverError(res, 'Failed to fetch request meta', 'REQUEST_META_FAILED');
    }
  },
});
