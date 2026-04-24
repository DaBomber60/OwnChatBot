// Centralized AI provider configuration helper.
// Reads settings from the database and returns resolved endpoint + model.
// Keys used (all optional except apiKey):
//  - apiKey:        string (required for any provider)
//  - aiProvider:    'deepseek' | 'openai' | 'openrouter' | 'custom'
//  - apiBaseUrl:    string (only for custom) – full URL to chat completions endpoint
//  - modelName:     string (optional override for model for any provider)
//
// NOTE: The existing schema is flexible (z.record) so no migration needed.
import prisma from './prisma';

import type { AIProvider } from '../types/models';
export type { AIProvider };

export interface AIConfig {
  apiKey: string;
  provider: AIProvider;
  url: string;            // Fully-qualified chat completions endpoint
  model: string;          // Model name sent upstream
  tokenFieldOverride?: string; // User override for max token field name
  enableTemperature?: boolean; // User toggle for including temperature param
  // Batched settings — fetched in the same query to avoid extra DB round-trips
  temperature: number;        // Default 0.7
  maxTokens: number;          // Default 4096, clamped [256, 8192]
  truncationLimit: number;    // Default 150000, clamped [30000, 320000]
  summaryPrompt: string;      // Default long prompt
  // DeepSeek thinking/reasoning mode
  deepseekThinking: 'disabled' | 'enabled';  // Default 'disabled'
  deepseekReasoningEffort: 'high' | 'max';   // Default 'high' (only used when thinking is enabled)
  deepseekThinkingGuidance: string;          // Guidance text appended to first user message when thinking is enabled
}

export const DEFAULT_FALLBACK_URL = 'https://api.deepseek.com/chat/completions';

interface RawSettingsMap { [k: string]: string | undefined }

// Default presets (OpenAI-compatible response schema assumption)
const PRESET_CONFIG: Record<Exclude<AIProvider, 'custom'>, { url: string; model: string; }> = {
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/auto' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-haiku-20241022' }
};

export async function getAIConfig(): Promise<AIConfig | { error: string; code: string }> {
  // Pull ALL relevant settings in a single query — includes AI provider config
  // plus temperature, maxTokens, maxCharacters, and summaryPrompt to avoid extra round-trips.
  const rows = await prisma.setting.findMany({
    where: { key: { in: [
      'apiKey', // legacy / fallback
      'apiKey_deepseek',
      'apiKey_openai',
      'apiKey_openrouter',
      'apiKey_anthropic',
      'apiKey_custom',
      'aiProvider', 'apiBaseUrl', 'modelName',
      'modelEnableTemperature', 'maxTokenFieldName',
      // DeepSeek thinking/reasoning mode
      'deepseekThinking', 'deepseekReasoningEffort', 'deepseekThinkingGuidance',
      // Batched settings (previously separate queries)
      'temperature', 'maxTokens', 'maxCharacters', 'summaryPrompt'
    ] } }
  });
  const map: RawSettingsMap = {};
  for (const r of rows) map[r.key] = r.value;

  const provider = (map.aiProvider as AIProvider) || 'deepseek';

  // Determine provider-specific key name precedence
  const providerKeyName = (
    provider === 'custom' ? 'apiKey_custom'
    : provider === 'deepseek' ? 'apiKey_deepseek'
    : provider === 'openai' ? 'apiKey_openai'
    : provider === 'openrouter' ? 'apiKey_openrouter'
    : provider === 'anthropic' ? 'apiKey_anthropic'
    : 'apiKey'
  );

  const apiKey = map[providerKeyName] || map.apiKey || '';
  if (!apiKey) return { error: 'API key not configured for selected provider', code: 'NO_API_KEY' };

  if (provider !== 'custom' && !PRESET_CONFIG[provider]) {
    return { error: `Unknown provider: ${provider}`, code: 'UNKNOWN_PROVIDER' };
  }

  let url: string;
  let model: string;

  if (provider === 'custom') {
    url = (map.apiBaseUrl || '').trim();
    if (!url) {
      return { error: 'Custom provider selected but apiBaseUrl is empty', code: 'MISSING_CUSTOM_URL' };
    }
    model = (map.modelName || 'model-name-here').trim();
  } else {
    url = PRESET_CONFIG[provider].url;
    model = map.modelName?.trim() || PRESET_CONFIG[provider].model;
  }

  const enableTemperature = map.modelEnableTemperature === undefined
    ? true
    : map.modelEnableTemperature === 'true';
  const tokenFieldOverride = (map.maxTokenFieldName || '').trim() || undefined;

  // Parse batched settings from the same query
  const temperature = map.temperature ? parseFloat(map.temperature) : NaN;
  const maxTokensRaw = map.maxTokens ? parseInt(map.maxTokens, 10) : NaN;
  const maxCharsRaw = map.maxCharacters ? parseInt(map.maxCharacters, 10) : NaN;

  // DeepSeek thinking/reasoning settings
  const deepseekThinking = (map.deepseekThinking === 'enabled' ? 'enabled' : 'disabled') as 'disabled' | 'enabled';
  const deepseekReasoningEffort = (map.deepseekReasoningEffort === 'max' ? 'max' : 'high') as 'high' | 'max';
  const deepseekThinkingGuidance = map.deepseekThinkingGuidance ?? DEFAULT_THINKING_GUIDANCE;

  return {
    apiKey, provider, url, model, enableTemperature, tokenFieldOverride,
    temperature: !isNaN(temperature) ? temperature : DEFAULT_TEMPERATURE,
    maxTokens: !isNaN(maxTokensRaw) ? clampMaxTokens(maxTokensRaw) : DEFAULT_MAX_TOKENS,
    truncationLimit: !isNaN(maxCharsRaw) ? Math.max(TRUNCATION_MIN, Math.min(TRUNCATION_MAX, maxCharsRaw)) : DEFAULT_TRUNCATION_LIMIT,
    summaryPrompt: map.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
    deepseekThinking,
    deepseekReasoningEffort,
    deepseekThinkingGuidance,
  };
}

