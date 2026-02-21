import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, notFound, serverError, methodNotAllowed } from '../../../lib/apiErrors';
import { parseId } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  try {
    const promptId = parseId(req.query.id);

    if (promptId === null) {
      return badRequest(res, 'Invalid prompt ID', 'INVALID_PROMPT_ID');
    }

    // Check if userPrompt model is available
    if (!('userPrompt' in prisma)) {
      return badRequest(res, 'UserPrompt model not available.', 'MODEL_UNAVAILABLE');
    }

    if (req.method === 'GET') {
      const prompt = await prisma.userPrompt.findUnique({
        where: { id: promptId }
      });

      if (!prompt) {
        return notFound(res, 'Prompt not found', 'PROMPT_NOT_FOUND');
      }

      return res.status(200).json(prompt);
    }

    if (req.method === 'PUT') {
      const { title, body } = req.body;

      if (!title || !body) {
        return badRequest(res, 'Missing title or body', 'MISSING_FIELDS');
      }

      const updatedPrompt = await prisma.userPrompt.update({
        where: { id: promptId },
        data: { title, body }
      });

      return res.status(200).json(updatedPrompt);
    }

    if (req.method === 'DELETE') {
      await prisma.userPrompt.delete({
        where: { id: promptId }
      });

      return res.status(204).end();
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return methodNotAllowed(res, req.method);

  } catch (error: unknown) {
    console.error('User-prompts [id] API error:', error);
    
    // Handle Prisma errors
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as any).code === 'P2025') {
        return notFound(res, 'Prompt not found', 'PROMPT_NOT_FOUND');
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return serverError(res, errorMessage, 'USER_PROMPT_ERROR');
  }
}
