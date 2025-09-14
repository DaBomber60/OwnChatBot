import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody } from '../../../lib/validate';
import { badRequest } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  try {
    if (req.method === 'GET') {
      // If the Prisma client does not know about userPrompt, return empty list
      if (!('userPrompt' in prisma)) {
        return res.status(200).json([]);
      }
      const prompts = await prisma.userPrompt.findMany({ orderBy: { createdAt: 'desc' } });
      return res.status(200).json(prompts);
    }
    if (req.method === 'POST') {
      if (!('userPrompt' in prisma)) {
        return badRequest(res, 'UserPrompt model not available', 'USER_PROMPT_MODEL_MISSING');
      }
      const body = validateBody(schemas.createUserPrompt, req, res);
      if (!body) return;
      const { title, body: promptBody } = body as any;
      const prompt = await prisma.userPrompt.create({ data: { title, body: promptBody } });
      return res.status(201).json(prompt);
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: unknown) {
    console.error('User-prompts API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return res.status(500).json({ error: errorMessage });
  }
}
