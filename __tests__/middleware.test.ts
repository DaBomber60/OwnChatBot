/**
 * @jest-environment node
 *
 * Tests for proxy.ts — auth gating, security headers, token renewal.
 *
 * Strategy: mock jwtCrypto and the internal password-version fetch, then exercise
 * the proxy function with synthetic NextRequest objects.
 */

// JWT_SECRET must be in env BEFORE module is loaded (top-level const in proxy.ts)
process.env.JWT_SECRET = 'test-secret';
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000';

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — declared before module-under-test is imported
// ---------------------------------------------------------------------------
const mockVerify = jest.fn();
const mockSign = jest.fn().mockResolvedValue('fresh-token');

jest.mock('../lib/jwtCrypto', () => ({
  verifyJwtHs256: (...args: any[]) => mockVerify(...args),
  signJwtHs256: (...args: any[]) => mockSign(...args),
  TOKEN_LIFETIME: 86400,
  TOKEN_RENEWAL_THRESHOLD: 43200,   // 12 hours
}));

// Intercept fetch for password-version internal endpoint
const originalFetch = global.fetch;

afterAll(() => {
  global.fetch = originalFetch;
});

import { proxy } from '../proxy';

// ---------------------------------------------------------------------------
// Helper: build a NextRequest
// ---------------------------------------------------------------------------
function buildReq(pathname: string, opts: { cookie?: string; method?: string; headers?: Record<string, string> } = {}): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  const headers = new Headers(opts.headers || {});
  if (opts.cookie) headers.set('cookie', opts.cookie);
  return new NextRequest(new Request(url, { method: opts.method || 'GET', headers }));
}

function stubPasswordVersion(version: number, ok = true) {
  global.fetch = jest.fn(async (input: any) => {
    const urlStr = typeof input === 'string' ? input : (input as Request).url;
    if (urlStr.includes('/api/internal/password-version')) {
      if (!ok) return new Response('fail', { status: 500 });
      return new Response(JSON.stringify({ version }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input);
  }) as any;
}

// Suppress console noise
beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockVerify.mockClear();
  mockSign.mockClear();
  stubPasswordVersion(1);
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Public paths
// ---------------------------------------------------------------------------
describe('proxy — public paths', () => {
  it.each([
    '/',
    '/login',
    '/setup',
    '/api/auth/login',
    '/api/auth/verify',
    '/_next/static/chunk.js',
    '/favicon.ico',
    '/api/health',
    '/api/internal/password-version',
  ])('allows %s without a cookie (no 401)', async (path) => {
    const res = await proxy(buildReq(path));
    expect(res.status).not.toBe(401);
    // Should set security headers
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

// ---------------------------------------------------------------------------
// Protected paths — no cookie
// ---------------------------------------------------------------------------
describe('proxy — protected paths without cookie', () => {
  it('returns 401 JSON for API routes', async () => {
    const res = await proxy(buildReq('/api/sessions'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('redirects browser pages to /login', async () => {
    const res = await proxy(buildReq('/settings'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});

// ---------------------------------------------------------------------------
// Valid auth cookie
// ---------------------------------------------------------------------------
describe('proxy — valid auth cookie', () => {
  it('allows request when JWT is valid and version matches', async () => {
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 1, iat: Math.floor(Date.now() / 1000) - 100 } });
    stubPasswordVersion(1);
    const res = await proxy(buildReq('/api/sessions', { cookie: 'hcb_auth=valid' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('redirects to login when password version mismatches', async () => {
    // Token v=999 will never match the cached password version (1)
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 999, iat: Math.floor(Date.now() / 1000) - 100 } });
    const res = await proxy(buildReq('/chat/1', { cookie: 'hcb_auth=valid' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});

// ---------------------------------------------------------------------------
// Invalid / expired token
// ---------------------------------------------------------------------------
describe('proxy — invalid token', () => {
  it('returns 401 for API route when JWT is invalid', async () => {
    mockVerify.mockResolvedValue({ valid: false });
    const res = await proxy(buildReq('/api/sessions', { cookie: 'hcb_auth=invalid' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it('redirects page request to /login when token is invalid', async () => {
    mockVerify.mockRejectedValue(new Error('JWT expired'));
    const res = await proxy(buildReq('/settings', { cookie: 'hcb_auth=expired' }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});

// ---------------------------------------------------------------------------
// Token renewal
// ---------------------------------------------------------------------------
describe('proxy — token renewal', () => {
  it('mints a fresh token when token age exceeds threshold', async () => {
    const oldIat = Math.floor(Date.now() / 1000) - 50000; // well past 43200s threshold
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 1, iat: oldIat } });
    stubPasswordVersion(1);
    const res = await proxy(buildReq('/api/sessions', { cookie: 'hcb_auth=old-token' }));
    expect(res.status).toBe(200);
    expect(mockSign).toHaveBeenCalled();
    // Should set a new cookie
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toContain('hcb_auth');
  });

  it('does not renew token when age is below threshold', async () => {
    const recentIat = Math.floor(Date.now() / 1000) - 100; // 100s old, well below 43200
    mockVerify.mockResolvedValue({ valid: true, payload: { v: 1, iat: recentIat } });
    stubPasswordVersion(1);
    const res = await proxy(buildReq('/api/sessions', { cookie: 'hcb_auth=recent' }));
    expect(res.status).toBe(200);
    expect(mockSign).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
describe('proxy — security headers', () => {
  it('sets all expected security headers on public paths', async () => {
    const res = await proxy(buildReq('/'));
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    expect(res.headers.get('Permissions-Policy')).toBeTruthy();
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-XSS-Protection')).toBe('0');
  });

  it('CSP includes frame-ancestors none', async () => {
    const res = await proxy(buildReq('/'));
    const csp = res.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('CSP includes connect-src with AI providers', async () => {
    const res = await proxy(buildReq('/'));
    const csp = res.headers.get('Content-Security-Policy') || '';
    expect(csp).toContain('connect-src');
    expect(csp).toContain('api.openai.com');
  });

  it('sets Cache-Control on 401 responses', async () => {
    const res = await proxy(buildReq('/api/sessions'));
    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

// ---------------------------------------------------------------------------
// /api/import/receive — bearer token pass-through
// ---------------------------------------------------------------------------
describe('proxy — import receive endpoint', () => {
  it('allows request with valid Bearer token', async () => {
    const token = 'A'.repeat(25); // 25 chars, meets >=20 requirement
    const res = await proxy(buildReq('/api/import/receive', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }));
    // Should pass through (not 401)
    expect(res.status).not.toBe(401);
  });

  it('allows OPTIONS preflight without auth', async () => {
    const res = await proxy(buildReq('/api/import/receive', { method: 'OPTIONS' }));
    expect(res.status).not.toBe(401);
  });

  it('rejects request with no auth at all', async () => {
    // No cookie, no authorization header
    const res = await proxy(buildReq('/api/import/receive', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});
