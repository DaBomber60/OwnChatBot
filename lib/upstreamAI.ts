// Centralized upstream AI provider fetch helper.
// Handles: headers, URL fallback, non-OK error extraction, non-JSON safety.
import { DEFAULT_FALLBACK_URL } from './aiProvider';

export interface UpstreamRequestOpts {
  url: string;
  apiKey: string;
  body: Record<string, any>;
  /** Optional AbortSignal for caller-managed timeouts. */
  signal?: AbortSignal;
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

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(opts.body),
    ...(opts.signal ? { signal: opts.signal } : {}),
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
