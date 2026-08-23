/**
 * @jest-environment node
 *
 * Tests for lib/upstreamAI.ts — callUpstreamAI, upstreamTimeoutMs, startUpstreamRequest.
 * Uses mocked global fetch to avoid real network calls.
 */

// Mock aiProvider to provide the constants without needing Prisma
jest.mock('../lib/aiProvider', () => ({
  DEFAULT_FALLBACK_URL: 'https://api.deepseek.com/v1/chat/completions',
  UPSTREAM_TIMEOUT_GRACE_MS: 5000,
  failureTimeoutMs: (seconds: number, streaming: boolean) => seconds * 1000 * (streaming ? 2 : 1),
}));

import { callUpstreamAI, upstreamTimeoutMs, startUpstreamRequest } from '../lib/upstreamAI';
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

  it('applies timeoutMs as an abort signal', async () => {
    stubFetch({ ok: true });
    await callUpstreamAI(baseOpts({ timeoutMs: 1000 }));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('prefers an explicit signal over timeoutMs', async () => {
    stubFetch({ ok: true });
    const controller = new AbortController();
    await callUpstreamAI(baseOpts({ signal: controller.signal, timeoutMs: 1000 }));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(init.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// upstreamTimeoutMs
// ---------------------------------------------------------------------------
describe('upstreamTimeoutMs', () => {
  const cfg = { apiFailureTimeout: 20 } as any;
  const originalEnv = process.env.STREAM_TIMEOUT_MS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.STREAM_TIMEOUT_MS;
    else process.env.STREAM_TIMEOUT_MS = originalEnv;
  });

  it('uses the plain window for non-streaming requests', () => {
    delete process.env.STREAM_TIMEOUT_MS;
    expect(upstreamTimeoutMs(cfg, false)).toBe(20000);
  });

  it('doubles the window and adds grace for streaming requests', () => {
    delete process.env.STREAM_TIMEOUT_MS;
    expect(upstreamTimeoutMs(cfg, true)).toBe(45000);
  });

  it('honours the STREAM_TIMEOUT_MS override', () => {
    process.env.STREAM_TIMEOUT_MS = '1234';
    expect(upstreamTimeoutMs(cfg, true)).toBe(1234);
    expect(upstreamTimeoutMs(cfg, false)).toBe(1234);
  });
});

// ---------------------------------------------------------------------------
// startUpstreamRequest
// ---------------------------------------------------------------------------
describe('startUpstreamRequest', () => {
  const cfg = { url: 'https://api.example.com/v1/chat/completions', apiKey: 'sk-test', apiFailureTimeout: 20 } as any;

  beforeEach(() => { jest.useFakeTimers(); delete process.env.STREAM_TIMEOUT_MS; });
  afterEach(() => { jest.useRealTimers(); });

  it('sends the request with standard headers and an abort signal', async () => {
    stubFetch({ ok: true });
    const handle = await startUpstreamRequest(cfg, { body: { model: 'm' }, streaming: false });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(url).toBe(cfg.url);
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(handle.timeoutMs).toBe(20000);
    handle.stopTimer();
  });

  it('falls back to the default URL when none is configured', async () => {
    stubFetch({ ok: true });
    const handle = await startUpstreamRequest({ ...cfg, url: '' }, { body: {}, streaming: false });
    const [url] = (global.fetch as jest.Mock).mock.calls[0]!;
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    handle.stopTimer();
  });

  it('aborts and flags timedOut when the idle window elapses', async () => {
    stubFetch({ ok: true });
    const handle = await startUpstreamRequest(cfg, { body: {}, streaming: false });

    expect(handle.timedOut).toBe(false);
    jest.advanceTimersByTime(20000);
    expect(handle.timedOut).toBe(true);
  });

  it('keepAlive re-arms the timer so active streams are not aborted', async () => {
    stubFetch({ ok: true });
    const handle = await startUpstreamRequest(cfg, { body: {}, streaming: false });

    jest.advanceTimersByTime(15000);
    handle.keepAlive();
    jest.advanceTimersByTime(15000);
    expect(handle.timedOut).toBe(false);

    jest.advanceTimersByTime(5000);
    expect(handle.timedOut).toBe(true);
  });

  it('stopTimer prevents a later timeout without aborting', async () => {
    stubFetch({ ok: true });
    const handle = await startUpstreamRequest(cfg, { body: {}, streaming: false });

    handle.stopTimer();
    jest.advanceTimersByTime(60000);
    expect(handle.timedOut).toBe(false);
  });

  it('dispose aborts the request so the connection is closed', async () => {
    let capturedSignal: AbortSignal | undefined;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      capturedSignal = init.signal;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    const handle = await startUpstreamRequest(cfg, { body: {}, streaming: false });
    expect(capturedSignal!.aborted).toBe(false);
    handle.dispose('done');
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('clears the timer when the fetch itself fails', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Network error'); }) as any;
    await expect(startUpstreamRequest(cfg, { body: {}, streaming: false })).rejects.toThrow('Network error');
    // No pending timer should remain
    expect(jest.getTimerCount()).toBe(0);
  });
});
