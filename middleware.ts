import { NextResponse, NextRequest } from 'next/server';
import { verifyJwtHs256, signJwtHs256, TOKEN_LIFETIME, TOKEN_RENEWAL_THRESHOLD } from './lib/jwtCrypto';

// JWT secret is injected at container start (auto-generated if absent) and must be present here.
// We intentionally DO NOT provide a hard-coded fallback to avoid accidental insecure deployments.
const RUNTIME_JWT_SECRET = process.env.JWT_SECRET;

// Paths that do not require auth (exact or prefix handling below)
const PUBLIC_PREFIXES = ['/api/auth/', '/_next/', '/favicon', '/api/health', '/api/internal/password-version'];
const PUBLIC_EXACT = ['/', '/login', '/setup'];

// In-process cache for password version. Uses a longer TTL and graceful degradation:
// - On success: cache for 60s (reduced fetch frequency)
// - On failure with stale cache: use stale value (no logout)
// - On failure with NO cache: return null to signal "skip version check" rather than
//   defaulting to 1 which would cause a mismatch and force logout
let cachedVersion: { value: number; ts: number } | null = null;
async function getPasswordVersionCached(): Promise<number | null> {
  const now = Date.now();
  if (cachedVersion && now - cachedVersion.ts < 60_000) {
    return cachedVersion.value;
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/internal/password-version`);
    if (!res.ok) {
      // Non-OK response: use stale cache if available, otherwise skip check
      return cachedVersion ? cachedVersion.value : null;
    }
    const data = await res.json();
    const v = data.version || 1;
    cachedVersion = { value: v, ts: now };
    return v;
  } catch {
    // Network/server error: use stale cache if available, otherwise skip check
    // This prevents logouts during server restarts or transient network issues
    if (cachedVersion) return cachedVersion.value;
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public assets & prefixes
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p)) || PUBLIC_EXACT.includes(pathname)) {
    const res = NextResponse.next();
    attachSecurityHeaders(res, req);
    return res;
  }

  // Allow unauth pages for initial setup
  if (pathname === '/api/auth/setup') return NextResponse.next();

  const cookie = req.cookies.get('hcb_auth');
  if (!cookie) {
    // Special allowance: /api/import/receive
    if (pathname === '/api/import/receive') {
      // Always allow OPTIONS preflight so CORS can succeed
      if (req.method === 'OPTIONS') {
        const res = NextResponse.next();
        attachSecurityHeaders(res, req);
        return res;
      }
      const authz = req.headers.get('authorization') || '';
      const apiKey = req.headers.get('x-api-key') || '';
      // Accept forms:
      // 1. Authorization: Bearer <token>
      // 2. Authorization: <token>
      // 3. X-API-Key: <token>
  const bearerMatch = authz.match(/^Bearer\s+([A-Za-z0-9_-]{20,})$/i) as RegExpMatchArray | null;
  const rawAuthMatch = !bearerMatch ? (authz.match(/^([A-Za-z0-9_-]{20,})$/) as RegExpMatchArray | null) : null;
  const token = (bearerMatch && bearerMatch[1]) || (rawAuthMatch && rawAuthMatch[1]) || (apiKey.length >= 20 ? apiKey : null);
      if (token) {
        const res = NextResponse.next();
        attachSecurityHeaders(res, req);
        return res;
      }
    }
    console.warn('[middleware] No auth cookie for path', pathname, 'method', req.method);
    if (pathname.startsWith('/api')) {
      const unauth = new NextResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      attachSecurityHeaders(unauth, req);
      return unauth;
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    const redirectRes = NextResponse.redirect(loginUrl);
    attachSecurityHeaders(redirectRes, req);
    return redirectRes;
  }

  if (!RUNTIME_JWT_SECRET) {
    console.error('[middleware] JWT_SECRET not set at runtime. Rejecting request.');
    if (pathname.startsWith('/api')) {
      return new NextResponse(JSON.stringify({ error: 'Server misconfiguration: JWT secret missing' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }
  const JWT_SECRET = RUNTIME_JWT_SECRET;

  try {
    const result = await verifyJwtHs256(cookie.value, JWT_SECRET);
    if (!result.valid) throw new Error('INVALID');
    const decoded = result.payload as { v?: number; iat?: number; exp?: number };
    const currentVersion = await getPasswordVersionCached();
    // Only enforce version mismatch when we have a definitive current version.
    // If currentVersion is null (fetch failed, no cache), skip the check —
    // the API-layer requireAuth() will do its own definitive DB check.
    if (currentVersion !== null && typeof decoded.v === 'number' && decoded.v !== currentVersion) {
      console.warn('[middleware] Password version mismatch. token v', decoded.v, 'current', currentVersion, 'path', pathname);
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }
    if (Math.random() < 0.02) {
      console.log('[middleware] Auth OK for path', pathname, 'v', decoded.v);
    }
  const ok = NextResponse.next();
  attachSecurityHeaders(ok, req);

    // Sliding token renewal: if token is past the halfway point of its lifetime,
    // mint a fresh token so active users never get hard-logged out.
    const tokenAge = decoded.iat ? (Date.now() / 1000 - decoded.iat) : 0;
    if (tokenAge > TOKEN_RENEWAL_THRESHOLD) {
      try {
        const freshToken = await signJwtHs256(
          { authenticated: true, v: decoded.v },
          JWT_SECRET
        );
        ok.cookies.set('hcb_auth', freshToken, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          maxAge: TOKEN_LIFETIME,
          secure: process.env.NODE_ENV === 'production',
        });
        if (Math.random() < 0.05) {
          console.log('[middleware] Renewed token for path', pathname, '(age', Math.round(tokenAge / 3600), 'h)');
        }
      } catch (renewErr) {
        // Non-fatal: if renewal fails, the user keeps their existing token
        console.warn('[middleware] Token renewal failed:', renewErr);
      }
    }

  return ok;
  } catch (err: any) {
    console.warn('[middleware] JWT verify failed for path', pathname, err?.name, err?.message);
    if (pathname.startsWith('/api')) {
      const invalid = new NextResponse(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      attachSecurityHeaders(invalid, req);
      return invalid;
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set('hcb_auth', '', { path: '/', maxAge: 0 });
    attachSecurityHeaders(res, req);
    return res;
  }
}

// Extract origin (scheme + host) from a URL string; returns empty string on failure.
function originOf(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return '';
  }
}

// Security headers (Item 9 implementation)
function attachSecurityHeaders(res: NextResponse, req: NextRequest) {
  // Build connect-src: known providers + optional custom AI_BASE_URL from env
  const knownProviders = 'https://api.deepseek.com https://api.openai.com https://openrouter.ai https://api.anthropic.com';
  const extraOrigin = originOf(process.env.AI_BASE_URL || '');
  const connectSrc = `connect-src 'self' ${knownProviders}${extraOrigin ? ' ' + extraOrigin : ''}`;

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // HSTS (only set when on HTTPS)
  if (req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-XSS-Protection', '0'); // modern browsers deprecated header
  // Prevent browsers, proxies, and SW from caching auth-sensitive responses (redirects, 401s).
  // Only applied to non-2xx or redirect responses; 2xx pages use browser defaults.
  const status = res.status;
  if (status >= 300 || status === 401 || status === 403) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
