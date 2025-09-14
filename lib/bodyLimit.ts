import type { NextApiRequest, NextApiResponse } from 'next';
import { payloadTooLarge, badRequest } from './apiErrors';

// Enforce a maximum JSON body size by reading raw data manually when needed.
// For routes using Next's default bodyParser (JSON), we can approximate via content-length header.
// This is a lightweight guard; for absolute enforcement switch to custom parser if necessary.
export function enforceBodySize(req: NextApiRequest, res: NextApiResponse, maxBytes: number): boolean {
  const lenHeader = req.headers['content-length'];
  if (lenHeader) {
    const size = parseInt(lenHeader, 10);
    if (!isNaN(size) && size > maxBytes) {
      payloadTooLarge(res, `Request body too large. Limit is ${Math.round(maxBytes/1024/1024)}MB`);
      return false;
    }
  }
  return true;
}

export function requireJson(req: NextApiRequest, res: NextApiResponse): boolean {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) {
    badRequest(res, 'Content-Type must be application/json', 'INVALID_CONTENT_TYPE');
    return false;
  }
  return true;
}
