import type { NextApiRequest, NextApiResponse } from 'next';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../../lib/jwtSecret';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end('Method Not Allowed');
  }

  const cookieHeader = req.headers.cookie || '';
  const rawToken = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('hcb_auth='))?.split('=')[1];
  const secret = await getJwtSecret();
  let decoded: any = null;
  let error: string | null = null;
  if (rawToken) {
    try {
      decoded = jwt.verify(rawToken, secret);
    } catch (e: any) {
      error = e.message;
    }
  }
  res.status(200).json({ hasCookie: !!rawToken, decoded, error });
}
