import { tokenFieldFor, normalizeTemperature, clampMaxTokens, DEFAULT_FALLBACK_URL } from '../lib/aiProvider';
import type { AIProvider } from '../lib/aiProvider';

// ---------------------------------------------------------------------------
// tokenFieldFor
// ---------------------------------------------------------------------------
describe('tokenFieldFor', () => {
  it('returns max_completion_tokens for OpenAI gpt-5 models', () => {
    expect(tokenFieldFor('openai', 'gpt-5-mini')).toBe('max_completion_tokens');
    expect(tokenFieldFor('openai', 'gpt-5')).toBe('max_completion_tokens');
    expect(tokenFieldFor('openai', 'GPT-5-turbo')).toBe('max_completion_tokens');
  });

  it('returns max_completion_tokens for OpenAI gpt-4.1 models', () => {
    expect(tokenFieldFor('openai', 'gpt-4.1-turbo')).toBe('max_completion_tokens');
    expect(tokenFieldFor('openai', 'gpt-4.1')).toBe('max_completion_tokens');
  });

  it('returns max_tokens for older OpenAI models', () => {
    expect(tokenFieldFor('openai', 'gpt-4')).toBe('max_tokens');
    expect(tokenFieldFor('openai', 'gpt-4-turbo')).toBe('max_tokens');
    expect(tokenFieldFor('openai', 'gpt-3.5-turbo')).toBe('max_tokens');
  });

  it('returns max_tokens for non-OpenAI providers', () => {
    expect(tokenFieldFor('deepseek', 'deepseek-chat')).toBe('max_tokens');
    expect(tokenFieldFor('openrouter', 'anything')).toBe('max_tokens');
    expect(tokenFieldFor('anthropic', 'claude-3')).toBe('max_tokens');
    expect(tokenFieldFor('custom', 'my-model')).toBe('max_tokens');
  });

  it('returns override when provided', () => {
    expect(tokenFieldFor('openai', 'gpt-5', 'my_custom_field')).toBe('my_custom_field');
    expect(tokenFieldFor('deepseek', 'dc', 'override')).toBe('override');
  });
});

// ---------------------------------------------------------------------------
// normalizeTemperature
// ---------------------------------------------------------------------------
describe('normalizeTemperature', () => {
  it('returns undefined when enableTemperature is false', () => {
    expect(normalizeTemperature('openai', 'gpt-4', 0.7, false)).toBeUndefined();
  });

  it('returns undefined when requested is undefined', () => {
    expect(normalizeTemperature('openai', 'gpt-4', undefined, true)).toBeUndefined();
  });

  it('returns undefined for gpt-5 with non-default temperature', () => {
    expect(normalizeTemperature('openai', 'gpt-5', 0.7, true)).toBeUndefined();
    expect(normalizeTemperature('openai', 'gpt-5-mini', 0.5, true)).toBeUndefined();
  });

  it('returns 1 for gpt-5 with temperature exactly 1', () => {
    expect(normalizeTemperature('openai', 'gpt-5', 1, true)).toBe(1);
  });

  it('clamps values to [0, 2] for general providers', () => {
    expect(normalizeTemperature('deepseek', 'model', 3, true)).toBe(2);
    expect(normalizeTemperature('deepseek', 'model', -1, true)).toBe(0);
    expect(normalizeTemperature('openrouter', 'x', 1.5, true)).toBe(1.5);
  });

  it('passes through valid temperatures for non-gpt-5 OpenAI models', () => {
    expect(normalizeTemperature('openai', 'gpt-4', 0.7, true)).toBe(0.7);
    expect(normalizeTemperature('openai', 'gpt-4', 0, true)).toBe(0);
    expect(normalizeTemperature('openai', 'gpt-4', 2, true)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// clampMaxTokens
// ---------------------------------------------------------------------------
describe('clampMaxTokens', () => {
  it('clamps below minimum to 256 by default', () => {
    expect(clampMaxTokens(100)).toBe(256);
    expect(clampMaxTokens(0)).toBe(256);
    expect(clampMaxTokens(-10)).toBe(256);
  });

  it('clamps above maximum to 8192', () => {
    expect(clampMaxTokens(99999)).toBe(8192);
    expect(clampMaxTokens(10000)).toBe(8192);
  });

  it('returns the value when within range', () => {
    expect(clampMaxTokens(4096)).toBe(4096);
    expect(clampMaxTokens(256)).toBe(256);
    expect(clampMaxTokens(8192)).toBe(8192);
  });

  it('respects custom min parameter', () => {
    expect(clampMaxTokens(100, 512)).toBe(512);
    expect(clampMaxTokens(600, 512)).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_FALLBACK_URL constant
// ---------------------------------------------------------------------------
describe('DEFAULT_FALLBACK_URL', () => {
  it('is the DeepSeek chat completions endpoint', () => {
    expect(DEFAULT_FALLBACK_URL).toBe('https://api.deepseek.com/chat/completions');
  });
});
