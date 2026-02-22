import prisma from '../../../lib/prisma';
import { badRequest, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  GET: async (_req, res, { id }) => {
    try {
      if (!('userPrompt' in prisma)) {
        return badRequest(res, 'UserPrompt model not available.', 'MODEL_UNAVAILABLE');
      }

      const prompt = await prisma.userPrompt.findUnique({
        where: { id }
      });

      if (!prompt) {
        return notFound(res, 'Prompt not found', 'PROMPT_NOT_FOUND');
      }

      return res.status(200).json(prompt);
    } catch (error: unknown) {
      console.error('User-prompts [id] API error:', error);
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as any).code === 'P2025') {
          return notFound(res, 'Prompt not found', 'PROMPT_NOT_FOUND');
        }
      }
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      return serverError(res, errorMessage, 'USER_PROMPT_ERROR');
    }
  },

  PUT: async (req, res, { id }) => {
    try {
      if (!('userPrompt' in prisma)) {
        return badRequest(res, 'UserPrompt model not available.', 'MODEL_UNAVAILABLE');
      }

      const body = validateBody<{ title: string; body: string }>(schemas.updateUserPrompt, req, res);
      if (!body) return;
      const { title, body: promptBody } = body;

      const updatedPrompt = await prisma.userPrompt.update({
        where: { id },
        data: { title, body: promptBody }
      });

      return res.status(200).json(updatedPrompt);
    } catch (error: unknown) {
      console.error('User-prompts [id] API error:', error);
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as any).code === 'P2025') {
          return notFound(res, 'Prompt not found', 'PROMPT_NOT_FOUND');
        }
      }
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      return serverError(res, errorMessage, 'USER_PROMPT_ERROR');
    }
  },

  DELETE: async (_req, res, { id }) => {
    try {
      if (!('userPrompt' in prisma)) {
        return badRequest(res, 'UserPrompt model not available.', 'MODEL_UNAVAILABLE');
      }

      await prisma.userPrompt.delete({
        where: { id }
      });

      return res.status(204).end();
    } catch (error: unknown) {
      console.error('User-prompts [id] API error:', error);
      if (error && typeof error === 'object' && 'code' in error) {
        if ((error as any).code === 'P2025') {
          return notFound(res, 'Prompt not found', 'PROMPT_NOT_FOUND');
        }
      }
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      return serverError(res, errorMessage, 'USER_PROMPT_ERROR');
    }
  },
});
