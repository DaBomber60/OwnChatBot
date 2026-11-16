/**
 * @jest-environment node
 */
import { mockReq, mockRes, suppressConsole } from './helpers/mockHttp';

jest.mock('../lib/apiAuth', () => ({
  requireAuth: jest.fn().mockResolvedValue(true),
}));

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    setting: { findMany: jest.fn() },
    character: { findUnique: jest.fn() },
  },
}));

import prisma from '../lib/prisma';
import { IMAGE_PROMPT_MAX } from '../lib/avatar';
import { AUTO_IMAGE_PROMPT_PREFIX, buildCharacterImagePrompt, generateImage } from '../lib/imageGeneration';
import handler from '../pages/api/images/generate';

const db = prisma as any;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const credentials = { accountId: 'abc123', apiToken: 'cf-token' };
const settingsRows = (accountId: string, apiToken: string) => [
  { key: 'cloudflareAccountId', value: accountId },
  { key: 'cloudflareApiToken', value: apiToken },
];
const cloudflareReply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }) as Response;
const fetchMock = jest.fn();

suppressConsole();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
});

describe('generateImage', () => {
  it('posts the prompt to FLUX.2 [klein] as multipart form data and returns a data URL', async () => {
    fetchMock.mockResolvedValue(cloudflareReply(200, { result: { image: JPEG.toString('base64') }, success: true, errors: [] }));
    const result = await generateImage(credentials, 'a knight at dusk');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/%40cf/black-forest-labs/flux-2-klein-9b');
    expect(init.headers).toEqual({ Authorization: 'Bearer cf-token' });
    const form = init.body as FormData;
    expect([form.get('prompt'), form.get('width'), form.get('height')]).toEqual(['a knight at dusk', '1024', '1024']);
    expect(result).toEqual({ ok: true, image: `data:image/jpeg;base64,${JPEG.toString('base64')}` });
  });

  it("reports Cloudflare's own error message and classifies the failure", async () => {
    fetchMock.mockResolvedValue(cloudflareReply(401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
    await expect(generateImage(credentials, 'x')).resolves.toEqual({
      ok: false, code: 'UPSTREAM_AUTH', message: 'Authentication error', upstreamStatus: 401,
    });

    fetchMock.mockResolvedValue(cloudflareReply(200, { result: { image: Buffer.from('not an image').toString('base64') }, success: true }));
    await expect(generateImage(credentials, 'x')).resolves.toMatchObject({ ok: false, code: 'UPSTREAM_UNPARSEABLE' });
  });

  it('refuses an account ID that would change the request path', async () => {
    await expect(generateImage({ ...credentials, accountId: '../user' }, 'x')).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildCharacterImagePrompt', () => {
  it('prefixes the personality, filling in placeholders and collapsing whitespace', () => {
    expect(buildCharacterImagePrompt('Aria', '{{char}} has silver hair.\n\nShe smiles at {{user}}.'))
      .toBe('create an image of this character: Aria has silver hair. She smiles at the user.');
  });

  it('cuts long personalities at a word boundary within the prompt limit', () => {
    const prompt = buildCharacterImagePrompt('Aria', 'brave '.repeat(1000));
    expect(prompt.length).toBeLessThanOrEqual(IMAGE_PROMPT_MAX);
    expect(prompt.startsWith(AUTO_IMAGE_PROMPT_PREFIX)).toBe(true);
    expect(prompt.endsWith('brave')).toBe(true);
  });
});

describe('/api/images/generate', () => {
  it('reports whether both Cloudflare settings are saved', async () => {
    db.setting.findMany.mockResolvedValue(settingsRows('abc123', '  '));
    const missing = mockRes();
    await handler(mockReq({ method: 'GET' }), missing);
    expect(missing._body).toEqual({ configured: false });

    db.setting.findMany.mockResolvedValue(settingsRows('abc123', 'cf-token'));
    const ready = mockRes();
    await handler(mockReq({ method: 'GET' }), ready);
    expect(ready._body).toEqual({ configured: true });
  });

  it('refuses to generate until Cloudflare is set up', async () => {
    db.setting.findMany.mockResolvedValue([]);
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { prompt: 'a knight' } }), res);
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('IMAGE_GENERATION_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-generates from the character's personality", async () => {
    db.setting.findMany.mockResolvedValue(settingsRows('abc123', 'cf-token'));
    db.character.findUnique.mockResolvedValue({ name: 'Aria', personality: 'Calm and curious.' });
    fetchMock.mockResolvedValue(cloudflareReply(200, { result: { image: JPEG.toString('base64') }, success: true }));

    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { characterId: 7 } }), res);
    expect(res._status).toBe(200);
    expect(res._body.image).toMatch(/^data:image\/jpeg;base64,/);
    expect((fetchMock.mock.calls[0][1].body as FormData).get('prompt')).toBe('create an image of this character: Calm and curious.');
  });

  it("doesn't auto-generate for a character with no personality", async () => {
    db.character.findUnique.mockResolvedValue({ name: 'Aria', personality: '  ' });
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { characterId: 7 } }), res);
    expect(res._status).toBe(400);
    expect(res._body.code).toBe('NO_PERSONALITY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a rejected Cloudflare token into a 502, never a 401 that would look like a sign-out', async () => {
    db.setting.findMany.mockResolvedValue(settingsRows('abc123', 'bad-token'));
    fetchMock.mockResolvedValue(cloudflareReply(403, { success: false, errors: [{ message: 'Authentication error' }] }));
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { prompt: 'a knight' } }), res);
    expect(res._status).toBe(502);
    expect(res._body).toMatchObject({ code: 'UPSTREAM_AUTH', error: 'Authentication error', upstreamStatus: 403 });
  });
});
