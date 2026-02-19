import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }
  // Clear cookie (align SameSite strategy to Strict)
  res.setHeader('Set-Cookie', 'hcb_auth=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
  return res.status(200).json({ success: true });
}
