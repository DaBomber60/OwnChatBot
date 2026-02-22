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
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let done = false;

  try {
    while (!done) {
      const { value, done: doneReading } = await reader.read();
      if (doneReading) { done = true; break; }

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split(/\r?\n/).filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const payload = line.replace(/^data: /, '').trim();
        if (payload === '[DONE]') { done = true; break; }

        try {
          const parsed = JSON.parse(payload);
          const content: string = parsed.content || '';
          if (content) {
            accumulated += content;
            onContent(accumulated, content);
          }
        } catch {
          // Skip malformed JSON frames
        }
      }
    }
  } finally {
    // Ensure reader is released even if caller catches AbortError upstream
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

  // --- Error handling ---
  /** Called when an error should be shown to the user. */
  onError: (message: string) => void;
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
    skipSettingsInBody,
  } = opts;

  // 1. Fetch settings (or use provided)
  const settings = opts.chatSettings ?? await fetchChatSettings();
  const { stream: streamSetting } = settings;

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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    ...(streamSetting && abortController ? { signal: abortController.signal } : {}),
  });

  // 5. Non-OK + non-SSE → immediate error
  if (!res.ok && (!streamSetting || !res.body || !isSSEResponse(res))) {
    const errData = await safeJson(res);
    onError(extractErrorFromResponse(errData, res.statusText));
    return { settings, streamedContent: '', wasStreaming: streamSetting, wasAborted: false };
  }

  let streamedContent = '';
  let wasAborted = false;

  // 6. SSE streaming path
  if (streamSetting && res.body && isSSEResponse(res)) {
    try {
      streamedContent = await readSSEStream(res.body, (accumulated) => {
        onStreamChunk(accumulated);
      });
      if (onComplete) await onComplete();
    } catch (err: any) {
      if (err.name === 'AbortError') {
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
          onError(sanitizeErrorMessage(extractUsefulError(err?.message || 'Streaming error')));
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
      onError('Failed to get response from AI');
    }
  }

  return { settings, streamedContent, wasStreaming: streamSetting, wasAborted };
}
