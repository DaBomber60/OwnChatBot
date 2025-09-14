// In-memory store for Deepseek API request payloads
// Keyed by sessionId
export const requestLogMap = new Map<string, unknown>();
