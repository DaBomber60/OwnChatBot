import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ auth: false }, {
  POST: async (_req, res) => {
    // Clear cookie (align SameSite strategy to Strict)
    res.setHeader('Set-Cookie', 'hcb_auth=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    return res.status(200).json({ success: true });
  },
});
