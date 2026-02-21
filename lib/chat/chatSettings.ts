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
    temperature: s.temperature ? parseFloat(s.temperature) : 0.7,
    maxTokens: s.maxTokens ? Math.max(256, Math.min(8192, parseInt(s.maxTokens))) : 4096,
  };
}
