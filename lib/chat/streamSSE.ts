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
import { fetchChatSettings, type ChatSettings, PROVIDER_DISPLAY_NAMES } from './chatSettings';
import { failureTimeoutMs, STREAM_TIMEOUT_MULTIPLIER } from '../aiProvider';
import { safeJson, extractErrorFromResponse, sanitizeErrorMessage, extractUsefulError } from './errorUtils';

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
  onError: (message: string) => void | Promise<void>;
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

  // 1. Fetch settings (or use provided)
  const settings = opts.chatSettings ?? await fetchChatSettings();
  const { stream: streamSetting } = settings;

  let errorShown = false;
  let timedOut = false;
  const reportError = async (message: string) => {
    errorShown = true;
    await onError(message);
  };
  const result = (over: Partial<StreamingRequestResult> = {}): StreamingRequestResult => ({
    settings,
    streamedContent: '',
    wasStreaming: streamSetting,
    wasAborted: false,
    timedOut,
    errorShown,
    ...over,
  });

  // 2. Abort controller
  let abortController: AbortController | undefined;
  if (streamSetting) {
    abortController = new AbortController();
    abortControllerRef.current = abortController;
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
  const res = await (async () => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        ...(streamSetting && abortController ? { signal: abortController.signal } : {}),
        ...(!streamSetting ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      });
    } catch (err: any) {
      if (!streamSetting && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        timedOut = true;
        const providerName = PROVIDER_DISPLAY_NAMES[settings.aiProvider] || settings.aiProvider;
        await reportError(`OwnChatBot is working, but the ${providerName} API is down.\n\nNo response was received within ${settings.apiFailureTimeout} seconds. You can adjust this timeout in Settings.`);
        return null;
      }
      throw err;
    }
  })();
  if (!res) return result();

  // 5. Non-OK + non-SSE → immediate error
  if (!res.ok && (!streamSetting || !res.body || !isSSEResponse(res))) {
    const errData = await safeJson(res);
    await reportError(extractErrorFromResponse(errData, res.statusText));
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
      const providerName = PROVIDER_DISPLAY_NAMES[settings.aiProvider] || settings.aiProvider;
      if (firstContentReceived) {
        // Content had started, so surface it as a stalled stream rather than "API is down"
        await reportError(`The ${providerName} API stopped responding part-way through the reply.\n\nNo new content arrived for ${settings.apiFailureTimeout * STREAM_TIMEOUT_MULTIPLIER} seconds, so the request was cancelled. You can adjust this timeout in Settings.`);
      } else {
        await reportError(`OwnChatBot is working, but the ${providerName} API is down.\n\nNo response was received within ${settings.apiFailureTimeout} seconds. You can adjust this timeout in Settings.`);
      }
    };
    armStallTimer(firstContentMs);

    try {
      streamedContent = await readSSEStream(res.body, (accumulated) => {
        firstContentReceived = true;
        armStallTimer(idleMs);
        onStreamChunk(accumulated);
      }, onThinking);
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
          await reportError(sanitizeErrorMessage(extractUsefulError(err?.message || 'Streaming error')));
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
      await reportError('Failed to get response from AI');
    }
  }

  return result({ streamedContent, wasAborted });
}
