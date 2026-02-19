import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody } from '../../../lib/validate';
import { validationError, methodNotAllowed } from '../../../lib/apiErrors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;

  if (req.method === 'GET') {
    try {
      const groups = await prisma.characterGroup.findMany({
        include: {
          characters: {
            orderBy: { sortOrder: 'asc' }
          }
        },
        orderBy: { sortOrder: 'asc' }
      });
      res.status(200).json(groups);
    } catch (error) {
      console.error('Error fetching character groups:', error);
      res.status(500).json({ error: 'Failed to fetch character groups', code: 'GROUPS_FETCH_FAILED' });
    }
  } else if (req.method === 'POST') {
    try {
      const body = validateBody(schemas.createCharacterGroup, req, res);
      if (!body) return;
      const { name, color } = body as any;
      const finalColor = color || '#6366f1';

      // Get the next sort order
      const lastGroup = await prisma.characterGroup.findFirst({
        orderBy: { sortOrder: 'desc' }
      });
      const sortOrder = (lastGroup?.sortOrder || 0) + 1;

    const group = await prisma.characterGroup.create({
        data: {
      name: name.trim(),
      color: finalColor,
          sortOrder
        },
        include: {
          characters: {
            orderBy: { sortOrder: 'asc' }
          }
        }
      });

      res.status(201).json(group);
    } catch (error: any) {
      console.error('Error creating character group:', error);
      if (error.code === 'P2002') {
        res.status(400).json({ error: 'A group with this name already exists', code: 'GROUP_NAME_DUPLICATE' });
      } else {
        res.status(500).json({ error: 'Failed to create character group', code: 'GROUP_CREATE_FAILED' });
      }
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    return methodNotAllowed(res, req.method);
  }
}
