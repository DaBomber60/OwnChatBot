import type { NextApiResponse } from 'next';

interface ErrorPayload {
  error: string;
  code: string;
  details?: any;
}

function send(res: NextApiResponse, status: number, code: string, error: string, extra?: Record<string, any>) {
  return res.status(status).json({ error, code, ...(extra || {}) });
}

export function badRequest(res: NextApiResponse, error = 'Bad Request', code = 'BAD_REQUEST', extra?: Record<string, any>) {
  return send(res, 400, code, error, extra);
}

export function unauthorized(res: NextApiResponse, error = 'Unauthorized', code = 'UNAUTHENTICATED') {
  return send(res, 401, code, error);
}

export function forbidden(res: NextApiResponse, message = 'Forbidden', code = 'FORBIDDEN') {
  return send(res, 403, code, message);
}

export function notFound(res: NextApiResponse, message = 'Not Found', code = 'NOT_FOUND') {
  return send(res, 404, code, message);
}

export function conflict(res: NextApiResponse, message = 'Conflict', code = 'CONFLICT') {
  return send(res, 409, code, message);
}

export function tooManyRequests(res: NextApiResponse, message = 'Too Many Requests', code = 'RATE_LIMITED', retryAfterSeconds?: number) {
  if (retryAfterSeconds) {
    res.setHeader('Retry-After', String(Math.max(0, Math.ceil(retryAfterSeconds))));
  }
  return send(res, 429, code, message);
}

export function serverError(res: NextApiResponse, message = 'Internal Server Error', code = 'INTERNAL_ERROR', details?: any) {
  return send(res, 500, code, message, details ? { details } : undefined);
}

export function methodNotAllowed(res: NextApiResponse, method?: string) {
  return send(res, 405, 'METHOD_NOT_ALLOWED', `Method ${method || ''} Not Allowed`);
}

export function validationError(res: NextApiResponse, message = 'Validation failed', issues?: any) {
  return send(res, 422, 'VALIDATION_ERROR', message, issues ? { issues } : undefined);
}

export function failedDependency(res: NextApiResponse, message = 'Upstream dependency failed') {
  return send(res, 424, 'FAILED_DEPENDENCY', message);
}

export function payloadTooLarge(res: NextApiResponse, message = 'Payload Too Large', code = 'PAYLOAD_TOO_LARGE') {
  return send(res, 413, code, message);
}

export function gone(res: NextApiResponse, message = 'Gone', code = 'GONE', extra?: Record<string, any>) {
  return send(res, 410, code, message, extra);
}

// Convenience helpers
export function apiKeyNotConfigured(res: NextApiResponse) {
  return unauthorized(res, 'API key not configured in settings', 'API_KEY_NOT_CONFIGURED');
}

/**
 * Codes describing an upstream AI provider failure. The client switches on these to pick
 * its wording, so treat them as a wire contract — don't rename one without updating
 * `describeServerError` in lib/chat/errorCopy.ts.
 */
export type UpstreamErrorCode =
  | 'UPSTREAM_AUTH'
  | 'UPSTREAM_QUOTA'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_CONTEXT_TOO_LONG'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_BAD_REQUEST'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_ABORTED'
  | 'UPSTREAM_MAX_TOKENS'
  | 'UPSTREAM_THINKING_ONLY'
  | 'UPSTREAM_NO_CONTENT'
  | 'UPSTREAM_UNPARSEABLE'
  | 'UPSTREAM_API_ERROR';

export interface UpstreamErrorOptions {
  code: UpstreamErrorCode;
  message: string;
  /** Status the provider gave us, preserved for debugging. Not our own response status. */
  upstreamStatus?: number;
  /** Status to send the client. Defaults to 502 — the failure is upstream, not the caller's. */
  status?: number;
  retryAfterSeconds?: number;
  /** Route-specific fields merged into the response alongside the envelope. */
  extra?: Record<string, any>;
}

/**
 * The single response shape for every upstream AI failure:
 * `{ error, code, upstreamStatus?, retryAfter? }` — flat, matching the rest of this module.
 */
export function upstreamError(res: NextApiResponse, opts: UpstreamErrorOptions) {
  const { code, message, upstreamStatus, status = 502, retryAfterSeconds, extra } = opts;
  if (retryAfterSeconds) {
    res.setHeader('Retry-After', String(Math.max(0, Math.ceil(retryAfterSeconds))));
  }
  return send(res, status, code, message, {
    ...(upstreamStatus ? { upstreamStatus } : {}),
    ...(retryAfterSeconds ? { retryAfter: Math.max(0, Math.ceil(retryAfterSeconds)) } : {}),
    ...(extra || {}),
  });
}

/** Maps a provider HTTP status (plus its message) onto a semantic code. */
export function classifyUpstreamStatus(status: number, message = ''): UpstreamErrorCode {
  if (status === 401 || status === 403) return 'UPSTREAM_AUTH';
  if (status === 402) return 'UPSTREAM_QUOTA';
  if (status === 429) {
    // Providers reuse 429 for "out of credit" as well as genuine throttling.
    return /quota|billing|credit|balance/i.test(message) ? 'UPSTREAM_QUOTA' : 'UPSTREAM_RATE_LIMITED';
  }
  if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
  if (status >= 400) {
    if (/context length|context_length|too many tokens|maximum context|reduce the length/i.test(message)) {
      return 'UPSTREAM_CONTEXT_TOO_LONG';
    }
    if (/insufficient balance|insufficient_quota|quota/i.test(message)) return 'UPSTREAM_QUOTA';
    return 'UPSTREAM_BAD_REQUEST';
  }
  return 'UPSTREAM_API_ERROR';
}

// Generic responder factory if we want to unify later
export const apiError = {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  serverError,
  methodNotAllowed,
  validationError,
  failedDependency,
  payloadTooLarge,
  apiKeyNotConfigured,
  upstreamError,
};
