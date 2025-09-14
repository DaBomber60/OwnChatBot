// Placeholder route file to satisfy Next.js type generation referencing this path.
// Actual functionality handled by variants endpoint currently.
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
	return res.status(404).json({ error: 'Not implemented' });
}

