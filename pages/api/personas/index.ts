import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, methodNotAllowed, conflict, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  try {
    if (req.method === 'GET') {
      const personas = await prisma.persona.findMany();
      return res.status(200).json(personas);
    }

    if (req.method === 'POST') {
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
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return methodNotAllowed(res, req.method);
  } catch (error: unknown) {
    console.error('Error in /api/personas:', error);
    return serverError(res, 'Internal Server Error');
  }
}
