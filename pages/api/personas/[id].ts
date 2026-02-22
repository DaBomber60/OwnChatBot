import prisma from '../../../lib/prisma';
import { conflict, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';

export default withApiHandler({ parseId: true }, {
  PUT: async (req, res, { id }) => {
    const body = validateBody(schemas.updatePersona, req, res);
    if (!body) return;
    const { name, profile, profileName } = body as any;
    try {
      const updated = await prisma.persona.update({
        where: { id },
        data: {
          name,
          profile,
          ...(profileName !== undefined && { profileName })
        }
      });
      return res.status(200).json(updated);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A persona with this name and profile name combination already exists', 'PERSONA_DUPLICATE');
      }
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Persona not found', 'PERSONA_NOT_FOUND');
      }
      return serverError(res, 'Failed to update persona', 'PERSONA_UPDATE_FAILED');
    }
  },

  DELETE: async (_req, res, { id }) => {
    try {
      await prisma.chatMessage.deleteMany({ where: { session: { personaId: id } } });
      await prisma.chatSession.deleteMany({ where: { personaId: id } });
      await prisma.persona.delete({ where: { id } });
      return res.status(204).end();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Persona not found', 'PERSONA_NOT_FOUND');
      }
      return serverError(res, 'Failed to delete persona', 'PERSONA_DELETE_FAILED');
    }
  },
});
