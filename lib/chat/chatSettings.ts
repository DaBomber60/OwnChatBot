import { DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS, MAX_TOKENS_MIN, MAX_TOKENS_MAX } from '../aiProvider';

/** Parsed chat settings from the /api/settings endpoint. */
export interface ChatSettings {
  stream: boolean;
  defaultPromptId: number | undefined;
  temperature: number;
  maxTokens: number;
}

/** Fetches and parses AI-related settings from the database. */
export async function fetchChatSettings(): Promise<ChatSettings> {
  const res = await fetch('/api/settings');
  const s = await res.json();
  return {
    stream: s.stream === undefined ? true : s.stream === 'true',
    defaultPromptId: s.defaultPromptId ? Number(s.defaultPromptId) : undefined,
    temperature: s.temperature ? parseFloat(s.temperature) : DEFAULT_TEMPERATURE,
    maxTokens: s.maxTokens ? Math.max(MAX_TOKENS_MIN, Math.min(MAX_TOKENS_MAX, parseInt(s.maxTokens))) : DEFAULT_MAX_TOKENS,
  };
}
