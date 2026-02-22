import prisma from '../../../../lib/prisma';
import { schemas, validateBody } from '../../../../lib/validate';
import { badRequest, notFound, serverError } from '../../../../lib/apiErrors';
import { withApiHandler } from '../../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (req, res, { id }) => {
    // Get notes for the session
    const session = await prisma.chatSession.findUnique({
      where: { id }
    });

    if (!session) {
      return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
    }

    return res.status(200).json({ notes: (session as any).notes || '' });
  },

  POST: async (req, res, { id }) => {
    const body = validateBody(schemas.notesUpdate, req, res);
    if (!body) return;
    const { notes } = body as any;
    // Dynamic notes limit enforcement
    try {
      const limitSetting = await prisma.setting.findUnique({ where: { key: 'limit_notes' } });
      const dynLimit = limitSetting ? parseInt(limitSetting.value) : undefined;
      if (dynLimit && notes.length > dynLimit) {
        return badRequest(res, `Notes exceed dynamic limit of ${dynLimit} characters`, 'NOTES_TOO_LONG');
      }
    } catch {}
    try {
      const session = await prisma.chatSession.findUnique({ where: { id } });
      if (!session) return notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
      await prisma.chatSession.update({ where: { id }, data: { notes } as any });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('Notes update error:', err);
      return serverError(res, 'Failed to update notes', 'NOTES_UPDATE_FAILED');
    }
  },
});
