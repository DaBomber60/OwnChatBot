import prisma from './prisma';
import { classifyUpstreamStatus, type UpstreamErrorCode } from './apiErrors';
import { sniffImageType } from './avatarStore';
import { IMAGE_PROMPT_MAX } from './avatar';
import { replacePlaceholders } from './systemPrompt';

export const CLOUDFLARE_ACCOUNT_ID_SETTING = 'cloudflareAccountId';
export const CLOUDFLARE_API_TOKEN_SETTING = 'cloudflareApiToken';

export const IMAGE_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
const IMAGE_MODEL_PATH = IMAGE_MODEL.split('/').map(encodeURIComponent).join('/');
const IMAGE_SIZE = 1024;
export const IMAGE_TIMEOUT_MS = 120_000;

export const AUTO_IMAGE_PROMPT_PREFIX = 'create an image of this character: ';

/**
 * The "auto-generate" prompt: the prefix followed by the character's personality, with
 * placeholders filled in and whitespace collapsed, cut at a word boundary to fit the prompt limit.
 */
export function buildCharacterImagePrompt(name: string, personality: string): string {
  const description = replacePlaceholders(personality, 'the user', name).replace(/\s+/g, ' ').trim();
  const room = IMAGE_PROMPT_MAX - AUTO_IMAGE_PROMPT_PREFIX.length;
  const fitted = description.length <= room
    ? description
    : description.slice(0, room + 1).replace(/\s*\S*$/, '') || description.slice(0, room);
  return AUTO_IMAGE_PROMPT_PREFIX + fitted;
}

export interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
}

/** Both values are required; image generation is offered only when they are set. */
export async function getCloudflareCredentials(): Promise<CloudflareCredentials | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: [CLOUDFLARE_ACCOUNT_ID_SETTING, CLOUDFLARE_API_TOKEN_SETTING] } },
  });
  const value = (key: string) => rows.find(r => r.key === key)?.value.trim() ?? '';
  const accountId = value(CLOUDFLARE_ACCOUNT_ID_SETTING);
  const apiToken = value(CLOUDFLARE_API_TOKEN_SETTING);
  return accountId && apiToken ? { accountId, apiToken } : null;
}

export type ImageGenerationResult =
  | { ok: true; image: string }
  | { ok: false; code: UpstreamErrorCode; message: string; upstreamStatus?: number };

interface CloudflareResponse {
  success?: boolean;
  result?: { image?: unknown };
  errors?: Array<{ code?: number; message?: string }>;
}

function cloudflareErrorMessage(body: CloudflareResponse | null, fallback: string): string {
  const messages = (body?.errors ?? []).map(e => e?.message).filter((m): m is string => typeof m === 'string' && m.length > 0);
  return messages.length ? messages.join('; ') : fallback;
}

/** Runs the FLUX.2 [klein] model on Cloudflare Workers AI and returns the picture as a data URL. */
export async function generateImage(
  credentials: CloudflareCredentials,
  prompt: string,
  signal?: AbortSignal,
): Promise<ImageGenerationResult> {
  // Account IDs are hex strings; anything else would change the request path.
  if (!/^[A-Za-z0-9]+$/.test(credentials.accountId)) {
    return { ok: false, code: 'UPSTREAM_BAD_REQUEST', message: 'The Cloudflare account ID in Settings is not valid' };
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/ai/run/${IMAGE_MODEL_PATH}`;
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', String(IMAGE_SIZE));
  form.append('height', String(IMAGE_SIZE));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.apiToken}` },
      body: form,
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError' || (error as Error)?.name === 'TimeoutError') {
      return { ok: false, code: 'UPSTREAM_TIMEOUT', message: 'Cloudflare took too long to generate the picture' };
    }
    return { ok: false, code: 'UPSTREAM_UNAVAILABLE', message: 'Could not reach Cloudflare' };
  }

  const text = await response.text();
  let body: CloudflareResponse | null = null;
  try {
    body = JSON.parse(text) as CloudflareResponse;
  } catch {
    // Non-JSON error pages are reported by status below.
  }

  if (!response.ok) {
    const message = cloudflareErrorMessage(body, `Cloudflare returned HTTP ${response.status}`);
    return { ok: false, code: classifyUpstreamStatus(response.status, message), message, upstreamStatus: response.status };
  }
  if (!body?.success) {
    return { ok: false, code: 'UPSTREAM_API_ERROR', message: cloudflareErrorMessage(body, 'Cloudflare could not generate the picture') };
  }

  const encoded = body.result?.image;
  const data = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : null;
  const mimeType = data ? sniffImageType(data) : null;
  if (!data || !mimeType) {
    return { ok: false, code: 'UPSTREAM_UNPARSEABLE', message: 'Cloudflare did not return a usable image' };
  }
  return { ok: true, image: `data:${mimeType};base64,${data.toString('base64')}` };
}
