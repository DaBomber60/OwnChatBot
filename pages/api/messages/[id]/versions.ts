// Placeholder route file to satisfy Next.js type generation referencing this path.
// Actual functionality handled by variants endpoint currently.
import type { NextApiRequest, NextApiResponse } from 'next';
import { notFound } from '../../../../lib/apiErrors';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
	return notFound(res, 'Not implemented', 'NOT_IMPLEMENTED');
}

