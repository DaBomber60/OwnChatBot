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

export type AIProvider = 'deepseek' | 'openai' | 'openrouter' | 'anthropic' | 'custom';

export interface AIConfig {
  apiKey: string;
  provider: AIProvider;
  url: string;            // Fully-qualified chat completions endpoint
  model: string;          // Model name sent upstream
  tokenFieldOverride?: string; // User override for max token field name
  enableTemperature?: boolean; // User toggle for including temperature param
}

interface RawSettingsMap { [k: string]: string | undefined }

// Default presets (OpenAI-compatible response schema assumption)
const PRESET_CONFIG: Record<Exclude<AIProvider, 'custom'>, { url: string; model: string; }> = {
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5-mini' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/auto' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-haiku-20241022' }
};

export async function getAIConfig(): Promise<AIConfig | { error: string; code: string }> {
  // Pull all potentially relevant settings in a single query to reduce latency.
  const rows = await prisma.setting.findMany({
    where: { key: { in: [
      'apiKey', // legacy / fallback
      'apiKey_deepseek',
      'apiKey_openai',
      'apiKey_openrouter',
      'apiKey_anthropic',
      'apiKey_custom',
      'aiProvider', 'apiBaseUrl', 'modelName',
      'modelEnableTemperature', 'maxTokenFieldName'
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

  return { apiKey, provider, url, model, enableTemperature, tokenFieldOverride };
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
