import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, methodNotAllowed, notFound, serverError } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;

  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return methodNotAllowed(res, req.method);
  }

  try {
    const { characterId, groupId, newSortOrder } = req.body;

    if (!characterId || typeof characterId !== 'number') {
      return badRequest(res, 'Valid character ID is required', 'CHARACTER_ID_REQUIRED');
    }

    const character = await prisma.character.findUnique({ where: { id: characterId } });

    if (!character) {
      return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
    }

    if (groupId !== null && groupId !== undefined) {
      const group = await prisma.characterGroup.findUnique({ where: { id: groupId } });
      if (!group) {
        return notFound(res, 'Group not found', 'GROUP_NOT_FOUND');
      }
    }

    const updateData: any = { groupId: groupId || null };
    if (newSortOrder !== undefined) updateData.sortOrder = newSortOrder;

    const updatedCharacter = await prisma.character.update({
      where: { id: characterId },
      data: updateData,
      include: { group: true }
    });

    return res.status(200).json(updatedCharacter);
  } catch (error: any) {
    console.error('Error moving character:', error);
    if (error.code === 'P2025') {
      return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
    }
    return serverError(res, 'Failed to move character', 'CHARACTER_MOVE_FAILED');
  }
}
