// Centralized upstream AI provider fetch helper.
// Handles: headers, URL fallback, inactivity timeouts, non-OK error extraction, non-JSON safety.
import { DEFAULT_FALLBACK_URL, failureTimeoutMs, UPSTREAM_TIMEOUT_GRACE_MS, type AIConfig } from './aiProvider';

export interface UpstreamRequestOpts {
  url: string;
  apiKey: string;
  body: Record<string, any>;
  /** Optional AbortSignal for caller-managed timeouts. Takes precedence over `timeoutMs`. */
  signal?: AbortSignal;
  /** Abort the request if it hasn't completed within this many milliseconds. */
  timeoutMs?: number;
}

export interface UpstreamResponse {
  ok: boolean;
  status: number;
  /** Parsed JSON body (if response was JSON). */
  data?: any;
  /** Raw response text (if response was not JSON or on error). */
  rawText?: string;
  /** The underlying fetch Response (for streaming callers that need the body stream). */
  raw: Response;
}

/**
 * Call an upstream AI provider with standard headers and error handling.
 * - Uses `DEFAULT_FALLBACK_URL` if `url` is empty.
 * - Always sends `Content-Type: application/json` and `Authorization: Bearer <key>`.
 * - Safely reads response text and attempts JSON parse (never throws on non-JSON).
 */
export async function callUpstreamAI(opts: UpstreamRequestOpts): Promise<UpstreamResponse> {
  const targetUrl = opts.url || DEFAULT_FALLBACK_URL;
  const signal = opts.signal ?? (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined);

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(opts.body),
    ...(signal ? { signal } : {}),
  });

  // For streaming responses, return immediately — caller handles the body stream.
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream') || opts.body.stream === true) {
    return { ok: response.ok, status: response.status, raw: response };
  }

  // Non-streaming: read full body text safely
  const rawText = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    // Response wasn't JSON (e.g., HTML error page)
    data = undefined;
  }

  return { ok: response.ok, status: response.status, data, rawText, raw: response };
}

// ---------------------------------------------------------------------------
// Timeout-aware requests (streaming and non-streaming generation endpoints)
// ---------------------------------------------------------------------------

/**
 * Inactivity timeout for a server-side upstream call, derived from the user's
 * `apiFailureTimeout` setting. Streaming gets the doubled window plus a grace
 * period so the browser's own stall timer reports the failure first.
 * `STREAM_TIMEOUT_MS` overrides the derived value entirely.
 */
export function upstreamTimeoutMs(cfg: AIConfig, streaming: boolean): number {
  const override = parseInt(process.env.STREAM_TIMEOUT_MS || '', 10);
  if (!isNaN(override)) return override;
  return failureTimeoutMs(cfg.apiFailureTimeout, streaming) + (streaming ? UPSTREAM_TIMEOUT_GRACE_MS : 0);
}

export interface UpstreamRequestHandle {
  response: Response;
  /** The inactivity window in effect for this request. */
  timeoutMs: number;
  /** True once our own inactivity timer aborted the request. */
  readonly timedOut: boolean;
  /** Re-arm the inactivity timer. Call whenever data arrives. */
  keepAlive: () => void;
  /** Stop the inactivity timer without aborting the request. */
  stopTimer: () => void;
  /** Stop the timer and abort the upstream request, closing the connection. */
  dispose: (reason?: string) => void;
}

/**
 * Start an upstream request guarded by an inactivity timeout.
 *
 * The timer starts before the fetch and must be re-armed by the caller via
 * `keepAlive()` as data arrives; otherwise the request is aborted and the
 * connection closed so the provider can't deliver a late response.
 */
export async function startUpstreamRequest(
  cfg: AIConfig,
  opts: { body: Record<string, unknown>; streaming: boolean; logLabel?: string },
): Promise<UpstreamRequestHandle> {
  const logLabel = opts.logLabel || '[Upstream]';
  const timeoutMs = upstreamTimeoutMs(cfg, opts.streaming);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  let timedOut = false;

  const stopTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const keepAlive = () => {
    stopTimer();
    timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      console.log(`${logLabel} Aborting upstream fetch after ${timeoutMs}ms without activity`);
      controller.abort();
    }, timeoutMs);
  };
  const dispose = (reason?: string) => {
    stopTimer();
    if (!controller.signal.aborted) {
      if (reason) console.log(`${logLabel} Aborting upstream fetch: ${reason}`);
      controller.abort();
    }
  };

  keepAlive();
  let response: Response;
  try {
    response = await fetch(cfg.url || DEFAULT_FALLBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    stopTimer();
    throw err;
  }

  return {
    response,
    timeoutMs,
    get timedOut() { return timedOut; },
    keepAlive,
    stopTimer,
    dispose,
  };
}
