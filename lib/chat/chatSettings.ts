import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, MAX_TOKENS_MIN, MAX_TOKENS_MAX } from '../aiProvider';
import type { AIProvider } from '../../types/models';

export const DEFAULT_API_FAILURE_TIMEOUT = 20;

/** Parsed chat settings from the /api/settings endpoint. */
export interface ChatSettings {
  stream: boolean;
  defaultPromptId: number | undefined;
  temperature: number;
  maxTokens: number;
  apiFailureTimeout: number;
  aiProvider: AIProvider;
}

/** Human-readable display names for AI providers. */
export const PROVIDER_DISPLAY_NAMES: Record<AIProvider, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  custom: 'Custom',
};

/** Fetches and parses AI-related settings from the database. */
export async function fetchChatSettings(): Promise<ChatSettings> {
  const res = await fetch('/api/settings');
  const s = await res.json();
  return {
    stream: s.stream === undefined ? true : s.stream === 'true',
    defaultPromptId: s.defaultPromptId ? Number(s.defaultPromptId) : undefined,
    temperature: s.temperature ? parseFloat(s.temperature) : DEFAULT_TEMPERATURE,
    maxTokens: s.maxTokens ? Math.max(MAX_TOKENS_MIN, Math.min(MAX_TOKENS_MAX, parseInt(s.maxTokens))) : DEFAULT_MAX_TOKENS,
    apiFailureTimeout: s.apiFailureTimeout ? Math.max(5, Math.min(120, parseInt(s.apiFailureTimeout))) : DEFAULT_API_FAILURE_TIMEOUT,
    aiProvider: (s.aiProvider as AIProvider) || 'deepseek',
  };
}
