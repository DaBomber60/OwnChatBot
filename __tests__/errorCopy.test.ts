/**
 * Tests for lib/chat/errorCopy.ts — the single source of AI failure copy.
 * These assert on `code` and on the facts each message must carry, not on exact prose,
 * so the wording stays free to change.
 */
import { describeChatError, describeServerError } from '../lib/chat/errorCopy';

describe('describeChatError', () => {
  it('distinguishes a thinking-only reply from a wholly empty one', () => {
    const thinking = describeChatError('THINKING_ONLY', { provider: 'deepseek' });
    const empty = describeChatError('EMPTY_RESPONSE', { provider: 'deepseek' });

    expect(thinking.title).not.toBe(empty.title);
    expect(thinking.body).toMatch(/retry/i);
    expect(empty.body).toMatch(/retry/i);
  });

  it('names the token budget when reasoning exhausted it', () => {
    const copy = describeChatError('THINKING_TRUNCATED', { provider: 'deepseek', maxTokens: 512 });
    expect(copy.body).toContain('512');
    expect(copy.body).toMatch(/Max Tokens/);
  });

  it('falls back gracefully when the token budget is unknown', () => {
    const copy = describeChatError('THINKING_TRUNCATED', {});
    expect(copy.body).toMatch(/Max Tokens/);
    expect(copy.body).not.toMatch(/undefined|NaN/);
  });

  it('names the provider when one is known', () => {
    expect(describeChatError('UPSTREAM_DOWN', { provider: 'openai' }).title).toContain('OpenAI');
    expect(describeChatError('EMPTY_RESPONSE', { provider: 'anthropic' }).body).toContain('Anthropic');
  });

  it('reads correctly with no provider at all', () => {
    const copy = describeChatError('UPSTREAM_STALLED', {});
    expect(copy.title).toContain('The API');
    expect(copy.title).not.toMatch(/undefined/);
  });

  it('reports how long we waited', () => {
    expect(describeChatError('UPSTREAM_DOWN', { timeoutSeconds: 20 }).body).toContain('20 seconds');
    expect(describeChatError('UPSTREAM_STALLED', { stallSeconds: 40 }).body).toContain('40 seconds');
  });

  it('reports how much history was dropped', () => {
    const copy = describeChatError('CONTEXT_TRUNCATED', { sentCount: 12, baseCount: 90 });
    expect(copy.title).toContain('12');
    expect(copy.title).toContain('90');
    expect(copy.body).toMatch(/Max Characters/);
  });

  it('carries raw upstream text in detail, never in the title', () => {
    const copy = describeChatError('UPSTREAM_ERROR', { provider: 'deepseek', detail: 'HTTP 402 insufficient balance' });
    expect(copy.detail).toBe('HTTP 402 insufficient balance');
    expect(copy.title).not.toContain('402');
  });

  it('drops blank detail rather than rendering an empty block', () => {
    expect(describeChatError('UPSTREAM_ERROR', { detail: '   ' }).detail).toBeUndefined();
    expect(describeChatError('UPSTREAM_ERROR', {}).detail).toBeUndefined();
  });

  it('keeps every message free of emoji and exclamation marks', () => {
    const codes = [
      'THINKING_ONLY', 'THINKING_TRUNCATED', 'EMPTY_RESPONSE', 'UPSTREAM_DOWN',
      'UPSTREAM_STALLED', 'UPSTREAM_UNPARSEABLE', 'STREAM_INTERRUPTED',
      'CONTEXT_TRUNCATED', 'MAX_TOKENS', 'UPSTREAM_ERROR',
    ] as const;
    for (const code of codes) {
      const copy = describeChatError(code, { provider: 'deepseek', maxTokens: 4096 });
      expect(copy.title).not.toMatch(/!/);
      expect(copy.body).not.toMatch(/!/);
      expect(copy.title).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });
});

describe('describeServerError', () => {
  it('maps the thinking-only code to the thinking-only copy', () => {
    expect(describeServerError('UPSTREAM_THINKING_ONLY').code).toBe('THINKING_ONLY');
  });

  it('maps a no-content code to the empty-response copy', () => {
    expect(describeServerError('UPSTREAM_NO_CONTENT').code).toBe('EMPTY_RESPONSE');
  });

  it('suppresses the raw server text for codes that have their own copy', () => {
    const copy = describeServerError('UPSTREAM_THINKING_ONLY', {
      detail: 'The model returned reasoning but no reply',
    });
    expect(copy.detail).toBeUndefined();
  });

  it('keeps the raw server text for codes it does not recognise', () => {
    const copy = describeServerError('RATE_LIMITED', { detail: 'Slow down' });
    expect(copy.code).toBe('UPSTREAM_ERROR');
    expect(copy.detail).toBe('Slow down');
  });

  it('handles a missing code', () => {
    expect(describeServerError(undefined, { detail: 'boom' }).code).toBe('UPSTREAM_ERROR');
  });
});
