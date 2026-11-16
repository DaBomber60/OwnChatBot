import prisma from '../../../lib/prisma';
import { badRequest, notFound, tooManyRequests, upstreamError } from '../../../lib/apiErrors';
import { clientIp, limiters } from '../../../lib/rateLimit';
import { schemas, validateBody } from '../../../lib/validate';
import { withApiHandler } from '../../../lib/withApiHandler';
import { redactString } from '../../../lib/redact';
import { IMAGE_TIMEOUT_MS, buildCharacterImagePrompt, generateImage, getCloudflareCredentials } from '../../../lib/imageGeneration';

/**
 * GET  → { configured } — whether a Cloudflare account ID and API token are saved.
 * POST { prompt } | { characterId } → { image: dataURL } — a 1024×1024 picture from Cloudflare Workers AI.
 *   With characterId, the prompt is "create an image of this character: " plus its personality.
 */
export default withApiHandler({}, {
  GET: async (_req, res) => {
    const credentials = await getCloudflareCredentials();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ configured: credentials !== null });
  },

  POST: async (req, res) => {
    const rl = limiters.imageGenerate(clientIp(req as any));
    if (!rl.allowed) {
      return tooManyRequests(res, 'Too many pictures requested. Wait a moment and try again.', 'RATE_LIMITED', rl.retryAfterSeconds);
    }

    const body = validateBody<{ prompt?: string; characterId?: number }>(schemas.generateImage, req, res);
    if (!body) return;

    let prompt = body.prompt ?? '';
    if (body.characterId !== undefined) {
      const character = await prisma.character.findUnique({
        where: { id: body.characterId },
        select: { name: true, personality: true },
      });
      if (!character) return notFound(res, 'Character not found', 'CHARACTER_NOT_FOUND');
      if (!character.personality.trim()) {
        return badRequest(res, 'This character has no personality to describe yet. Write a prompt instead.', 'NO_PERSONALITY');
      }
      prompt = buildCharacterImagePrompt(character.name, character.personality);
    }

    const credentials = await getCloudflareCredentials();
    if (!credentials) {
      return badRequest(res, 'Add a Cloudflare account ID and API token in Settings to generate pictures', 'IMAGE_GENERATION_NOT_CONFIGURED');
    }

    // Stop paying for a picture nobody will receive once the client gives up.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });

    try {
      const result = await generateImage(credentials, prompt, controller.signal);
      if (res.writableEnded || res.destroyed) return;
      if (!result.ok) {
        console.error('[images/generate] Cloudflare error:', result.code, redactString(result.message));
        return upstreamError(res, {
          code: result.code,
          message: result.message,
          upstreamStatus: result.upstreamStatus,
          status: result.code === 'UPSTREAM_TIMEOUT' ? 504 : 502,
        });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ image: result.image });
    } finally {
      clearTimeout(timeout);
    }
  },
});
