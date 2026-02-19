import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, methodNotAllowed, conflict, notFound, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody, parseId } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  const personaId = parseId(req.query.id);
  if (personaId === null) return badRequest(res, 'Invalid persona ID', 'INVALID_PERSONA_ID');

  if (req.method === 'PUT') {
    const body = validateBody(schemas.updatePersona, req, res);
    if (!body) return;
    const { name, profile, profileName } = body as any;
    try {
      const updated = await prisma.persona.update({
        where: { id: personaId },
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
  }

  if (req.method === 'DELETE') {
    try {
      await prisma.chatMessage.deleteMany({ where: { session: { personaId } } });
      await prisma.chatSession.deleteMany({ where: { personaId } });
      await prisma.persona.delete({ where: { id: personaId } });
      return res.status(204).end();
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2025') {
        return notFound(res, 'Persona not found', 'PERSONA_NOT_FOUND');
      }
      return serverError(res, 'Failed to delete persona', 'PERSONA_DELETE_FAILED');
    }
  }

  res.setHeader('Allow', ['PUT', 'DELETE']);
  return methodNotAllowed(res, req.method);
}
