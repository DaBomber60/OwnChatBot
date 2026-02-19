import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody } from '../../../lib/validate';
import { methodNotAllowed } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method === 'POST') {
    try {
      const body = validateBody(schemas.createMessage, req, res);
      if (!body) return;
      const { sessionId, role, content } = body as any;
      // Dynamic content length enforcement (falls back to schema max if not set)
      try {
        const limitSetting = await prisma.setting.findUnique({ where: { key: 'limit_messageContent' } });
        const dynLimit = limitSetting ? parseInt(limitSetting.value) : undefined;
        if (dynLimit && content.length > dynLimit) {
          return res.status(400).json({ error: `Message content exceeds dynamic limit of ${dynLimit} characters`, code: 'MESSAGE_CONTENT_TOO_LONG' });
        }
      } catch {}
      const message = await prisma.chatMessage.create({
        data: {
          sessionId: sessionId,
          role,
          content: content
        }
      });

      // Update session's updatedAt timestamp
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() }
      });

      return res.status(201).json(message);
    } catch (error) {
      console.error('Error creating message:', error);
      return res.status(500).json({ error: 'Failed to create message' });
    }
  }

  res.setHeader('Allow', ['POST']);
  return methodNotAllowed(res, req.method);
}
