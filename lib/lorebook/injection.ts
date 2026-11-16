/**
 * Lore injection: adding entries to system prompt and user messages.
 */
import type { TriggeredEntry } from './trigger';

/**
 * Build the lore section for the system prompt from constant entries.
 * Format: <lore_constant><entry_title>entry content</entry_title>...</lore_constant>
 * 
 * Returns empty string if no constant entries.
 */
export function buildConstantLoreSection(entries: TriggeredEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const items = entries
    .map(e => `<${e.title.replace(/[<>]/g, '')}>\n${e.content}\n</${e.title.replace(/[<>]/g, '')}>`)
    .join('\n\n');

  return `<lore_constant>\n${items}\n</lore_constant>`;
}

/**
 * Build the lore block appended to the latest user message.
 * Entry IDs are returned for tracking; they are not sent to the model.
 */
export function buildTriggeredLoreInjection(entries: TriggeredEntry[]): {
  /** Lore block to append after the user message */
  content: string;
  /** Triggered entry IDs for tracking across turns */
  entryIds: number[];
} {
  if (entries.length === 0) {
    return { content: '', entryIds: [] };
  }

  const loreContent = entries
    .map(e => `[Entry: ${e.title}]\n${e.content}`)
    .join('\n\n');

  return {
    content: `\n\n<triggered_lore>\n${loreContent}\n</triggered_lore>`,
    entryIds: entries.map(e => e.id),
  };
}

/**
 * Inject constant lore into system prompt (added at the end, before user instructions).
 * Modifies the systemPrompt string by appending lore section before any custom user prompts.
 */
export function injectConstantLoreIntoSystemPrompt(
  systemPrompt: string,
  constantEntries: TriggeredEntry[]
): string {
  const loreSection = buildConstantLoreSection(constantEntries);
  if (!loreSection) {
    return systemPrompt;
  }

  // Insert lore section before the final "following is a conversation" paragraph
  // This keeps the scenario and example dialogue together
  const conversationMarker = 'The following is a conversation between';
  const idx = systemPrompt.indexOf(conversationMarker);

  if (idx !== -1) {
    return systemPrompt.slice(0, idx) + loreSection + '\n\n' + systemPrompt.slice(idx);
  }

  // If marker not found, append at end
  return systemPrompt + '\n\n' + loreSection;
}

/**
 * Inject triggered lore into a user message.
 */
export function injectTriggeredLoreIntoUserMessage(
  userMessage: string,
  triggeredEntries: TriggeredEntry[]
): {
  injectedMessage: string;
  triggeredIds: number[];
} {
  const injection = buildTriggeredLoreInjection(triggeredEntries);

  return {
    injectedMessage: userMessage + injection.content,
    triggeredIds: injection.entryIds,
  };
}

/**
 * Append triggered lore to the last user message of a prompt (returns a new array).
 * Prompt history stays as stored; only the newest user turn carries the lore block.
 */
export function appendTriggeredLoreToLastUserMessage<T extends { role: string; content: string }>(
  messages: T[],
  triggeredEntries: TriggeredEntry[]
): T[] {
  if (triggeredEntries.length === 0) return messages;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return messages;
  const { injectedMessage } = injectTriggeredLoreIntoUserMessage(messages[lastUserIdx]!.content, triggeredEntries);
  return messages.map((m, i) => (i === lastUserIdx ? { ...m, content: injectedMessage } : m));
}
