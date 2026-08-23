// Relays an upstream OpenAI-style SSE stream to our own SSE clients.
//
// Shared by chat generation and variant generation. Responsibilities:
//  - buffering partial frames / multi-byte chars across network chunks
//  - accumulating assistant text
//  - splitting DeepSeek reasoning (`reasoning_content` and `<think>` tags) out of
//    the visible text and emitting `{ thinking: bool }` frames instead
//  - forwarding visible deltas as `data: {"content": "..."}` frames
import type { NextApiResponse } from 'next';
import { matchPartialTag } from './aiProvider';

export interface SSERelayOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  res: NextApiResponse;
  /** Enables `<think>` / `reasoning_content` filtering. */
  thinkingEnabled: boolean;
  /** Must return false once the client is gone; the relay then stops writing and exits. */
  canWrite: () => boolean;
  /** Called with every raw upstream payload string (for debug capture). */
  onFrame?: (payload: string) => void;
  /** Called after every successful read from upstream; use it to reset an idle timeout. */
  onChunk?: (byteLength: number) => void;
  /** Snapshot hook, invoked at most once per `progressIntervalMs` while content streams. */
  onProgress?: (state: SSERelayState) => void | Promise<void>;
  progressIntervalMs?: number;
  /**
   * Called when `reader.read()` throws a non-abort error, before the relay rethrows.
   * Receives the content accumulated so far so callers can persist it.
   */
  onReadError?: (err: unknown, state: SSERelayState) => void | Promise<void>;
  /** Prefix for relay log lines, e.g. `[Stream]`. */
  logLabel?: string;
}

export interface SSERelayState {
  /** Visible assistant text (reasoning content excluded). */
  assistantText: string;
  /** Reasoning/thinking text, kept for logs only. */
  assistantThinkingText: string;
  /** Raw upstream payloads, in order. */
  frames: string[];
}

export interface SSERelayResult extends SSERelayState {
  /** Upstream sent the `[DONE]` sentinel. */
  sawDone: boolean;
  /** The relay exited early (client gone, upstream abort, or failed write). */
  stopped: boolean;
  /** A `res.write` threw — the client socket is gone. */
  writeFailed: boolean;
  totalChunks: number;
  totalBytes: number;
}

/**
 * Pump the upstream stream to `res` until `[DONE]`, upstream close, or client disconnect.
 * Throws only if `reader.read()` fails with a non-abort error.
 */
export async function relayUpstreamSSE(opts: SSERelayOptions): Promise<SSERelayResult> {
  const {
    reader, res, thinkingEnabled, canWrite,
    onFrame, onChunk, onProgress, onReadError,
    progressIntervalMs = 1500,
    logLabel = '[Stream]',
  } = opts;

  const state: SSERelayState = { assistantText: '', assistantThinkingText: '', frames: [] };
  let sawDone = false;
  let stopped = false;
  let writeFailed = false;
  let totalChunks = 0;
  let totalBytes = 0;

  // Cross-chunk buffers: network chunks split both SSE lines and `<think>` tags.
  let sseBuffer = '';
  let thinkTagBuffer = '';
  let insideThinkTag = false;
  const decoder = new TextDecoder();
  let lastProgressTs = Date.now();

  const write = (frame: Record<string, unknown> | string): boolean => {
    if (!canWrite()) return false;
    try {
      res.write(typeof frame === 'string' ? frame : `data: ${JSON.stringify(frame)}\n\n`);
      return true;
    } catch (error) {
      console.log(`${logLabel} Write failed, treating client as disconnected:`, (error as Error).message);
      writeFailed = true;
      stopped = true;
      return false;
    }
  };

  const setThinking = (thinking: boolean) => {
    insideThinkTag = thinking;
    write({ thinking });
  };

  /** Split a visible delta from any `<think>` block content. */
  const filterThinkTags = (delta: string): string => {
    let visible = '';
    let text = thinkTagBuffer + delta;
    thinkTagBuffer = '';
    while (text.length > 0) {
      if (insideThinkTag) {
        const closeIdx = text.indexOf('</think>');
        if (closeIdx !== -1) {
          state.assistantThinkingText += text.slice(0, closeIdx);
          text = text.slice(closeIdx + '</think>'.length);
          setThinking(false);
          continue;
        }
        const partialClose = matchPartialTag(text, '</think>');
        if (partialClose > 0) {
          state.assistantThinkingText += text.slice(0, -partialClose);
          thinkTagBuffer = text.slice(-partialClose);
        } else {
          state.assistantThinkingText += text;
        }
        text = '';
      } else {
        const openIdx = text.indexOf('<think>');
        if (openIdx !== -1) {
          visible += text.slice(0, openIdx);
          text = text.slice(openIdx + '<think>'.length);
          setThinking(true);
          continue;
        }
        const partialOpen = matchPartialTag(text, '<think>');
        if (partialOpen > 0) {
          visible += text.slice(0, -partialOpen);
          thinkTagBuffer = text.slice(-partialOpen);
        } else {
          visible += text;
        }
        text = '';
      }
    }
    return visible;
  };

  while (true) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (err) {
      if ((err as any)?.name === 'AbortError') {
        console.log(`${logLabel} Reader aborted`);
        stopped = true;
        break;
      }
      if (onReadError) await onReadError(err, state);
      throw err;
    }

    const { done, value } = readResult;
    if (done) break;

    if (onChunk) onChunk(value?.byteLength || 0);

    if (!canWrite()) {
      console.log(`${logLabel} Client disconnected, stopping stream processing`);
      stopped = true;
      break;
    }

    totalChunks++;
    totalBytes += value?.byteLength || 0;
    sseBuffer += decoder.decode(value, { stream: true });

    // Process complete lines only; a partial trailing line stays buffered.
    const lines = sseBuffer.split(/\r?\n/);
    sseBuffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      if (!rawLine.startsWith('data:')) continue;
      const payload = rawLine.slice(5).trim();
      if (!payload) continue;

      if (payload === '[DONE]') {
        write('data: [DONE]\n\n');
        sawDone = true;
        sseBuffer = '';
        break;
      }

      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue; // malformed frame — skip
      }

      state.frames.push(payload);
      if (onFrame) onFrame(payload);

      const delta: string = parsed.choices?.[0]?.delta?.content || '';
      const reasoningDelta: string = parsed.choices?.[0]?.delta?.reasoning_content || '';

      // DeepSeek streams reasoning in a separate field rather than <think> tags.
      if (reasoningDelta && thinkingEnabled) {
        state.assistantThinkingText += reasoningDelta;
        if (!insideThinkTag) setThinking(true);
      }

      if (!delta) continue;

      // Reasoning finished as soon as visible content starts arriving.
      if (insideThinkTag && thinkingEnabled && !reasoningDelta) setThinking(false);

      if (onProgress && Date.now() - lastProgressTs > progressIntervalMs) {
        lastProgressTs = Date.now();
        await onProgress(state);
      }

      const visible = thinkingEnabled ? filterThinkTags(delta) : delta;
      state.assistantText += visible;
      if (visible) write({ content: visible });

      if (!canWrite()) { stopped = true; break; }
    }

    if (sawDone || stopped || !canWrite()) {
      stopped = stopped || !canWrite();
      break;
    }
  }

  return { ...state, sawDone, stopped, writeFailed, totalChunks, totalBytes };
}
