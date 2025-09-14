import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  try {
    const { id } = req.query;
    const promptId = parseInt(id as string, 10);

    if (isNaN(promptId)) {
      return res.status(400).json({ error: 'Invalid prompt ID' });
    }

    // Check if userPrompt model is available
    if (!('userPrompt' in prisma)) {
      return res.status(400).json({ error: 'UserPrompt model not available.' });
    }

    if (req.method === 'GET') {
      const prompt = await prisma.userPrompt.findUnique({
        where: { id: promptId }
      });

      if (!prompt) {
        return res.status(404).json({ error: 'Prompt not found' });
      }

      return res.status(200).json(prompt);
    }

    if (req.method === 'PUT') {
      const { title, body } = req.body;

      if (!title || !body) {
        return res.status(400).json({ error: 'Missing title or body' });
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

      return res.status(200).json({ message: 'Prompt deleted successfully' });
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);

  } catch (error: unknown) {
    console.error('User-prompts [id] API error:', error);
    
    // Handle Prisma errors
    if (error && typeof error === 'object' && 'code' in error) {
      if ((error as any).code === 'P2025') {
        return res.status(404).json({ error: 'Prompt not found' });
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return res.status(500).json({ error: errorMessage });
  }
}
