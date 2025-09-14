import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, methodNotAllowed, conflict, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;

  const { id } = req.query;
  const charId = Number(id);
  if (isNaN(charId)) return badRequest(res, 'Invalid character ID', 'INVALID_CHARACTER_ID');

  if (req.method === 'PUT') {
    const body = validateBody(schemas.updateCharacter, req, res);
    if (!body) return;
    const { name, profileName, bio, scenario, personality, firstMessage, exampleDialogue } = body as any;
    try {
      const updated = await prisma.character.update({
        where: { id: charId },
        data: {
          name,
          scenario: scenario || '',
          personality: personality || '',
          firstMessage: firstMessage || "You didn't enter a first message for this character :(",
          exampleDialogue: exampleDialogue || '',
          ...(profileName !== undefined && { profileName }),
          ...(bio !== undefined && { bio })
        }
      });
      return res.status(200).json(updated);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A character with this name and profile name combination already exists', 'CHARACTER_DUPLICATE');
      }
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
      }
      return serverError(res, 'Failed to update character', 'CHARACTER_UPDATE_FAILED');
    }
  }

  if (req.method === 'DELETE') {
    try {
      await prisma.chatMessage.deleteMany({ where: { session: { characterId: charId } } });
      await prisma.chatSession.deleteMany({ where: { characterId: charId } });
      await prisma.character.delete({ where: { id: charId } });
      return res.status(204).end();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
      }
      return serverError(res, 'Failed to delete character', 'CHARACTER_DELETE_FAILED');
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return methodNotAllowed(res, req.method);
}
