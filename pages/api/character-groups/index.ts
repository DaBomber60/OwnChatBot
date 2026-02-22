import prisma from '../../../lib/prisma';
import { schemas, validateBody } from '../../../lib/validate';
import { conflict, serverError } from '../../../lib/apiErrors';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const groups = await prisma.characterGroup.findMany({
      include: {
        characters: {
          orderBy: { sortOrder: 'asc' }
        }
      },
      orderBy: { sortOrder: 'asc' }
    });
    res.status(200).json(groups);
  },

  POST: async (req, res) => {
    const body = validateBody(schemas.createCharacterGroup, req, res);
    if (!body) return;
    const { name, color } = body as any;
    const finalColor = color || '#6366f1';

    // Get the next sort order
    const lastGroup = await prisma.characterGroup.findFirst({
      orderBy: { sortOrder: 'desc' }
    });
    const sortOrder = (lastGroup?.sortOrder || 0) + 1;

    try {
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
      if (error.code === 'P2002') {
        return conflict(res, 'A group with this name already exists', 'GROUP_NAME_DUPLICATE');
      }
      return serverError(res, 'Failed to create character group', 'GROUP_CREATE_FAILED');
    }
  },
});
