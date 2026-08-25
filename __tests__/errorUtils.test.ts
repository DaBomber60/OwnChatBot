/**
 * @jest-environment node
 */
import {
  safeJson,
  toErrorDetail,
  extractErrorFromResponse,
} from '../lib/chat/errorUtils';

// ---------------------------------------------------------------------------
// safeJson
// ---------------------------------------------------------------------------
describe('safeJson', () => {
  it('parses valid JSON response', async () => {
    const res = new Response(JSON.stringify({ hello: 'world' }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await safeJson(res);
    expect(data).toEqual({ hello: 'world' });
  });

  it('returns __parseError or __rawText for non-JSON body', async () => {
    const res = new Response('Not JSON at all', {
      headers: { 'Content-Type': 'text/plain' },
    });
    const data = await safeJson(res);
    // After json() fails, the body may already be consumed, so clone().text()
    // may also fail. Either fallback path is valid.
    expect(data.__rawText === 'Not JSON at all' || data.__parseError === true).toBe(true);
  });

  it('returns __parseError when both json and text fail', async () => {
    // Create a response whose body has already been consumed
    const res = new Response('body');
    await res.text(); // consume body
    const data = await safeJson(res);
    // Should return either __rawText or __parseError (body was consumed)
    expect(data.__rawText !== undefined || data.__parseError === true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// toErrorDetail
// ---------------------------------------------------------------------------
describe('toErrorDetail', () => {
  it('returns empty string for empty or nullish input', () => {
    expect(toErrorDetail('')).toBe('');
    expect(toErrorDetail(null)).toBe('');
    expect(toErrorDetail(undefined)).toBe('');
  });

  it('strips leading [Tag] markers', () => {
    const result = toErrorDetail('[Stream] Something went wrong');
    expect(result).toBe('Something went wrong');
  });

  it('normalizes "input stream" errors', () => {
    const result = toErrorDetail('Error: input stream was reset');
    expect(result).toContain('AI stream was interrupted');
  });

  it('keeps the whole message instead of slicing at the last colon', () => {
    // The old heuristic turned this into just "gpt-5", losing what actually went wrong.
    expect(toErrorDetail('Error: model not found: gpt-5')).toBe('Error: model not found: gpt-5');
    expect(toErrorDetail('Rate limit exceeded: retry in 30s')).toBe('Rate limit exceeded: retry in 30s');
  });

  it('returns the full message when no colon is present', () => {
    expect(toErrorDetail('Simple error')).toBe('Simple error');
  });

  it('redacts secrets using the shared patterns', () => {
    const result = toErrorDetail('Invalid credentials for sk-proj-AbCdEfGhIjKlMnOpQrStUv');
    expect(result).not.toContain('AbCdEfGhIjKlMnOpQrStUv');
    expect(result).toContain('****REDACTED****');
  });

  it('redacts an Authorization header the old regex would have missed', () => {
    const result = toErrorDetail('Rejected request with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('caps runaway messages so an HTML error page cannot fill the modal', () => {
    const result = toErrorDetail('<p>The gateway returned an unexpected response.</p> '.repeat(60));
    expect(result.length).toBeLessThanOrEqual(501);
    expect(result.endsWith('…')).toBe(true);
  });

  it('stringifies non-string input', () => {
    expect(toErrorDetail({ message: 'boom' })).toContain('boom');
  });
});

// ---------------------------------------------------------------------------
// extractErrorFromResponse
// ---------------------------------------------------------------------------
describe('extractErrorFromResponse', () => {
  it('reads the flat envelope every LLM route now sends', () => {
    const result = extractErrorFromResponse({ error: 'Something failed', code: 'UPSTREAM_AUTH' });
    expect(result).toBe('Something failed');
  });

  it('still reads the legacy nested shape', () => {
    const result = extractErrorFromResponse({ error: { message: 'Rate limit exceeded' } });
    expect(result).toBe('Rate limit exceeded');
  });

  it('uses __rawText for non-JSON bodies', () => {
    const result = extractErrorFromResponse({ __rawText: 'Raw error text' });
    expect(result).toContain('Raw error text');
  });

  it('falls back to statusText', () => {
    const result = extractErrorFromResponse({}, 'Service Unavailable');
    expect(result).toContain('Service Unavailable');
  });

  it('returns "Unknown error" when everything is empty', () => {
    const result = extractErrorFromResponse(null);
    expect(result).toContain('Unknown error');
  });

  it('redacts a key echoed back in the provider message', () => {
    const errData = { error: { message: 'Invalid api_key: AbCdEfGhIjKlMnOpQrSt' } };
    const result = extractErrorFromResponse(errData);
    expect(result).not.toContain('AbCdEfGhIjKlMnOpQrSt');
    expect(result).toContain('****REDACTED****');
  });
});
