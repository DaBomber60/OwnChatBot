/**
 * Lore injection: adding entries to system prompt and user messages.
 */
import type { TriggeredEntry } from './trigger';

export interface InjectionContext {
  /** Lore entries with constant=true (always in system prompt) */
  constantEntries: TriggeredEntry[];
  /** Lore entries triggered by keywords in current turn */
  triggeredEntries: TriggeredEntry[];
}

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
 * Build the lore section to append to a user message.
 * Format: [!lore:entry1,entry2] followed by hidden content
 * 
 * Returns both the user-visible marker and the hidden lore content.
 * For the UI badge, the marker contains entry IDs.
 */
export function buildTriggeredLoreInjection(entries: TriggeredEntry[]): {
  /** Visible marker to append to the user message (e.g. "[!lore:1,2,3]") */
  marker: string;
  /** Hidden lore content to append after marker */
  content: string;
  /** Triggered entry IDs for tracking across turns */
  entryIds: number[];
} {
  if (entries.length === 0) {
    return { marker: '', content: '', entryIds: [] };
  }

  const entryIds = entries.map(e => e.id);
  const marker = `\n\n[📖 Lore: ${entryIds.join(', ')}]`;

  const loreContent = entries
    .map(e => `[Entry: ${e.title}]\n${e.content}`)
    .join('\n\n');

  return {
    marker,
    content: `\n\n<triggered_lore>\n${loreContent}\n</triggered_lore>`,
    entryIds,
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
 * Appends lore marker and content to the message.
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
    injectedMessage: userMessage + injection.marker + injection.content,
    triggeredIds: injection.entryIds,
  };
}
