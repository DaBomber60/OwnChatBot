/**
 * @jest-environment node
 *
 * Tests for lib/sseRelay.ts — the shared upstream→client SSE relay used by
 * chat generation and variant generation.
 */
import { relayUpstreamSSE } from '../lib/sseRelay';

function readerFrom(...chunks: Array<string | Uint8Array>): ReadableStreamDefaultReader<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const c = chunks[i]!;
        controller.enqueue(typeof c === 'string' ? encoder.encode(c) : c);
        i++;
      } else {
        controller.close();
      }
    },
  }).getReader();
}

function fakeRes() {
  const written: string[] = [];
  return {
    written,
    write: (s: string) => { written.push(s); return true; },
    get contentDeltas() {
      return written
        .filter(w => w.startsWith('data: {') && w.includes('"content"'))
        .map(w => JSON.parse(w.slice(6)).content as string);
    },
  } as any;
}

function upstreamFrame(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
}

describe('relayUpstreamSSE', () => {
  it('forwards content deltas and accumulates assistant text', async () => {
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom(upstreamFrame({ content: 'Hello' }), upstreamFrame({ content: ' world' }), 'data: [DONE]\n\n'),
      res,
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('Hello world');
    expect(result.sawDone).toBe(true);
    expect(res.contentDeltas).toEqual(['Hello', ' world']);
    expect(res.written).toContain('data: [DONE]\n\n');
  });

  it('reassembles upstream frames split across chunk boundaries', async () => {
    const frame = upstreamFrame({ content: 'split me' });
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom(frame.slice(0, 30), frame.slice(30), 'data: [DONE]\n\n'),
      res,
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('split me');
  });

  it('preserves multi-byte characters split across chunk boundaries', async () => {
    const bytes = new TextEncoder().encode(upstreamFrame({ content: 'caf\u00e9 \u2014 \ud83d\ude80' }));
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom(bytes.slice(0, 40), bytes.slice(40, 48), bytes.slice(48)),
      res,
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('caf\u00e9 \u2014 \ud83d\ude80');
  });

  it('routes reasoning_content to thinking text and emits thinking frames', async () => {
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom(
        upstreamFrame({ content: null, reasoning_content: 'Let me think' }),
        upstreamFrame({ content: null, reasoning_content: ' harder' }),
        upstreamFrame({ content: 'Answer.' }),
        'data: [DONE]\n\n',
      ),
      res,
      thinkingEnabled: true,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('Answer.');
    expect(result.assistantThinkingText).toBe('Let me think harder');
    expect(res.written).toContain('data: {"thinking":true}\n\n');
    expect(res.written).toContain('data: {"thinking":false}\n\n');
  });

  it('strips <think> blocks that span multiple deltas', async () => {
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom(
        upstreamFrame({ content: 'before <thi' }),
        upstreamFrame({ content: 'nk>hidden</think>after' }),
        'data: [DONE]\n\n',
      ),
      res,
      thinkingEnabled: true,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('before after');
    expect(result.assistantThinkingText).toBe('hidden');
  });

  it('leaves <think> tags alone when thinking is disabled', async () => {
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom(upstreamFrame({ content: 'a <think>b</think> c' }), 'data: [DONE]\n\n'),
      res,
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('a <think>b</think> c');
  });

  it('stops and reports when the client disconnects', async () => {
    const res = fakeRes();
    let connected = true;
    const result = await relayUpstreamSSE({
      reader: readerFrom(upstreamFrame({ content: 'first' }), upstreamFrame({ content: 'second' })),
      res,
      thinkingEnabled: false,
      canWrite: () => { const was = connected; connected = false; return was; },
    });

    expect(result.stopped).toBe(true);
    expect(result.sawDone).toBe(false);
  });

  it('flags writeFailed when res.write throws', async () => {
    const res = fakeRes();
    res.write = () => { throw new Error('EPIPE'); };
    const result = await relayUpstreamSSE({
      reader: readerFrom(upstreamFrame({ content: 'x' }), 'data: [DONE]\n\n'),
      res,
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.writeFailed).toBe(true);
  });

  it('skips malformed frames without losing later content', async () => {
    const res = fakeRes();
    const result = await relayUpstreamSSE({
      reader: readerFrom('data: not-json\n\n', upstreamFrame({ content: 'ok' }), 'data: [DONE]\n\n'),
      res,
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('ok');
  });

  it('reports partial content when the upstream reader aborts', async () => {
    const encoder = new TextEncoder();
    let sent = false;
    const reader = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(encoder.encode(upstreamFrame({ content: 'partial' })));
          return;
        }
        controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
    }).getReader();

    const result = await relayUpstreamSSE({
      reader,
      res: fakeRes(),
      thinkingEnabled: false,
      canWrite: () => true,
    });

    expect(result.assistantText).toBe('partial');
    expect(result.stopped).toBe(true);
    expect(result.sawDone).toBe(false);
  });

  it('rethrows non-abort read errors after onReadError', async () => {
    const onReadError = jest.fn();
    const reader = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error('socket hang up')); },
    }).getReader();

    await expect(relayUpstreamSSE({
      reader,
      res: fakeRes(),
      thinkingEnabled: false,
      canWrite: () => true,
      onReadError,
    })).rejects.toThrow('socket hang up');
    expect(onReadError).toHaveBeenCalled();
  });
});
