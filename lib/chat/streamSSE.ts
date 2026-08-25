/**
 * Reads an SSE (Server-Sent Events) stream and delivers content chunks via callback.
 *
 * Handles: reader lifecycle, `data:` line parsing, `[DONE]` sentinel, AbortError detection.
 * Caller is responsible for creating the fetch, checking response.ok, and providing the body stream.
 *
 * @returns The fully accumulated content string.
 */
export async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onContent: (accumulated: string, delta: string) => void,
  onThinking?: (isThinking: boolean) => void,
  onStatus?: (status: string, payload: any) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  // Holds the trailing partial line between reads; network chunks split mid-frame.
  let buffer = '';
  let done = false;

  /** Processes one complete SSE line. Returns true if the stream is finished ([DONE]). */
  const handleLine = (rawLine: string): boolean => {
    if (!rawLine.startsWith('data:')) return false;
    const payload = rawLine.slice(5).trim();
    if (payload === '[DONE]') return true;

    try {
      const parsed = JSON.parse(payload);
      // Handle thinking state frames
      if (typeof parsed.thinking === 'boolean') {
        if (onThinking) onThinking(parsed.thinking);
        return false;
      }
      if (typeof parsed.status === 'string') {
        if (onStatus) onStatus(parsed.status, parsed);
        return false;
      }
      const content: string = parsed.content || '';
      if (content) {
        accumulated += content;
        onContent(accumulated, content);
      }
    } catch {
      // Skip malformed JSON frames
    }
    return false;
  };

  try {
    while (!done) {
      const { value, done: doneReading } = await reader.read();
      if (doneReading) {
        // Flush any bytes held by the decoder, then process a final unterminated line
        buffer += decoder.decode();
        if (buffer) handleLine(buffer);
        buffer = '';
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      // Last element is either '' (chunk ended on a newline) or an incomplete line
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (handleLine(line)) { done = true; buffer = ''; break; }
      }
    }
  } finally {
    // Cancel first so the underlying HTTP body is closed when we stop early (e.g. [DONE]),
    // otherwise the connection can stay open and keep receiving data.
    try { await reader.cancel(); } catch {}
    try { reader.releaseLock(); } catch {}
  }

  return accumulated;
}

/** Returns true if the response Content-Type indicates an SSE stream. */
export function isSSEResponse(res: Response): boolean {
  return (res.headers.get('content-type') || '').includes('text/event-stream');
}

// ---------------------------------------------------------------------------
// High-level streaming request orchestrator
// ---------------------------------------------------------------------------

import type React from 'react';
import { fetchChatSettings, type ChatSettings } from './chatSettings';
import { failureTimeoutMs, STREAM_TIMEOUT_MULTIPLIER } from '../aiProvider';
import { safeJson, extractErrorFromResponse, toErrorDetail } from './errorUtils';
import { describeChatError, describeServerError, type ChatErrorCode, type ChatErrorContext, type ChatErrorCopy } from './errorCopy';

/** Options for performStreamingRequest. Each caller provides its specific callbacks. */
export interface StreamingRequestOpts {
  /** The URL to POST to. */
  url: string;
  /** The JSON body to send (settings fields are merged automatically). */
  body: Record<string, any>;
  /** Ref to store the AbortController (so the caller can cancel). */
  abortControllerRef: React.MutableRefObject<AbortController | null>;

  // --- Callbacks for per-chunk and completion ---
  /** Called with each SSE chunk (accumulated content so far). */
  onStreamChunk: (accumulated: string) => void;
  /** Called once with the final parsed JSON if the response was non-streaming. */
  onNonStreamResult: (data: any) => void;
  /** Called after a successful stream/non-stream completion (before mutate delay). */
  onComplete?: () => void | Promise<void>;
  /** Called when the model enters/exits thinking mode (DeepSeek). */
  onThinking?: (isThinking: boolean) => void;

  // --- Error handling ---
  /** Called when an error should be shown to the user. Awaited before the request resolves. */
  onError: (error: ChatErrorCopy) => void | Promise<void>;
  /** Called on AbortError (user cancelled). Return value controls whether normal cleanup runs. */
  onAbort?: () => void;
  /**
   * Called when the stream produced partial content but then errored.
   * If not provided, partial-content errors are silently logged (no modal).
   */
  onPartialStreamError?: (err: any) => void;

