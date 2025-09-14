import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import { badRequest, methodNotAllowed, serverError, tooManyRequests } from '../../../lib/apiErrors';
import { limiters, clientIp } from '../../../lib/rateLimit';
import { schemas, validateBody } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const ip = clientIp(req as any);
  const rl = limiters.passwordChange(ip);
  if (!rl.allowed) {
    return tooManyRequests(res, 'Password change rate limit exceeded', 'RATE_LIMITED', rl.retryAfterSeconds);
  }

  const body = validateBody(schemas.changePassword, req, res);
  if (!body) return;
  const { newPassword } = body as any;

  try {
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await prisma.$transaction(async tx => {
      await tx.setting.upsert({
        where: { key: 'authPassword' },
        update: { value: hashedPassword },
        create: { key: 'authPassword', value: hashedPassword }
      });

      const current = await tx.setting.findUnique({ where: { key: 'authPasswordVersion' } });
      if (!current) {
        await tx.setting.create({ data: { key: 'authPasswordVersion', value: '1' } });
      } else {
        const nextVal = (parseInt(current.value, 10) || 1) + 1;
        await tx.setting.update({ where: { key: 'authPasswordVersion' }, data: { value: String(nextVal) } });
      }
    });

  // Clear auth cookie so user must re-login
  res.setHeader('Set-Cookie', 'hcb_auth=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');

    res.status(200).json({ 
      success: true, 
      message: 'Password updated successfully. Please log in again.' 
    });
  } catch (error) {
    console.error('Password change error:', error);
    serverError(res);
  }
}
