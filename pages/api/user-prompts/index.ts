import type { NextApiRequest, NextApiResponse } from 'next';
import prisma from '../../../lib/prisma';
import { requireAuth } from '../../../lib/apiAuth';
import { schemas, validateBody } from '../../../lib/validate';
import { badRequest } from '../../../lib/apiErrors';
import { DEFAULT_USER_PROMPT_TITLE, DEFAULT_USER_PROMPT_BODY } from '../../../lib/defaultUserPrompt';

// Setting key to record that we have seeded the default prompt at least once.
const SEED_FLAG_KEY = 'defaultUserPromptSeeded';

async function ensureSeedOnce() {
  // If already seeded, do nothing.
  const seeded = await prisma.setting.findUnique({ where: { key: SEED_FLAG_KEY } });
  if (seeded) return null;
  const existing = await prisma.userPrompt.findUnique({ where: { title: DEFAULT_USER_PROMPT_TITLE } });
  let created = existing;
  if (!existing) {
    created = await prisma.userPrompt.create({ data: { title: DEFAULT_USER_PROMPT_TITLE, body: DEFAULT_USER_PROMPT_BODY } });
  }
  await prisma.setting.upsert({
    where: { key: SEED_FLAG_KEY },
    update: { value: 'true' },
    create: { key: SEED_FLAG_KEY, value: 'true' }
  });
  // If no defaultPromptId is set, set it now.
  const defaultPromptSetting = await prisma.setting.findUnique({ where: { key: 'defaultPromptId' } });
  if (!defaultPromptSetting && created) {
    await prisma.setting.create({ data: { key: 'defaultPromptId', value: String(created.id) } });
  }
  return created;
}

async function recreateDefaultPrompt() {
  // Re-create only if missing; do not duplicate if present.
  const existing = await prisma.userPrompt.findUnique({ where: { title: DEFAULT_USER_PROMPT_TITLE } });
  if (existing) return existing;
  const created = await prisma.userPrompt.create({ data: { title: DEFAULT_USER_PROMPT_TITLE, body: DEFAULT_USER_PROMPT_BODY } });
  // Leave seed flag alone (might already exist). If defaultPromptId not set, set it.
  const defaultPromptSetting = await prisma.setting.findUnique({ where: { key: 'defaultPromptId' } });
  if (!defaultPromptSetting) {
    await prisma.setting.create({ data: { key: 'defaultPromptId', value: String(created.id) } });
  }
  return created;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!(await requireAuth(req, res))) return;
  try {
    if (req.method === 'GET') {
      if (!('userPrompt' in prisma)) {
        return res.status(200).json([]);
      }
      // Seed exactly once (creates if never seeded before, even if user deleted it later the seed flag prevents recreation).
      await ensureSeedOnce();
      const prompts = await prisma.userPrompt.findMany({ orderBy: { createdAt: 'desc' } });
      return res.status(200).json(prompts);
    }
    if (req.method === 'POST') {
      if (!('userPrompt' in prisma)) {
        return badRequest(res, 'UserPrompt model not available', 'USER_PROMPT_MODEL_MISSING');
      }
      // Optional special action for recreating default (developer mode button will call with { action: 'recreate_default' })
      if (req.body && req.body.action === 'recreate_default') {
        const recreated = await recreateDefaultPrompt();
        return res.status(201).json({ recreated: true, prompt: recreated });
      }
      const body = validateBody(schemas.createUserPrompt, req, res);
      if (!body) return;
      const { title, body: promptBody } = body as any;
      try {
        const prompt = await prisma.userPrompt.create({ data: { title, body: promptBody } });
        return res.status(201).json(prompt);
      } catch (e: any) {
        if (e?.code === 'P2002') {
          return badRequest(res, 'A prompt with this title already exists', 'DUPLICATE_TITLE');
        }
        throw e;
      }
    }
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error: unknown) {
    console.error('User-prompts API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
    return res.status(500).json({ error: errorMessage });
  }
}
