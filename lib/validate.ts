import { z } from 'zod';
import type { NextApiRequest, NextApiResponse } from 'next';
import { validationError, badRequest } from './apiErrors';

export type ParsedBody<T> = T & { _raw?: any };

export async function parseJson(req: NextApiRequest): Promise<any> {
  // Body should already be parsed by Next.js when content-type application/json
  // but safeguard if raw body string is present.
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body as any);
  } catch {
    return null;
  }
}

export function validateBody<T>(schema: any, req: NextApiRequest, res: NextApiResponse): T | undefined {
  const body = req.body;
  if (!body) {
    badRequest(res, 'Request body required', 'BODY_REQUIRED');
    return undefined;
  }
  const result = schema.safeParse(body);
  if (!result.success) {
  validationError(res, 'Invalid request body', result.error.issues.map((i: any) => ({ path: i.path, message: i.message, code: i.code })));
    return undefined;
  }
  return result.data;
}

// Centralized larger limits to better support long form character imports.
// DB columns are unbounded text, so these are purely API validation caps.
const CHARACTER_LIMITS = {
  bio: 2500,
  scenario: 25000,
  personality: 25000,
  firstMessage: 25000,
  exampleDialogue: 25000
};

export const schemas = {
  createSession: z.object({
    personaId: z.number().int().positive(),
    characterId: z.number().int().positive(),
    skipFirstMessage: z.boolean().optional()
  }),
  createMessage: z.object({
  sessionId: z.union([z.number(), z.string().regex(/^\d+$/)]).transform((v: any) => Number(v)).refine((v: number) => v > 0, 'sessionId must be positive'),
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(8000)
  }),
  updateSessionDescription: z.object({
    description: z.string().trim().max(2000)
  }),
  createPersona: z.object({
    name: z.string().trim().min(1).max(100),
    profile: z.string().trim().min(1),
    profileName: z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined))
  }),
  updatePersona: z.object({
    name: z.string().trim().min(1).max(100),
    profile: z.string().trim().min(1),
    profileName: z.string().trim().max(100).nullable().optional()
  }),
  createCharacterGroup: z.object({
    name: z.string().trim().min(1).max(100),
    color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional()
  }),
  updateCharacterGroup: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    isCollapsed: z.boolean().optional()
  }),
  createCharacter: z.object({
    name: z.string().trim().min(1).max(100),
    // Accept missing or empty string profileName (treat empty as undefined)
    profileName: z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined)),
    bio: z.string().max(CHARACTER_LIMITS.bio).optional(),
    scenario: z.string().max(CHARACTER_LIMITS.scenario).optional().default(''),
    personality: z.string().max(CHARACTER_LIMITS.personality).optional().default(''),
    firstMessage: z.string().max(CHARACTER_LIMITS.firstMessage).optional(),
    exampleDialogue: z.string().max(CHARACTER_LIMITS.exampleDialogue).optional(),
    // Accept null for "no group" and normalize to undefined
    groupId: z.number().int().positive().nullable().optional()
      .transform((v: number | null | undefined) => (v == null ? undefined : v))
  }),
  generateCharacter: z.object({
    name: z.string().trim().min(1).max(100),
    profileName: z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined)),
    description: z.string().trim().min(10).max(3000),
    // Sliders: only include keys that are not AUTO
    sliders: z.record(z.string(), z.number().min(0).max(100)).optional(),
    perspective: z.enum(['first','third']).optional().default('first')
  }),
  updateCharacter: z.object({
    name: z.string().trim().min(1).max(100),
    // Accept empty string or null -> undefined for easier client handling
    profileName: z.string().trim().max(100).optional().or(z.literal('').transform(() => undefined)).nullable()
      .transform((v: string | null | undefined) => v === null || v === '' ? undefined : v),
    bio: z.string().max(CHARACTER_LIMITS.bio).optional().or(z.literal('').transform(() => undefined)).nullable()
      .transform((v: string | null | undefined) => v === null || v === '' ? undefined : v),
    scenario: z.string().max(CHARACTER_LIMITS.scenario).optional(),
    personality: z.string().max(CHARACTER_LIMITS.personality).optional(),
    firstMessage: z.string().max(CHARACTER_LIMITS.firstMessage).optional(),
    exampleDialogue: z.string().max(CHARACTER_LIMITS.exampleDialogue).optional()
  }),
  upsertSettings: z.record(z.string().regex(/^[A-Za-z0-9_\-]+$/), z.union([z.string(), z.number(), z.boolean()])).refine((obj: Record<string, unknown>) => Object.keys(obj).length > 0, 'At least one setting required'),
  createUserPrompt: z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1)
  }),
  updateVariant: z.object({
    variantId: z.number().int().positive(),
    content: z.string().trim().min(1).max(8000).optional()
  }),
  rollbackVariant: z.object({
    action: z.literal('rollback_stopped_variant')
  }),
  notesUpdate: z.object({
    notes: z.string().max(10000)
  }),
  summaryUpdate: z.object({
    summary: z.string().max(20000)
  }),
  authSetup: z.object({
    password: z.string()
      .min(10, 'Password must be at least 10 characters long')
      .max(200, 'Password must be at most 200 characters')
  .refine((v: string) => /[0-9]/.test(v), 'Password must contain at least one number')
  .refine((v: string) => /[^A-Za-z0-9]/.test(v), 'Password must contain at least one special character')
  }),
  changePassword: z.object({
    newPassword: z.string()
      .min(10, 'Password must be at least 10 characters long')
      .max(200, 'Password must be at most 200 characters')
  .refine((v: string) => /[0-9]/.test(v), 'Password must contain at least one number')
  .refine((v: string) => /[^A-Za-z0-9]/.test(v), 'Password must contain at least one special character')
  })
};
