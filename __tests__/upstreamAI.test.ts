/**
 * @jest-environment node
 *
 * Tests for lib/upstreamAI.ts — callUpstreamAI.
 * Uses mocked global fetch to avoid real network calls.
 */

// Mock aiProvider to provide the constant without needing Prisma
jest.mock('../lib/aiProvider', () => ({
  DEFAULT_FALLBACK_URL: 'https://api.deepseek.com/v1/chat/completions',
}));

import { callUpstreamAI } from '../lib/upstreamAI';
import type { UpstreamRequestOpts } from '../lib/upstreamAI';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

// Suppress console noise
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function stubFetch(body: any, init: ResponseInit = {}, contentType = 'application/json') {
  const headers: Record<string, string> = { 'Content-Type': contentType, ...((init.headers as Record<string, string>) || {}) };
  global.fetch = jest.fn(async () => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { ...init, status: init.status ?? 200, headers });
  });
}

function baseOpts(overrides: Partial<UpstreamRequestOpts> = {}): UpstreamRequestOpts {
  return {
    url: 'https://api.example.com/v1/chat/completions',
    apiKey: 'sk-test-key',
    body: { model: 'test-model', messages: [{ role: 'user', content: 'Hello' }] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('callUpstreamAI', () => {
  it('sends POST with correct headers', async () => {
    stubFetch({ choices: [{ message: { content: 'Hi' } }] });
    await callUpstreamAI(baseOpts());

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['Authorization']).toBe('Bearer sk-test-key');
  });

  it('uses DEFAULT_FALLBACK_URL when url is empty', async () => {
    stubFetch({ ok: true });
    await callUpstreamAI(baseOpts({ url: '' }));

    const [url] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  it('returns parsed JSON for non-streaming response', async () => {
    const responseBody = { choices: [{ message: { content: 'Hello!' } }] };
    stubFetch(responseBody);

    const result = await callUpstreamAI(baseOpts());
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual(responseBody);
    expect(result.rawText).toBe(JSON.stringify(responseBody));
  });

  it('returns raw text for non-JSON response', async () => {
    stubFetch('<html>Error</html>', { status: 502 }, 'text/html');

    const result = await callUpstreamAI(baseOpts());
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.rawText).toBe('<html>Error</html>');
    expect(result.data).toBeUndefined();
  });

  it('returns raw Response for SSE streaming response', async () => {
    global.fetch = jest.fn(async () => {
      return new Response('data: {"content":"hi"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });

    const result = await callUpstreamAI(baseOpts({
      body: { model: 'test', messages: [], stream: true },
    }));
    expect(result.ok).toBe(true);
    expect(result.raw).toBeInstanceOf(Response);
    // For streaming, data/rawText should not be populated (caller reads the stream)
    expect(result.data).toBeUndefined();
  });

  it('forwards AbortSignal to fetch', async () => {
    stubFetch({ ok: true });
    const controller = new AbortController();
    await callUpstreamAI(baseOpts({ signal: controller.signal }));

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(init.signal).toBe(controller.signal);
  });

  it('propagates fetch errors (network failure)', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Network error'); });
    await expect(callUpstreamAI(baseOpts())).rejects.toThrow('Network error');
  });

  it('handles non-OK non-streaming response', async () => {
    stubFetch({ error: { message: 'Rate limited' } }, { status: 429 });
    const result = await callUpstreamAI(baseOpts());
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.data?.error?.message).toBe('Rate limited');
  });

  it('serializes body as JSON', async () => {
    stubFetch({ ok: true });
    const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }], temperature: 0.7 };
    await callUpstreamAI(baseOpts({ body }));

    const [, init] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual(body);
  });
});
