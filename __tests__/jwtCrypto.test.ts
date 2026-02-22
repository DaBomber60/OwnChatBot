import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';

// jsdom test environment doesn't provide crypto.subtle or TextEncoder/TextDecoder —
// polyfill with Node builtins. Must be done before importing jwtCrypto.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, writable: true });
if (typeof globalThis.TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = TextEncoder;
  (globalThis as any).TextDecoder = TextDecoder;
}

import { verifyJwtHs256, signJwtHs256, TOKEN_LIFETIME, TOKEN_RENEWAL_THRESHOLD } from '../lib/jwtCrypto';

const TEST_SECRET = 'test-secret-for-unit-tests';

describe('jwtCrypto', () => {
  // ------------------------------------------------------------------
  // signJwtHs256
  // ------------------------------------------------------------------
  describe('signJwtHs256', () => {
    it('returns a three-part dot-separated token', async () => {
      const token = await signJwtHs256({ foo: 'bar' }, TEST_SECRET);
      expect(token.split('.').length).toBe(3);
    });

    it('embeds the payload and adds iat + exp', async () => {
      const before = Math.floor(Date.now() / 1000);
      const token = await signJwtHs256({ authenticated: true, v: 5 }, TEST_SECRET);
      const after = Math.floor(Date.now() / 1000);

      // Decode the payload manually
      const payloadB64 = token.split('.')[1]!;
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));

      expect(payload.authenticated).toBe(true);
      expect(payload.v).toBe(5);
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
      expect(payload.exp).toBe(payload.iat + TOKEN_LIFETIME);
    });

    it('respects a custom lifetime', async () => {
      const token = await signJwtHs256({ x: 1 }, TEST_SECRET, 3600);
      const payloadB64 = token.split('.')[1]!;
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
      expect(payload.exp - payload.iat).toBe(3600);
    });

    it('sets alg: HS256 and typ: JWT in the header', async () => {
      const token = await signJwtHs256({}, TEST_SECRET);
      const headerB64 = token.split('.')[0]!;
      const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')));
      expect(header.alg).toBe('HS256');
      expect(header.typ).toBe('JWT');
    });
  });

  // ------------------------------------------------------------------
  // verifyJwtHs256
  // ------------------------------------------------------------------
  describe('verifyJwtHs256', () => {
    it('verifies a token signed with the same secret', async () => {
      const token = await signJwtHs256({ authenticated: true, v: 3 }, TEST_SECRET);
      const result = await verifyJwtHs256(token, TEST_SECRET);
      expect(result.valid).toBe(true);
      expect(result.payload?.authenticated).toBe(true);
      expect(result.payload?.v).toBe(3);
    });

    it('rejects a token signed with a different secret', async () => {
      const token = await signJwtHs256({ authenticated: true }, TEST_SECRET);
      const result = await verifyJwtHs256(token, 'wrong-secret');
      expect(result.valid).toBe(false);
      expect(result.payload).toBeUndefined();
    });

    it('rejects a token with a tampered payload', async () => {
      const token = await signJwtHs256({ authenticated: true }, TEST_SECRET);
      const parts = token.split('.');
      // Tamper with the payload
      const tampered = btoa(JSON.stringify({ authenticated: false }))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const badToken = `${parts[0]}.${tampered}.${parts[2]}`;
      const result = await verifyJwtHs256(badToken, TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it('rejects an expired token', async () => {
      // Sign with 0 lifetime so it's immediately expired
      const token = await signJwtHs256({ x: 1 }, TEST_SECRET, 0);
      // Wait a tiny tick to ensure Date.now() moves forward
      await new Promise(r => setTimeout(r, 10));
      const result = await verifyJwtHs256(token, TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it('rejects a malformed token (not 3 parts)', async () => {
      expect((await verifyJwtHs256('abc.def', TEST_SECRET)).valid).toBe(false);
      expect((await verifyJwtHs256('', TEST_SECRET)).valid).toBe(false);
      expect((await verifyJwtHs256('a.b.c.d', TEST_SECRET)).valid).toBe(false);
    });

    it('rejects a token with invalid base64 in the payload', async () => {
      const result = await verifyJwtHs256('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.!!!invalid!!!.abc', TEST_SECRET);
      expect(result.valid).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Round-trip compatibility
  // ------------------------------------------------------------------
  describe('sign + verify round-trip', () => {
    it('works with complex payloads', async () => {
      const payload = {
        authenticated: true,
        v: 42,
        roles: ['admin', 'user'],
        nested: { key: 'value' },
      };
      const token = await signJwtHs256(payload, TEST_SECRET);
      const result = await verifyJwtHs256(token, TEST_SECRET);
      expect(result.valid).toBe(true);
      expect(result.payload?.v).toBe(42);
      expect(result.payload?.roles).toEqual(['admin', 'user']);
      expect(result.payload?.nested).toEqual({ key: 'value' });
    });

    it('works with unicode in payload values', async () => {
      const token = await signJwtHs256({ name: '日本語テスト 🎉' }, TEST_SECRET);
      const result = await verifyJwtHs256(token, TEST_SECRET);
      expect(result.valid).toBe(true);
      expect(result.payload?.name).toBe('日本語テスト 🎉');
    });

    it('works with an empty payload (only iat+exp added)', async () => {
      const token = await signJwtHs256({}, TEST_SECRET);
      const result = await verifyJwtHs256(token, TEST_SECRET);
      expect(result.valid).toBe(true);
      expect(result.payload?.iat).toBeDefined();
      expect(result.payload?.exp).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  describe('constants', () => {
    it('TOKEN_LIFETIME is 14 days in seconds', () => {
      expect(TOKEN_LIFETIME).toBe(14 * 24 * 60 * 60);
    });

    it('TOKEN_RENEWAL_THRESHOLD is 7 days in seconds', () => {
      expect(TOKEN_RENEWAL_THRESHOLD).toBe(7 * 24 * 60 * 60);
    });
  });
});
