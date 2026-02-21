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
};
