// Simple in-memory token bucket / fixed-window hybrid limiter.
// NOTE: Single-process only; replace with Redis or durable store for multi-instance deployments.
export interface RateLimitOptions {
  windowMs: number;           // window size in ms
  max: number;                // max hits per window
  blockDurationMs?: number;   // optional block time after exceeding max
  keyPrefix?: string;         // logical group
}

interface RecordEntry { count: number; first: number; blockedUntil?: number }

const stores: Map<string, RecordEntry> = new Map();

export interface RateLimitResult { allowed: boolean; retryAfterSeconds?: number }

export function hitLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const id = `${opts.keyPrefix || 'default'}:${key}`;
  let rec = stores.get(id);
  if (!rec) { rec = { count: 0, first: now }; stores.set(id, rec); }
  if (rec.blockedUntil && now < rec.blockedUntil) {
    return { allowed: false, retryAfterSeconds: (rec.blockedUntil - now) / 1000 };
  }
  if (now - rec.first > opts.windowMs) {
    rec.count = 0;
    rec.first = now;
    rec.blockedUntil = undefined;
  }
  rec.count++;
  if (rec.count > opts.max) {
    if (opts.blockDurationMs) {
      rec.blockedUntil = now + opts.blockDurationMs;
      return { allowed: false, retryAfterSeconds: opts.blockDurationMs / 1000 };
    }
    // Soft limit (no block) -> advise retry after remaining window
    const remaining = opts.windowMs - (now - rec.first);
    return { allowed: false, retryAfterSeconds: remaining / 1000 };
  }
  return { allowed: true };
}

// Convenience wrappers for common endpoints
export const limiters = {
  authLogin: (ip: string) => hitLimit(ip, { windowMs: 10 * 60_000, max: 10, blockDurationMs: 15 * 60_000, keyPrefix: 'login' }),
  chatGenerate: (ip: string) => hitLimit(ip, { windowMs: 60_000, max: 30, keyPrefix: 'chat' }),
  variantGenerate: (ip: string) => hitLimit(ip, { windowMs: 60_000, max: 40, keyPrefix: 'variant' }),
  passwordChange: (ip: string) => hitLimit(ip, { windowMs: 60 * 60_000, max: 5, keyPrefix: 'pwdchg' }),
  passwordSetup: (ip: string) => hitLimit(ip, { windowMs: 60 * 60_000, max: 3, keyPrefix: 'pwdsetup' }),
  dbExport: (ip: string) => hitLimit(ip, { windowMs: 5 * 60_000, max: 4, keyPrefix: 'dbexport' }),
  dbImport: (ip: string) => hitLimit(ip, { windowMs: 30 * 60_000, max: 2, keyPrefix: 'dbimport' }),
  importReceive: (ip: string) => hitLimit(ip, { windowMs: 60_000, max: 20, keyPrefix: 'importReceive' }),
  importCreateChat: (ip: string) => hitLimit(ip, { windowMs: 10 * 60_000, max: 30, keyPrefix: 'importCreateChat' }),
};

export function clientIp(req: { headers: any; socket?: any }): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  return req.socket?.remoteAddress || 'unknown';
}
