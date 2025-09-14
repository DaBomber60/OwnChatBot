import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { badRequest, methodNotAllowed, conflict, serverError } from '../../../lib/apiErrors';
import { schemas, validateBody } from '../../../lib/validate';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  if (req.method !== 'GET') {
    console.log('[/api/characters] Incoming body:', req.body);
  }
  if (req.method === 'GET') {
    try {
      const characters = await prisma.character.findMany({
        include: { group: true }
      });
      return res.status(200).json(characters);
    } catch (e) {
      return serverError(res, 'Failed to fetch characters', 'CHARACTERS_FETCH_FAILED');
    }
  }

  if (req.method === 'POST') {
    const body = validateBody(schemas.createCharacter, req, res);
    if (!body) return;
    const { name, profileName, bio, scenario, personality, firstMessage, exampleDialogue, groupId } = body as any;
    try {
      const character = await prisma.character.create({
        data: {
          name,
          scenario: scenario || '',
          personality: personality || '',
          firstMessage: firstMessage || "You didn't enter a first message for this character :(",
          exampleDialogue: exampleDialogue || '',
          ...(profileName && { profileName }),
          ...(bio && { bio }),
          ...(groupId && { groupId })
        }
      });
      return res.status(201).json(character);
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && (error as any).code === 'P2002') {
        return conflict(res, 'A character with this name and profile name combination already exists', 'CHARACTER_DUPLICATE');
      }
      return serverError(res, 'Failed to create character', 'CHARACTER_CREATE_FAILED');
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return methodNotAllowed(res, req.method);
}
