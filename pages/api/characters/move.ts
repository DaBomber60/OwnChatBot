import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { methodNotAllowed, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;

  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return methodNotAllowed(res, req.method);
  }

  try {
    // Batch mode: update multiple characters' group and sort order at once
    if (req.body?.batch) {
      const body = validateBody<{ batch: { id: number; groupId?: number | null; sortOrder?: number }[] }>(schemas.moveCharactersBatch, req, res);
      if (!body) return;

      await prisma.$transaction(
        body.batch.map((entry) =>
          prisma.character.update({
            where: { id: entry.id },
            data: {
              groupId: entry.groupId || null,
              sortOrder: entry.sortOrder ?? 0
            }
          })
        )
      );

      return res.status(200).json({ success: true, updated: body.batch.length });
    }

    // Single character mode (legacy)
    const body = validateBody<{ characterId: number; groupId?: number | null; newSortOrder?: number }>(schemas.moveCharacterSingle, req, res);
    if (!body) return;
    const { characterId, groupId, newSortOrder } = body;

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
    if (newSortOrder !== undefined) {
      updateData.sortOrder = newSortOrder;

      // Bump sort orders of sibling characters at or after the insertion point
      // to make room for the moved character
      await prisma.character.updateMany({
        where: {
          id: { not: characterId },
          groupId: groupId || null,
          sortOrder: { gte: newSortOrder }
        },
        data: { sortOrder: { increment: 1 } }
      });
    }

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
