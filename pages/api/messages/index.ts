import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { badRequest, serverError } from '../../../lib/apiErrors';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  POST: async (req, res) => {
    const body = validateBody(schemas.createMessage, req, res);
    if (!body) return;
    const { sessionId, role, content } = body as any;
    // Dynamic content length enforcement (falls back to schema max if not set)
    try {
      const limitSetting = await prisma.setting.findUnique({ where: { key: 'limit_messageContent' } });
      const dynLimit = limitSetting ? parseInt(limitSetting.value) : undefined;
      if (dynLimit && content.length > dynLimit) {
        return badRequest(res, `Message content exceeds dynamic limit of ${dynLimit} characters`, 'MESSAGE_CONTENT_TOO_LONG');
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
  },
});