  // --- Optional overrides ---
  /** If true, skip the automatic fetchChatSettings() and use the provided `chatSettings`. */
  chatSettings?: ChatSettings;
  /** If true, don't include temperature/maxTokens/etc in the request body. */
  skipSettingsInBody?: boolean;
}

export interface StreamingRequestResult {
  /** The chat settings that were used for this request. */
  settings: ChatSettings;
  /** The accumulated streamed content (empty string for non-stream). */
  streamedContent: string;
  /** Whether the request used streaming. */
  wasStreaming: boolean;
  /** Whether the request was aborted by the user. */
  wasAborted: boolean;
  /** Whether our own stall timer cancelled the request. */
  timedOut: boolean;
  /** Whether `onError` was already invoked (so callers don't double-report). */
  errorShown: boolean;
  /** Whether the model streamed any reasoning, even if it never produced a visible reply. */
  sawThinking: boolean;
  /** How long the model spent in thinking mode, in milliseconds. */
  thinkingMs: number;
  /** Set when the server threw the reply away, e.g. `max_tokens`. */
  discardedReason?: string;
}

/**
 * Unified orchestrator for all AI streaming/non-streaming requests.
 *
 * Handles: settings fetch, abort controller setup, fetch + signal, SSE vs JSON branching,
 * error handling, abort detection. Caller provides callbacks for the parts that differ.
 */
