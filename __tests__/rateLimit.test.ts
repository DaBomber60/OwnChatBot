import { hitLimit, clientIp } from '../lib/rateLimit';
import type { RateLimitOptions } from '../lib/rateLimit';

// We need to control Date.now for deterministic tests
let mockNow: number;
beforeEach(() => {
  mockNow = 1000000;
  jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
});
afterEach(() => jest.restoreAllMocks());

// The module uses a module-level Map. To isolate tests, use unique keyPrefixes.
let testCounter = 0;
function uniquePrefix() {
  return `test_${++testCounter}_${Date.now()}`;
}

// ---------------------------------------------------------------------------
// hitLimit
// ---------------------------------------------------------------------------
describe('hitLimit', () => {
  it('allows requests under the limit', () => {
    const prefix = uniquePrefix();
    const opts: RateLimitOptions = { windowMs: 60000, max: 3, keyPrefix: prefix };
    expect(hitLimit('ip1', opts).allowed).toBe(true);
    expect(hitLimit('ip1', opts).allowed).toBe(true);
    expect(hitLimit('ip1', opts).allowed).toBe(true);
  });

  it('denies requests over the limit', () => {
    const prefix = uniquePrefix();
    const opts: RateLimitOptions = { windowMs: 60000, max: 2, keyPrefix: prefix };
    hitLimit('ip2', opts); // 1
    hitLimit('ip2', opts); // 2
    const result = hitLimit('ip2', opts); // 3 → over
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeDefined();
    expect(result.retryAfterSeconds!).toBeGreaterThan(0);
  });

  it('resets after the window expires', () => {
    const prefix = uniquePrefix();
    const opts: RateLimitOptions = { windowMs: 10000, max: 1, keyPrefix: prefix };
    hitLimit('ip3', opts); // 1 → allowed
    const denied = hitLimit('ip3', opts); // 2 → denied
    expect(denied.allowed).toBe(false);

    // Advance time past the window
    mockNow += 11000;
    const allowed = hitLimit('ip3', opts);
    expect(allowed.allowed).toBe(true);
  });

  it('uses blockDurationMs for hard blocks', () => {
    const prefix = uniquePrefix();
    const opts: RateLimitOptions = { windowMs: 60000, max: 1, blockDurationMs: 30000, keyPrefix: prefix };
    hitLimit('ip4', opts); // 1
    const blocked = hitLimit('ip4', opts); // 2 → blocked
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(30); // blockDurationMs / 1000
  });

  it('stays blocked during blockDuration even after window resets', () => {
    const prefix = uniquePrefix();
    const opts: RateLimitOptions = { windowMs: 5000, max: 1, blockDurationMs: 30000, keyPrefix: prefix };
    hitLimit('ip5', opts);
    hitLimit('ip5', opts); // triggers block

    // Advance past window but within block
    mockNow += 10000;
    const result = hitLimit('ip5', opts);
    expect(result.allowed).toBe(false);
  });

  it('uses independent counters for different keys', () => {
    const prefix = uniquePrefix();
    const opts: RateLimitOptions = { windowMs: 60000, max: 1, keyPrefix: prefix };
    expect(hitLimit('a', opts).allowed).toBe(true);
    expect(hitLimit('b', opts).allowed).toBe(true);
    // 'a' is now at max
    expect(hitLimit('a', opts).allowed).toBe(false);
    // 'b' is now at max
    expect(hitLimit('b', opts).allowed).toBe(false);
  });

  it('uses independent counters for different keyPrefixes', () => {
    const p1 = uniquePrefix();
    const p2 = uniquePrefix();
    const opts1: RateLimitOptions = { windowMs: 60000, max: 1, keyPrefix: p1 };
    const opts2: RateLimitOptions = { windowMs: 60000, max: 1, keyPrefix: p2 };
    hitLimit('same-ip', opts1);
    expect(hitLimit('same-ip', opts1).allowed).toBe(false); // p1 exhausted
    expect(hitLimit('same-ip', opts2).allowed).toBe(true); // p2 still fresh
  });
});

// ---------------------------------------------------------------------------
// clientIp
// ---------------------------------------------------------------------------
describe('clientIp', () => {
  it('extracts first IP from x-forwarded-for', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })).toBe('1.2.3.4');
  });

  it('handles single IP in x-forwarded-for', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '10.0.0.1' } })).toBe('10.0.0.1');
  });

  it('falls back to socket.remoteAddress', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
  });

  it('returns "unknown" when no IP info available', () => {
    expect(clientIp({ headers: {} })).toBe('unknown');
  });

  it('trims whitespace from forwarded IP', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '  1.2.3.4 , 5.6.7.8' } })).toBe('1.2.3.4');
  });
});
