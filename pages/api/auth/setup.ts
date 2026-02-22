import prisma from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { badRequest, serverError, tooManyRequests } from '../../../lib/apiErrors';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler(
  { auth: false },
  {
    GET: async (_req, res) => {
      const authSetting = await prisma.setting.findUnique({
        where: { key: 'authPassword' }
      });

      return res.status(200).json({ 
        isSetup: !!authSetting?.value 
      });
    },

    POST: async (req, res) => {
      const ip = clientIp(req as any);
      const rl = limiters.passwordSetup(ip);
      if (!rl.allowed) {
        return tooManyRequests(res, 'Password setup rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
      }
      const body = validateBody(schemas.authSetup, req, res);
      if (!body) return;
      const { password } = body as any;

      try {
        const existingAuth = await prisma.setting.findUnique({
          where: { key: 'authPassword' }
        });

        if (existingAuth?.value) {
          return badRequest(res, 'Authentication is already configured', 'ALREADY_CONFIGURED');
        }

        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Store both the password hash AND initialize password version at 1 (implements roadmap Section 3 item 1)
        await prisma.$transaction([
          prisma.setting.create({
            data: { key: 'authPassword', value: hashedPassword }
          }),
          prisma.setting.create({
            data: { key: 'authPasswordVersion', value: '1' }
          })
        ]);

        res.status(200).json({ 
          success: true, 
          message: 'Initial password set successfully'
        });
      } catch (error) {
        console.error('Setup error:', error);
        serverError(res);
      }
    },
  }
);
