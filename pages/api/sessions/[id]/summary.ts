import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../../lib/prisma';
import { requireAuth } from '../../../../lib/apiAuth';
import { schemas, validateBody } from '../../../../lib/validate';
import { badRequest, serverError, notFound } from '../../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const { id } = req.query;
  const sessionId = parseInt(id as string);

  if (isNaN(sessionId)) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  if (req.method === 'POST') {
    const body = validateBody(schemas.summaryUpdate, req, res);
    if (!body) return;
    const { summary } = body as any;
    // Dynamic summary limit enforcement
    try {
      const limitSetting = await prisma.setting.findUnique({ where: { key: 'limit_summary' } });
      const dynLimit = limitSetting ? parseInt(limitSetting.value) : undefined;
      if (dynLimit && summary.length > dynLimit) {
        return badRequest(res, `Summary exceeds dynamic limit of ${dynLimit} characters`, 'SUMMARY_TOO_LONG');
      }
    } catch {}
    try {
      const updatedSession = await prisma.chatSession.update({
        where: { id: sessionId },
        data: { summary, updatedAt: new Date() }
      });
      return res.status(200).json(updatedSession);
    } catch (error) {
      console.error('Failed to update session summary:', error);
      return serverError(res, 'Failed to save summary', 'SUMMARY_UPDATE_FAILED');
    }
  }

  res.setHeader('Allow', ['POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
