import prisma from '../../../lib/prisma';
import { conflict, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({}, {
  GET: async (_req, res) => {
    const personas = await prisma.persona.findMany();
    return res.status(200).json(personas);
  },

  POST: async (req, res) => {
    const body = validateBody(schemas.createPersona, req, res);
    if (!body) return;
    const { name, profile, profileName } = body as any;
    try {
      const persona = await prisma.persona.create({
        data: {
          name,
          profile,
          ...(profileName && { profileName })
        }
      });
      return res.status(201).json(persona);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A persona with this name and profile name combination already exists', 'PERSONA_DUPLICATE');
      }
      return serverError(res, 'Failed to create persona', 'PERSONA_CREATE_FAILED');
    }
  },
});