// Lightweight helper to lazily fetch at call sites while preserving existing error flows.
export async function requireAIConfig(): Promise<AIConfig> {
  const cfg = await getAIConfig();
  if ('error' in cfg) {
    throw new Error(cfg.code + ':' + cfg.error);
  }
  return cfg;
}

// Some OpenAI (newer) models deprecate max_tokens in favor of max_completion_tokens.
// Heuristic: If provider is openai AND model starts with gpt-5 or contains '-mini' under gpt-5,
// or future-proof by explicit prefix match.
export function tokenFieldFor(provider: AIProvider, model: string, override?: string): 'max_tokens' | 'max_completion_tokens' | string {
  if (override) return override;
  if (provider === 'openai') {
    if (/^gpt-5/i.test(model) || /gpt-4\.1/i.test(model)) return 'max_completion_tokens';
  }
  return 'max_tokens';
}

// Determine whether a model supports arbitrary temperature values.
// Returns undefined when temperature should be omitted (provider default applies).
export function normalizeTemperature(provider: AIProvider, model: string, requested: number | undefined, enableTemperature: boolean | undefined): number | undefined {
  if (!enableTemperature) return undefined;
  if (requested === undefined) return undefined;
  if (provider === 'openai' && /^gpt-5/i.test(model)) {
    // Only default temperature supported (assumed 1). If user picked other, omit to avoid upstream error.
    if (requested === 1) return 1; // explicit OK (optional to even send)
    return undefined; // omit field
  }
  // Clamp general range 0..2 for other providers
  const clamped = Math.max(0, Math.min(2, requested));
  return clamped;
}

// ---------------------------------------------------------------------------
// Settings helpers — single source of truth for DB-backed AI settings.
// Each returns a sensible default on missing/invalid data or DB error.
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATION_LIMIT = 150000;
const TRUNCATION_MIN = 30000;
const TRUNCATION_MAX = 2500000;

/** Read the max-characters truncation limit from settings. Default: 150 000. Clamped [30 000, 320 000]. */
export async function getTruncationLimit(): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'maxCharacters' } });
    if (row?.value) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed)) return Math.max(TRUNCATION_MIN, Math.min(TRUNCATION_MAX, parsed));
    }
  } catch { /* DB error — use default */ }
  return DEFAULT_TRUNCATION_LIMIT;
}

export const DEFAULT_MAX_TOKENS = 4096;
export const MAX_TOKENS_MIN = 256;
export const MAX_TOKENS_MAX = 256000;

