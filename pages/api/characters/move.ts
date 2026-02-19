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
    // Batch mode: update multiple characters' group and sort order at once
    const { batch } = req.body;
    if (Array.isArray(batch)) {
      // Validate batch entries
      for (const entry of batch) {
        if (!entry.id || typeof entry.id !== 'number') {
          return badRequest(res, 'Each batch entry must have a valid numeric id', 'INVALID_BATCH_ENTRY');
        }
      }

      // Run all updates in a transaction for atomicity
      await prisma.$transaction(
        batch.map((entry: { id: number; groupId: number | null; sortOrder: number }) =>
          prisma.character.update({
            where: { id: entry.id },
            data: {
              groupId: entry.groupId || null,
              sortOrder: entry.sortOrder ?? 0
            }
          })
        )
      );

      return res.status(200).json({ success: true, updated: batch.length });
    }

    // Single character mode (legacy)
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
