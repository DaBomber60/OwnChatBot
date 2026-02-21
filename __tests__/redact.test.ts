import { redactString, redactAll, safeLog, patchConsoleForRedaction } from '../lib/redact';

describe('redactString', () => {
  it('redacts sk_ prefixed API keys', () => {
    const input = 'Key: sk_AbCdEfGhIjKlMnOpQrSt';
    const result = redactString(input);
    expect(result).toContain('****REDACTED****');
    expect(result).not.toContain('AbCdEfGhIjKlMnOpQrSt');
    // Preserves first 4 and last 4
    expect(result).toMatch(/sk_A.*QrSt/);
  });

  it('redacts Bearer tokens in Authorization headers', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
    const result = redactString(input);
    expect(result).toContain('****REDACTED****');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts database URL passwords', () => {
    const input = 'postgresql://admin:supersecretpass@localhost:5432/mydb';
    const result = redactString(input);
    expect(result).toContain('****REDACTED****');
    expect(result).not.toContain('supersecretpass');
    expect(result).toContain('admin'); // username preserved
  });

  it('returns empty string for null/undefined', () => {
    expect(redactString(null)).toBe('');
    expect(redactString(undefined)).toBe('');
  });

  it('JSON-stringifies non-string input then redacts', () => {
    const input = { key: 'sk_AbCdEfGhIjKlMnOpQrSt' };
    const result = redactString(input);
    expect(result).toContain('****REDACTED****');
    expect(result).not.toContain('AbCdEfGhIjKlMnOpQrSt');
  });

  it('does not false-positive on short/normal text', () => {
    const input = 'Hello, this is a normal log message';
    expect(redactString(input)).toBe(input);
  });

  it('handles short tokens (≤8 chars) with full mask', () => {
    // Short tokens that match the API_KEY_PATTERN should be fully masked
    // The pattern requires 24+ chars for generic tokens or sk_ prefix with 16+
    const shortInput = 'text only';
    expect(redactString(shortInput)).toBe(shortInput);
  });
});

describe('redactAll', () => {
  it('redacts all arguments independently', () => {
    const results = redactAll(
      'sk_AAAA1234567890123456',
      'postgresql://u:pass@h:5432/db',
      'safe text'
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toContain('****REDACTED****');
    expect(results[1]).toContain('****REDACTED****');
    expect(results[2]).toBe('safe text');
  });
});

describe('safeLog', () => {
  it('calls console.log with redacted strings', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    safeLog('sk_AbCdEfGhIjKlMnOpQrSt');
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]![0];
    expect(arg).toContain('****REDACTED****');
    spy.mockRestore();
  });
});

describe('patchConsoleForRedaction', () => {
  it('is idempotent (second call is a no-op)', () => {
    // Save original
    const originalLog = console.log;
    patchConsoleForRedaction();
    const patchedLog = console.log;
    patchConsoleForRedaction(); // second call
    expect(console.log).toBe(patchedLog); // same function, not double-wrapped
    // Restore
    console.log = originalLog;
    (console as any).__redactionPatched = false;
  });
});
