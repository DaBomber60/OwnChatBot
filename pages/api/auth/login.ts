import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../../../lib/jwtSecret';
import { badRequest, serverError, unauthorized, methodNotAllowed, tooManyRequests } from '../../../lib/apiErrors';
import { limiters, clientIp } from '../../../lib/rateLimit';


// We now lazily obtain JWT secret (auto-generated & stored if absent)

// Helper to get current password version (defaults to 1 if not set yet)
async function getPasswordVersion(): Promise<number> {
  const versionSetting = await prisma.setting.findUnique({ where: { key: 'authPasswordVersion' } });
  if (!versionSetting) return 1;
  const parsed = parseInt(versionSetting.value, 10);
  return isNaN(parsed) ? 1 : parsed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return methodNotAllowed(res, req.method);
  }

  const JWT_SECRET = await getJwtSecret();

  const { password } = req.body;
  const ip = clientIp(req);
  const rl = limiters.authLogin(ip);
  if (!rl.allowed) {
    return tooManyRequests(res, 'Too many login attempts. Try later.', 'RATE_LIMITED', rl.retryAfterSeconds);
  }
  if (!password) {
    return badRequest(res, 'Password is required', 'PASSWORD_REQUIRED');
  }

  try {
    const authSetting = await prisma.setting.findUnique({ where: { key: 'authPassword' } });
    if (!authSetting?.value) {
      return unauthorized(res, 'Authentication not configured. Please contact your administrator.', 'AUTH_NOT_CONFIGURED');
    }

    const isValid = await bcrypt.compare(password, authSetting.value);
    if (!isValid) {
      return unauthorized(res, 'Invalid password', 'INVALID_PASSWORD');
    }

    const pwdVersion = await getPasswordVersion();

    const token = jwt.sign(
      { authenticated: true, v: pwdVersion },
      JWT_SECRET,
      { expiresIn: '14d' }
    );

    // CSRF Mitigation Strategy (Section 4):
    // Application is strictly first-party; adopt SameSite=Strict on session cookie to block CSRF.
    // If future third-party POST needs arise, introduce a per-request CSRF token.
    const cookieParts = [
      `hcb_auth=${token}`,
      'Path=/',
      'HttpOnly',
      // Use Lax to allow same-site navigations while still mitigating CSRF for cross-site POSTs
      'SameSite=Lax',
  // 14 days in seconds
  'Max-Age=1209600'
    ];
    // Secure only in production to allow local dev over http
    if (process.env.NODE_ENV === 'production') cookieParts.push('Secure');
    res.setHeader('Set-Cookie', cookieParts.join('; '));

    return res.status(200).json({ success: true, message: 'Authentication successful' });
  } catch (error) {
    console.error('Login error:', error);
    return serverError(res);
  }
}
