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

async function verifyJwtHs256(token: string, secret: string): Promise<{ valid: boolean; payload?: any }>{
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  try {
    const enc = new TextEncoder();
    const keyData = enc.encode(secret);
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const data = enc.encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlToUint8Array(sigB64);
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

// JWT secret resolved dynamically; middleware runs in node runtime (see config)

// Paths that do not require auth (exact or prefix handling below)
const PUBLIC_PREFIXES = ['/api/auth/', '/_next/', '/favicon', '/api/health', '/api/internal/password-version'];
const PUBLIC_EXACT = ['/', '/login', '/setup'];

// Simple in-process cache to avoid hitting API repeatedly per navigation
let cachedVersion: { value: number; ts: number } | null = null;
async function getPasswordVersionCached(): Promise<number> {
  const now = Date.now();
  if (cachedVersion && now - cachedVersion.ts < 30_000) {
    return cachedVersion.value;
  }
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/internal/password-version`);
    if (!res.ok) return 1;
    const data = await res.json();
    const v = data.version || 1;
    cachedVersion = { value: v, ts: now };
    return v;
  } catch {
    // Offline-tolerant: if we have a cached value, keep using it even if stale; else default to 1
    if (cachedVersion) return cachedVersion.value;
    return 1;
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
    if (typeof decoded.v === 'number' && decoded.v !== currentVersion) {
      console.warn('[middleware] Password version mismatch. token v', decoded.v, 'current', currentVersion, 'path', pathname);
      // Redirect to login but don’t aggressively clear cookie to avoid PWA disruption
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = '/login';
      return NextResponse.redirect(loginUrl);
    }
    if (Math.random() < 0.02) {
      console.log('[middleware] Auth OK for path', pathname, 'v', decoded.v);
    }
  const ok = NextResponse.next();
  attachSecurityHeaders(ok, req);
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
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
