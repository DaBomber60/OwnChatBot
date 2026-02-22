import { deriveImportToken, getCachedImportToken } from '../lib/importToken';

describe('deriveImportToken', () => {
  it('produces a deterministic result for the same inputs', async () => {
    const t1 = await deriveImportToken(1, 'my-secret');
    const t2 = await deriveImportToken(1, 'my-secret');
    expect(t1).toBe(t2);
  });

  it('produces different tokens for different versions', async () => {
    const t1 = await deriveImportToken(1, 'my-secret');
    const t2 = await deriveImportToken(2, 'my-secret');
    expect(t1).not.toBe(t2);
  });

  it('produces different tokens for different secrets', async () => {
    const t1 = await deriveImportToken(1, 'secret-a');
    const t2 = await deriveImportToken(1, 'secret-b');
    expect(t1).not.toBe(t2);
  });

  it('returns a string of length 40', async () => {
    const token = await deriveImportToken(1, 'test-secret');
    expect(token.length).toBe(40);
  });

  it('produces base64url-safe output (no +, /, =)', async () => {
    const token = await deriveImportToken(42, 'another-secret');
    expect(token).not.toMatch(/[+/=]/);
    // Should only contain base64url chars
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('getCachedImportToken', () => {
  it('returns the same token for the same version (caching)', async () => {
    const t1 = await getCachedImportToken(99, 'cache-secret');
    const t2 = await getCachedImportToken(99, 'cache-secret');
    expect(t1).toBe(t2);
  });

  it('recomputes when version changes', async () => {
    const t1 = await getCachedImportToken(100, 'cache-secret');
    const t2 = await getCachedImportToken(101, 'cache-secret');
    expect(t1).not.toBe(t2);
  });
});