/** Clamp a max-tokens value to [min, 8192]. */
export function clampMaxTokens(n: number, min = MAX_TOKENS_MIN): number {
  return Math.max(min, Math.min(MAX_TOKENS_MAX, n));
}

/**
 * Read the max-tokens setting from DB.
 * @param opts.defaultValue — override default (default 4096)
 * @param opts.min — override min clamp (default 256)
 */
export async function getMaxTokens(opts?: { defaultValue?: number; min?: number }): Promise<number> {
  const def = opts?.defaultValue ?? DEFAULT_MAX_TOKENS;
  const min = opts?.min ?? MAX_TOKENS_MIN;
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'maxTokens' } });
    if (row?.value) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed)) return clampMaxTokens(parsed, min);
    }
  } catch { /* DB error — use default */ }
  return def;
}

export const DEFAULT_TEMPERATURE = 1;

/** Read the temperature setting from DB. Default: 0.7. */
export async function getTemperature(): Promise<number> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'temperature' } });
    if (row?.value) {
      const parsed = parseFloat(row.value);
      if (!isNaN(parsed)) return parsed;
    }
  } catch { /* DB error — use default */ }
  return DEFAULT_TEMPERATURE;
}

const DEFAULT_SUMMARY_PROMPT = 'Create a brief, focused summary (~100 words) of the roleplay between {{char}} and {{user}}. Include:\n\n- Key events and decisions\n- Important emotional moments\n- Location/time changes\n\nRules: Only summarize provided transcript. No speculation. Single paragraph format.';

/** Read the summary prompt from DB, with a sensible default. */
export async function getSummaryPrompt(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'summaryPrompt' } });
    if (row?.value) return row.value;
  } catch { /* DB error — use default */ }
  return DEFAULT_SUMMARY_PROMPT;
}

// ---------------------------------------------------------------------------
// DeepSeek thinking/reasoning helpers
// ---------------------------------------------------------------------------

/**
 * Build the DeepSeek-specific `thinking` (and optionally `reasoning_effort`)
 * fields to spread into an upstream request body.
 * Returns an empty object for non-DeepSeek providers.
 */
export function buildDeepSeekThinking(cfg: AIConfig): Record<string, unknown> {
  if (cfg.provider !== 'deepseek') return {};
  if (cfg.deepseekThinking === 'enabled') {
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: cfg.deepseekReasoningEffort,
    };
  }
  return { thinking: { type: 'disabled' } };
}

export const DEFAULT_THINKING_GUIDANCE = '【Thinking Mode Requirements】Within your thinking process (inside the <think> tags), please follow these rules: 1.State all analysis content directly as the external storyteller that you are, you control {{char}}, but you are not {{char}}. 2. Use analytical language, all thinking should be done from the position of a third-person storyteller. 3. Your thinking content should focus on plot direction analysis and reply content planning. Do not perform roleplay-style inner monologue performances within the thinking process.';

/**
 * If DeepSeek thinking is enabled, append the thinking guidance text to the
 * first user message in the messages array (mutates in place).
 * If the original first user message was truncated, appends to the earliest
 * user message still present.
 */
export function injectThinkingGuidance(cfg: AIConfig, messages: Array<{ role: string; content: string }>): void {
  if (cfg.provider !== 'deepseek' || cfg.deepseekThinking !== 'enabled') return;
  const guidance = cfg.deepseekThinkingGuidance;
  if (!guidance) return;
  // Find the first user message that is not just a placeholder '.'
  const firstUserIdx = messages.findIndex(m => m.role === 'user' && m.content.trim() !== '.');
  if (firstUserIdx === -1) return;
  messages[firstUserIdx] = {
    ...messages[firstUserIdx],
    content: messages[firstUserIdx].content + '\n\n' + guidance,
  };
}

/**
 * Strip `<think>...</think>` blocks from content, returning only the
 * visible response text. Used for content saved to DB / displayed to users.
 */
export function stripThinkTags(content: string): string {
  // Remove complete <think>...</think> blocks (including multiline)
  let result = content.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Remove any trailing incomplete <think>... (no closing tag) — partial stream
  result = result.replace(/<think>[\s\S]*$/, '');
  // Trim leading whitespace left behind
  return result.trimStart();
}

/** Check if `text` ends with a partial prefix of `tag`. Returns the length of the partial match, or 0. */
export function matchPartialTag(text: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
