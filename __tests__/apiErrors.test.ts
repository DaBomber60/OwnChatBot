import {
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
  classifyUpstreamStatus,
} from '../lib/apiErrors';

/** Create a minimal mock NextApiResponse for testing */
function mockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    _status: 0,
    _body: null,
    _headers: headers,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: any) {
      res._body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Individual error helpers
// ---------------------------------------------------------------------------
describe('apiErrors', () => {
  describe('badRequest', () => {
    it('sends 400 with default message', () => {
      const res = mockRes();
      badRequest(res);
      expect(res._status).toBe(400);
      expect(res._body).toEqual({ error: 'Bad Request', code: 'BAD_REQUEST' });
    });

    it('sends custom error and code', () => {
      const res = mockRes();
      badRequest(res, 'Missing field', 'MISSING_FIELD');
      expect(res._body.error).toBe('Missing field');
      expect(res._body.code).toBe('MISSING_FIELD');
    });

    it('includes extra fields when provided', () => {
      const res = mockRes();
      badRequest(res, 'err', 'C', { hint: 'check docs' });
      expect(res._body.hint).toBe('check docs');
    });
  });

  describe('unauthorized', () => {
    it('sends 401 with defaults', () => {
      const res = mockRes();
      unauthorized(res);
      expect(res._status).toBe(401);
      expect(res._body).toEqual({ error: 'Unauthorized', code: 'UNAUTHENTICATED' });
    });
  });

  describe('forbidden', () => {
    it('sends 403', () => {
      const res = mockRes();
      forbidden(res);
      expect(res._status).toBe(403);
      expect(res._body.code).toBe('FORBIDDEN');
    });
  });

  describe('notFound', () => {
    it('sends 404', () => {
      const res = mockRes();
      notFound(res);
      expect(res._status).toBe(404);
      expect(res._body.code).toBe('NOT_FOUND');
    });

    it('includes custom message', () => {
      const res = mockRes();
      notFound(res, 'Session not found', 'SESSION_NOT_FOUND');
      expect(res._body.error).toBe('Session not found');
      expect(res._body.code).toBe('SESSION_NOT_FOUND');
    });
  });

  describe('conflict', () => {
    it('sends 409', () => {
      const res = mockRes();
      conflict(res);
      expect(res._status).toBe(409);
      expect(res._body.code).toBe('CONFLICT');
    });
  });

  describe('tooManyRequests', () => {
    it('sends 429', () => {
      const res = mockRes();
      tooManyRequests(res);
      expect(res._status).toBe(429);
      expect(res._body.code).toBe('RATE_LIMITED');
    });

    it('sets Retry-After header when retryAfterSeconds given', () => {
      const res = mockRes();
      tooManyRequests(res, 'slow down', 'RL', 30.2);
      expect(res._headers['Retry-After']).toBe('31'); // ceil(30.2)
    });

    it('does not set Retry-After when retryAfterSeconds omitted', () => {
      const res = mockRes();
      tooManyRequests(res);
      expect(res._headers['Retry-After']).toBeUndefined();
    });
  });

  describe('serverError', () => {
    it('sends 500 with defaults', () => {
      const res = mockRes();
      serverError(res);
      expect(res._status).toBe(500);
      expect(res._body.code).toBe('INTERNAL_ERROR');
    });

    it('includes details when provided', () => {
      const res = mockRes();
      serverError(res, 'DB crashed', 'DB_ERROR', { query: 'SELECT 1' });
      expect(res._body.details).toEqual({ query: 'SELECT 1' });
    });
  });

  describe('methodNotAllowed', () => {
    it('sends 405 with method name in message', () => {
      const res = mockRes();
      methodNotAllowed(res, 'DELETE');
      expect(res._status).toBe(405);
      expect(res._body.error).toContain('DELETE');
      expect(res._body.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('handles missing method', () => {
      const res = mockRes();
      methodNotAllowed(res);
      expect(res._status).toBe(405);
      expect(res._body.error).toContain('Not Allowed');
    });
  });

  describe('validationError', () => {
    it('sends 422 with issues', () => {
      const res = mockRes();
      const issues = [{ path: ['name'], message: 'Required' }];
      validationError(res, 'Validation failed', issues);
      expect(res._status).toBe(422);
      expect(res._body.issues).toEqual(issues);
    });

    it('omits issues when not provided', () => {
      const res = mockRes();
      validationError(res);
      expect(res._status).toBe(422);
      expect(res._body.issues).toBeUndefined();
    });
  });

  describe('failedDependency', () => {
    it('sends 424', () => {
      const res = mockRes();
      failedDependency(res);
      expect(res._status).toBe(424);
      expect(res._body.code).toBe('FAILED_DEPENDENCY');
    });
  });

  describe('payloadTooLarge', () => {
    it('sends 413', () => {
      const res = mockRes();
      payloadTooLarge(res);
      expect(res._status).toBe(413);
      expect(res._body.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('apiKeyNotConfigured', () => {
    it('sends 401 with specific message', () => {
      const res = mockRes();
      apiKeyNotConfigured(res);
      expect(res._status).toBe(401);
      expect(res._body.error).toContain('API key not configured');
      expect(res._body.code).toBe('API_KEY_NOT_CONFIGURED');
    });
  });

  describe('upstreamError', () => {
    it('sends the flat envelope every LLM route shares', () => {
      const res = mockRes();
      upstreamError(res, { code: 'UPSTREAM_AUTH', message: 'Invalid key', upstreamStatus: 401 });
      expect(res._status).toBe(502);
      expect(res._body).toEqual({ error: 'Invalid key', code: 'UPSTREAM_AUTH', upstreamStatus: 401 });
    });

    it('keeps `error` a string and `code` top-level, never nested', () => {
      const res = mockRes();
      upstreamError(res, { code: 'UPSTREAM_UNAVAILABLE', message: 'boom', upstreamStatus: 503 });
      expect(typeof res._body.error).toBe('string');
      expect(res._body.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(res._body.upstream).toBeUndefined();
    });

    it('sets Retry-After as both header and body field', () => {
      const res = mockRes();
      upstreamError(res, { code: 'UPSTREAM_RATE_LIMITED', message: 'slow down', retryAfterSeconds: 12.4 });
      expect(res._headers['Retry-After']).toBe('13');
      expect(res._body.retryAfter).toBe(13);
    });

    it('merges route-specific extras alongside the envelope', () => {
      const res = mockRes();
      upstreamError(res, {
        code: 'UPSTREAM_TIMEOUT',
        message: 'timed out',
        status: 504,
        extra: { ok: false, latencyMs: 900, provider: 'deepseek' },
      });
      expect(res._status).toBe(504);
      expect(res._body).toMatchObject({ error: 'timed out', code: 'UPSTREAM_TIMEOUT', ok: false, provider: 'deepseek' });
    });

    it('omits optional fields when absent', () => {
      const res = mockRes();
      upstreamError(res, { code: 'UPSTREAM_NO_CONTENT', message: 'nothing' });
      expect(res._body).toEqual({ error: 'nothing', code: 'UPSTREAM_NO_CONTENT' });
    });
  });

  describe('classifyUpstreamStatus', () => {
    it.each([
      [401, '', 'UPSTREAM_AUTH'],
      [403, '', 'UPSTREAM_AUTH'],
      [402, '', 'UPSTREAM_QUOTA'],
      [429, 'Too many requests', 'UPSTREAM_RATE_LIMITED'],
      [429, 'You exceeded your current quota', 'UPSTREAM_QUOTA'],
      [500, '', 'UPSTREAM_UNAVAILABLE'],
      [503, '', 'UPSTREAM_UNAVAILABLE'],
      [400, 'Insufficient Balance', 'UPSTREAM_QUOTA'],
      [400, 'This model maximum context length is 8192 tokens', 'UPSTREAM_CONTEXT_TOO_LONG'],
      [400, 'unsupported parameter', 'UPSTREAM_BAD_REQUEST'],
    ])('maps %i (%s) to %s', (status, message, expected) => {
      expect(classifyUpstreamStatus(status as number, message as string)).toBe(expected);
    });
  });
});
