import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody, parseId } from '../../../lib/validate';
import { badRequest, notFound, conflict, serverError, methodNotAllowed } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;

  const groupId = parseId(req.query.id);

  if (groupId === null) {
    return badRequest(res, 'Invalid group ID', 'INVALID_GROUP_ID');
  }

  if (req.method === 'GET') {
    try {
      const group = await prisma.characterGroup.findUnique({
        where: { id: groupId },
        include: {
          characters: {
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      if (!group) {
        return notFound(res, 'Group not found', 'GROUP_NOT_FOUND');
      }

      res.status(200).json(group);
    } catch (error) {
      console.error('Error fetching character group:', error);
      return serverError(res, 'Failed to fetch character group', 'GROUP_FETCH_FAILED');
    }
  } else if (req.method === 'PUT') {
    try {
      const body = validateBody(schemas.updateCharacterGroup, req, res);
      if (!body) return;
      const { name, color, isCollapsed } = body as any;
      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (color !== undefined) updateData.color = color;
      if (isCollapsed !== undefined) updateData.isCollapsed = isCollapsed;

      const group = await prisma.characterGroup.update({
        where: { id: groupId },
        data: updateData,
        include: {
          characters: {
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      res.status(200).json(group);
    } catch (error: any) {
      console.error('Error updating character group:', error);
      if (error.code === 'P2002') {
        return conflict(res, 'A group with this name already exists', 'GROUP_NAME_DUPLICATE');
      } else if (error.code === 'P2025') {
        return notFound(res, 'Group not found', 'GROUP_NOT_FOUND');
      } else {
        return serverError(res, 'Failed to update character group', 'GROUP_UPDATE_FAILED');
      }
    }
  } else if (req.method === 'DELETE') {
    try {
      // First, move all characters in this group back to ungrouped
      await prisma.character.updateMany({
        where: { groupId },
        data: { groupId: null }
      });

      // Then delete the group
      await prisma.characterGroup.delete({
        where: { id: groupId }
      });

      res.status(204).end();
    } catch (error: any) {
      console.error('Error deleting character group:', error);
      if (error.code === 'P2025') {
        return notFound(res, 'Group not found', 'GROUP_NOT_FOUND');
      } else {
        return serverError(res, 'Failed to delete character group', 'GROUP_DELETE_FAILED');
      }
    }
  } else {
    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return methodNotAllowed(res, req.method);
  }
}