export async function performStreamingRequest(opts: StreamingRequestOpts): Promise<StreamingRequestResult> {
  const {
    url, body, abortControllerRef,
    onStreamChunk, onNonStreamResult, onComplete,
    onError, onAbort, onPartialStreamError,
    onThinking,
    skipSettingsInBody,
  } = opts;

  // Created before the settings fetch below: the caller already shows a Stop button, and
  // until this is assigned there is nothing for it to abort.
  const abortController = new AbortController();
  abortControllerRef.current = abortController;

  // 1. Fetch settings (or use provided)
  const settings = opts.chatSettings ?? await fetchChatSettings();
  const { stream: streamSetting } = settings;

  let errorShown = false;
  let timedOut = false;
  let userAborted = abortController.signal.aborted;
  let sawThinking = false;
  let thinkingStartedAt = 0;
  let thinkingEndedAt = 0;
  let discardedReason: string | undefined;

  const trackStatus = (status: string, payload: any) => {
    if (status === 'discarded') discardedReason = payload?.reason || 'unknown';
  };

  // The model can still be thinking when the stream dies, so fall back to "now".
  const thinkingElapsed = () =>
    thinkingStartedAt ? (thinkingEndedAt || Date.now()) - thinkingStartedAt : 0;

  const trackThinking = (isThinking: boolean) => {
    if (isThinking) {
      if (!sawThinking) { sawThinking = true; thinkingStartedAt = Date.now(); }
      thinkingEndedAt = 0;
    } else if (thinkingStartedAt) {
      thinkingEndedAt = Date.now();
    }
    if (onThinking) onThinking(isThinking);
  };

  const reportError = async (error: ChatErrorCopy) => {
    errorShown = true;
    await onError(error);
  };
  const fail = (code: ChatErrorCode, ctx: ChatErrorContext = {}) =>
    reportError(describeChatError(code, { provider: settings.aiProvider, ...ctx }));

  const result = (over: Partial<StreamingRequestResult> = {}): StreamingRequestResult => ({
    settings,
    streamedContent: '',
    wasStreaming: streamSetting,
    wasAborted: false,
    timedOut,
    errorShown,
    sawThinking,
    thinkingMs: thinkingElapsed(),
    discardedReason,
    ...over,
  });

  // 2. Bail if Stop was pressed while the settings were loading
  if (userAborted) {
    abortControllerRef.current = null;
    if (onAbort) onAbort();
    return result({ wasAborted: true });
  }

  // 3. Build request body
  const requestBody = skipSettingsInBody
    ? { ...body, stream: streamSetting }
    : {
        ...body,
        stream: streamSetting,
        userPromptId: settings.defaultPromptId,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      };

  // 4. Fetch
  const timeoutMs = failureTimeoutMs(settings.apiFailureTimeout, false);
  // Non-streaming gets its deadline from our own timer rather than AbortSignal.timeout, so the
  // same controller serves both the deadline and the user's Stop button.
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  if (!streamSetting) {
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, timeoutMs);
  }
  const res = await (async () => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        // Nothing else can abort this first leg, so an abort without our deadline is a Stop.
        if (!timedOut) {
          userAborted = true;
          return null;
        }
        await fail('UPSTREAM_DOWN', { timeoutSeconds: settings.apiFailureTimeout });
        return null;
      }
      throw err;
    } finally {
      if (deadlineTimer) { clearTimeout(deadlineTimer); deadlineTimer = null; }
    }
  })();
  if (!res) {
    abortControllerRef.current = null;
    if (userAborted && onAbort) onAbort();
    return result({ wasAborted: userAborted });
  }

  // 5. Non-OK + non-SSE → immediate error
  if (!res.ok && (!streamSetting || !res.body || !isSSEResponse(res))) {
    const errData = await safeJson(res);
    const headerRetry = Number(res.headers.get('retry-after'));
    await reportError(describeServerError(errData?.code, {
      provider: settings.aiProvider,
      maxTokens: settings.maxTokens,
      retryAfterSeconds: errData?.retryAfter ?? (Number.isFinite(headerRetry) ? headerRetry : undefined),
      detail: extractErrorFromResponse(errData, res.statusText),
    }));
    return result();
  }

  let streamedContent = '';
  let wasAborted = false;

  // 6. SSE streaming path
  if (streamSetting && res.body && isSSEResponse(res)) {
    // Stall detection: `apiFailureTimeout` to produce the first content, then a
    // rolling window of twice that between chunks for the rest of the stream.
    const firstContentMs = failureTimeoutMs(settings.apiFailureTimeout, false);
    const idleMs = failureTimeoutMs(settings.apiFailureTimeout, true);
    let firstContentReceived = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const abortForTimeout = () => {
      timedOut = true;
      // Aborting tears down the connection so the provider can't deliver a late response
      abortController?.abort();
    };
    const armStallTimer = (ms: number) => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(abortForTimeout, ms);
    };
    const clearStallTimer = () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    };
    const reportTimeout = async () => {
      if (firstContentReceived) {
        // Content had started, so surface it as a stalled stream rather than "API is down"
        await fail('UPSTREAM_STALLED', { stallSeconds: settings.apiFailureTimeout * STREAM_TIMEOUT_MULTIPLIER });
      } else {
        await fail('UPSTREAM_DOWN', { timeoutSeconds: settings.apiFailureTimeout });
      }
    };
    armStallTimer(firstContentMs);

    try {
      streamedContent = await readSSEStream(res.body, (accumulated) => {
        firstContentReceived = true;
        armStallTimer(idleMs);
        onStreamChunk(accumulated);
      }, trackThinking, trackStatus);
      clearStallTimer();
      // The stream can close cleanly in the same tick our timer fires; still a timeout.
      if (timedOut) {
        await reportTimeout();
        return result({ wasStreaming: true });
      }
      if (onComplete) await onComplete();
    } catch (err: any) {
      clearStallTimer();
      if (err.name === 'AbortError') {
        if (timedOut) {
          await reportTimeout();
          return result({ wasStreaming: true });
        }
        wasAborted = true;
        if (onAbort) onAbort();
      } else {
        // Non-abort error during streaming
        if (streamedContent.length > 0 || (onStreamChunk as any).__lastAccumulated?.length > 0) {
          // Partial content was streamed — suppress scary modal
          if (onPartialStreamError) {
            onPartialStreamError(err);
          } else {
            console.warn('Stream ended early after partial content; no modal');
          }
        } else {
          await fail('UPSTREAM_ERROR', {
            detail: toErrorDetail(err?.message || 'Streaming error'),
          });
        }
      }
    } finally {
      abortControllerRef.current = null;
    }
  } else {
    // 7. Non-streaming JSON path
    try {
      const data = await safeJson(res);
      onNonStreamResult(data);
      if (onComplete) await onComplete();
    } catch (error) {
      console.error('Failed to parse response:', error);
      await fail('UPSTREAM_UNPARSEABLE');
    }
  }

  return result({ streamedContent, wasAborted });
}
