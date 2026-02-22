import { getJwtSecret } from '../../../lib/jwtSecret';
import { withApiHandler } from '../../../lib/withApiHandler';
import { verifyJwtHs256 } from '../../../lib/jwtCrypto';

export default withApiHandler({ auth: false }, {
  GET: async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const rawToken = cookieHeader.split(';').map(c => c.trim()).find(c => c.startsWith('hcb_auth='))?.split('=')[1];
    const secret = await getJwtSecret();
    let decoded: any = null;
    let error: string | null = null;
    if (rawToken) {
      const result = await verifyJwtHs256(rawToken, secret);
      if (result.valid) {
        decoded = result.payload;
      } else {
        error = 'Invalid or expired token';
      }
    }
    res.status(200).json({ hasCookie: !!rawToken, decoded, error });
  },
});
