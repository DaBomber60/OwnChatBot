/**
 * @jest-environment node
 *
 * Tests for performStreamingRequest in lib/chat/streamSSE.ts — specifically how it
 * distinguishes a stall timeout from a user-initiated stop, since the two must lead
 * to opposite UI behaviour (message stays sent vs. reverts to the input box).
 */

// Small timeouts so the stall timers fire quickly under real timers.
jest.mock('../lib/aiProvider', () => ({
  DEFAULT_TEMPERATURE: 0.7,
  DEFAULT_MAX_TOKENS: 4096,
  MAX_TOKENS_MIN: 256,
  MAX_TOKENS_MAX: 256000,
  DEFAULT_API_FAILURE_TIMEOUT: 20,
  STREAM_TIMEOUT_MULTIPLIER: 2,
  clampApiFailureTimeout: (n: number) => n,
  failureTimeoutMs: (_seconds: number, streaming: boolean) => (streaming ? 120 : 40),
}));

import { performStreamingRequest } from '../lib/chat/streamSSE';
import type { ChatSettings } from '../lib/chat/chatSettings';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });
beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}); });

const settings: ChatSettings = {
  stream: true,
  defaultPromptId: undefined,
  temperature: 0.7,
  maxTokens: 4096,
  apiFailureTimeout: 20,
  aiProvider: 'deepseek',
};

const encoder = new TextEncoder();
const frame = (content: string) => encoder.encode(`data: ${JSON.stringify({ content })}\n\n`);

/**
 * Stub fetch with an SSE response driven by `script`.
 * `wireAbort` mirrors real fetch behaviour, where aborting errors the body stream.
 */
function stubSSE(
  script: (controller: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal) => void,
  wireAbort = true,
) {
  global.fetch = jest.fn(async (_url: any, init: any) => {
    const signal: AbortSignal = init.signal;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (wireAbort) {
          signal.addEventListener('abort', () => {
            const err: any = new Error('The operation was aborted.');
            err.name = 'AbortError';
            try { controller.error(err); } catch {}
          });
        }
        script(controller, signal);
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }) as any;
}

function baseOpts(over: Record<string, any> = {}) {
  return {
    url: '/api/chat',
    body: {},
    abortControllerRef: { current: null as AbortController | null },
    chatSettings: settings,
    onStreamChunk: () => {},
    onNonStreamResult: () => {},
    onError: () => {},
    ...over,
  } as any;
}

describe('performStreamingRequest — stall timeout', () => {
  it('reports timedOut (not aborted) when no content ever arrives', async () => {
    stubSSE(() => { /* silence */ });
    const onError = jest.fn();
    const onAbort = jest.fn();

    const result = await performStreamingRequest(baseOpts({ onError, onAbort }));

    expect(result.timedOut).toBe(true);
    expect(result.wasAborted).toBe(false);
    expect(result.errorShown).toBe(true);
    expect(onAbort).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe('UPSTREAM_DOWN');
    expect(onError.mock.calls[0][0].title).toContain('DeepSeek');
  });

  it('reports a stalled stream when content started then stopped', async () => {
    stubSSE((controller) => { controller.enqueue(frame('partial reply')); });
    const onError = jest.fn();

    const result = await performStreamingRequest(baseOpts({ onError }));

    expect(result.timedOut).toBe(true);
    expect(result.wasAborted).toBe(false);
    expect(onError.mock.calls[0][0].code).toBe('UPSTREAM_STALLED');
  });

  it('still reports a timeout when the stream closes cleanly as the timer fires', async () => {
    // No abort wiring: the body ends normally just after the stall timer trips
    stubSSE((controller) => {
      setTimeout(() => { try { controller.close(); } catch {} }, 80);
    }, false);
    const onError = jest.fn();

    const result = await performStreamingRequest(baseOpts({ onError }));

    expect(result.timedOut).toBe(true);
    expect(result.errorShown).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('awaits onError so the caller never resolves before the message is reported', async () => {
    stubSSE(() => {});
    let reported = false;
    const onError = jest.fn(async () => {
      await new Promise(r => setTimeout(r, 20));
      reported = true;
    });

    await performStreamingRequest(baseOpts({ onError }));
    expect(reported).toBe(true);
  });

  it('does not time out while content keeps arriving', async () => {
    stubSSE((controller) => {
      let sent = 0;
      const tick = setInterval(() => {
        sent++;
        controller.enqueue(frame(`chunk${sent} `));
        if (sent === 4) { clearInterval(tick); controller.enqueue(encoder.encode('data: [DONE]\n\n')); }
      }, 40);
    });
    const onError = jest.fn();

    const result = await performStreamingRequest(baseOpts({ onError }));

    expect(result.timedOut).toBe(false);
    expect(result.errorShown).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(result.streamedContent).toBe('chunk1 chunk2 chunk3 chunk4 ');
  });
});

describe('performStreamingRequest — thinking detection', () => {
  const thinkingFrame = (thinking: boolean) =>
    encoder.encode(`data: ${JSON.stringify({ thinking })}\n\n`);

  it('records that the model reasoned even when it never replies', async () => {
    // The reported failure: reasoning streamed, zero content frames, clean [DONE].
    stubSSE((controller) => {
      controller.enqueue(thinkingFrame(true));
      controller.enqueue(thinkingFrame(false));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    }, false);
    const onThinking = jest.fn();

    const result = await performStreamingRequest(baseOpts({ onThinking }));

    expect(result.sawThinking).toBe(true);
    expect(result.streamedContent).toBe('');
    expect(result.errorShown).toBe(false);
    expect(onThinking).toHaveBeenCalledWith(true);
    expect(onThinking).toHaveBeenCalledWith(false);
  });

  it('stays false when the model never reasons', async () => {
    stubSSE((controller) => {
      controller.enqueue(frame('hello'));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    }, false);

    const result = await performStreamingRequest(baseOpts());

    expect(result.sawThinking).toBe(false);
    expect(result.thinkingMs).toBe(0);
    expect(result.streamedContent).toBe('hello');
  });

  it('measures thinking time even when the stream dies mid-thought', async () => {
    stubSSE((controller) => {
      controller.enqueue(thinkingFrame(true));
      setTimeout(() => { try { controller.close(); } catch {} }, 60);
    }, false);

    const result = await performStreamingRequest(baseOpts());

    expect(result.sawThinking).toBe(true);
    expect(result.thinkingMs).toBeGreaterThan(0);
  });
});

describe('performStreamingRequest — user stop', () => {
  it('reports wasAborted (not timedOut) and shows no error', async () => {
    const ref = { current: null as AbortController | null };
    stubSSE((controller) => {
      controller.enqueue(frame('hello'));
      // Simulate the user pressing Stop shortly after content starts
      setTimeout(() => ref.current?.abort(), 20);
    });
    const onError = jest.fn();
    const onAbort = jest.fn();

    const result = await performStreamingRequest(baseOpts({ abortControllerRef: ref, onError, onAbort }));

    expect(result.wasAborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.errorShown).toBe(false);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
