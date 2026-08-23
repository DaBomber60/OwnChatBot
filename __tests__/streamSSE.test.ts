/**
 * @jest-environment node
 *
 * Tests for lib/chat/streamSSE.ts — readSSEStream and isSSEResponse.
 * (performStreamingRequest is a high-level orchestrator that depends on fetch and React refs,
 *  so it's tested via integration/e2e rather than unit tests.)
 */
import { readSSEStream, isSSEResponse } from '../lib/chat/streamSSE';

// ---------------------------------------------------------------------------
// Helper: create a ReadableStream from SSE text chunks
// ---------------------------------------------------------------------------
function sseStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// readSSEStream
// ---------------------------------------------------------------------------
describe('readSSEStream', () => {
  it('accumulates content from data frames', async () => {
    const stream = sseStream(
      'data: {"content":"Hello"}\n\n',
      'data: {"content":" world"}\n\n',
      'data: [DONE]\n\n',
    );
    const chunks: string[] = [];
    const result = await readSSEStream(stream, (acc, delta) => {
      chunks.push(delta);
    });
    expect(result).toBe('Hello world');
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('handles multiple data lines in a single chunk', async () => {
    const stream = sseStream(
      'data: {"content":"A"}\ndata: {"content":"B"}\n\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('AB');
  });

  it('stops when [DONE] is received', async () => {
    const stream = sseStream(
      'data: {"content":"first"}\n\n',
      'data: [DONE]\n\n',
      'data: {"content":"should not appear"}\n\n', // after DONE
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('first');
  });

  it('handles empty stream gracefully', async () => {
    const stream = sseStream(); // no chunks
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('');
  });

  it('skips non-data lines', async () => {
    const stream = sseStream(
      'event: message\ndata: {"content":"ok"}\nid: 1\n\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('ok');
  });

  it('skips frames with no content field', async () => {
    const stream = sseStream(
      'data: {"choices":[{"delta":{}}]}\n\n',
      'data: {"content":"real"}\n\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('real');
  });

  it('skips malformed JSON frames', async () => {
    const stream = sseStream(
      'data: not-json\n\n',
      'data: {"content":"ok"}\n\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('ok');
  });

  it('handles \\r\\n line endings', async () => {
    const stream = sseStream(
      'data: {"content":"cr"}\r\ndata: {"content":"lf"}\r\n\r\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('crlf');
  });

  it('provides accumulated content in callback', async () => {
    const stream = sseStream(
      'data: {"content":"A"}\n\n',
      'data: {"content":"B"}\n\n',
    );
    const accValues: string[] = [];
    await readSSEStream(stream, (acc) => {
      accValues.push(acc);
    });
    expect(accValues).toEqual(['A', 'AB']);
  });

  it('reassembles a frame split across chunk boundaries', async () => {
    const stream = sseStream(
      'data: {"conte',
      'nt":"Hello"}\n\ndata: {"content":" wo',
      'rld"}\n\n',
      'data: [DONE]\n\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('Hello world');
  });

  it('does not drop frames when chunks split on the newline', async () => {
    const stream = sseStream(
      'data: {"content":"A"}\n',
      '\ndata: {"content":"B"}\n\n',
    );
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('AB');
  });

  it('emits a final frame that is not newline-terminated', async () => {
    const stream = sseStream('data: {"content":"tail"}');
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('tail');
  });

  it('preserves multi-byte characters split across chunk boundaries', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"content":"caf\u00e9 \u2014 \ud83d\ude80"}\n\n');
    // Split mid-way through the multi-byte sequences
    const chunks = [bytes.slice(0, 22), bytes.slice(22, 30), bytes.slice(30)];
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < chunks.length) { controller.enqueue(chunks[i]!); i++; }
        else controller.close();
      },
    });
    const result = await readSSEStream(stream, () => {});
    expect(result).toBe('caf\u00e9 \u2014 \ud83d\ude80');
  });
});

// ---------------------------------------------------------------------------
// isSSEResponse
// ---------------------------------------------------------------------------
describe('isSSEResponse', () => {
  it('returns true for text/event-stream content type', () => {
    const res = new Response('', { headers: { 'Content-Type': 'text/event-stream' } });
    expect(isSSEResponse(res)).toBe(true);
  });

  it('returns true for text/event-stream with charset', () => {
    const res = new Response('', { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
    expect(isSSEResponse(res)).toBe(true);
  });

  it('returns false for application/json', () => {
    const res = new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    expect(isSSEResponse(res)).toBe(false);
  });

  it('returns false when no content-type header', () => {
    const res = new Response('');
    expect(isSSEResponse(res)).toBe(false);
  });
});
