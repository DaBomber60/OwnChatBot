// Placeholder route file to satisfy Next.js type generation referencing this path.
// Actual functionality handled by variants endpoint currently.
import { notFound } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ auth: true }, {
  GET: async (_req, res) => {
    return notFound(res, 'Not implemented', 'NOT_IMPLEMENTED');
  },
});

