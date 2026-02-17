import { NextResponse, NextRequest } from 'next/server';

// JWT secret is injected at container start (auto-generated if absent) and must be present here.
// We intentionally DO NOT provide a hard-coded fallback to avoid accidental insecure deployments.
const RUNTIME_JWT_SECRET = process.env.JWT_SECRET;

// Convert a base64url string to ArrayBuffer
function b64urlToUint8Array(b64url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url.replace(/-/g, '+').replace(/_/g, '/')) + pad;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToB64url(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  const b64 = btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b64;
}

// Token lifetime constants (seconds)
const TOKEN_LIFETIME = 14 * 24 * 60 * 60; // 14 days
const TOKEN_RENEWAL_THRESHOLD = 7 * 24 * 60 * 60; // renew when >7 days old (halfway)

async function verifyJwtHs256(token: string, secret: string): Promise<{ valid: boolean; payload?: any }>{
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const enc = new TextEncoder();
    const keyData = enc.encode(secret);
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const data = enc.encode(`${headerB64}.${payloadB64}`);
    const computed = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
    const computedB64 = uint8ArrayToB64url(computed);
    if (computedB64 !== sigB64) return { valid: false };
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    // Basic exp check if present
    if (payload.exp && Date.now() / 1000 > payload.exp) return { valid: false };
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

// Edge-compatible JWT HS256 signing (used for sliding token renewal)
async function signJwtHs256(payload: Record<string, any>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: nowSec, exp: nowSec + TOKEN_LIFETIME };
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadB64 = btoa(JSON.stringify(fullPayload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${headerB64}.${payloadB64}`)));
  const sigB64 = uint8ArrayToB64url(sig);
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

// JWT secret resolved dynamically; middleware runs in node runtime (see config)

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
    const decoded = result.payload as { v?: number };
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

// Security headers (Item 9 implementation)
function attachSecurityHeaders(res: NextResponse, req: NextRequest) {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
  "connect-src 'self' https://api.deepseek.com https://api.openai.com https://openrouter.ai https://api.anthropic.com",
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
