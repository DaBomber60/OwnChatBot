/**
 * Lore triggering logic: keyword matching and entry selection.
 */
import { GLOBAL_LOREBOOK_ID } from './constants';
import { parseKeywordList } from './keywords';
import { getMatchedLoreIds } from '../messageMetadata';

export interface TriggeredEntry {
  id: number;
  lorebookId: number;
  title: string;
  content: string;
  priority: number;
  constant: boolean;
}

export type LoreEntryRow = TriggeredEntry & { keys: string };

export interface ActiveLoreSelection {
  /** Entries to inject this turn, highest priority first, within the lore budget. */
  entries: TriggeredEntry[];
  /** Injected entries whose keywords matched the current message; these renew keep-active. */
  matchedIds: number[];
}

/**
 * Extract keywords from stored entry keys and normalize them.
 * Returns a Set of lowercase keywords for fast O(1) lookup.
 */
export function parseKeywords(keyString: string): Set<string> {
  return new Set(parseKeywordList(keyString).map(k => k.toLowerCase()));
}

/**
 * Check if any keywords from the entry match text in the current message.
 * Case-insensitive substring match; multi-word keywords match as a phrase.
 */
export function entryMatches(entry: { keys: string }, messageText: string): boolean {
  const keywords = parseKeywords(entry.keys);
  if (keywords.size === 0) return false;

  const lowerMessage = messageText.toLowerCase();
  for (const keyword of keywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Entry IDs whose keywords matched within the last `keepActiveTurns` assistant replies.
 * Kept-active entries are not re-recorded as matches, so they expire unless their keywords come up again.
 */
export function recentlyMatchedLoreIds(
  history: ReadonlyArray<{ role: string; metadata?: string | null }>,
  keepActiveTurns: number,
): Set<number> {
  const ids = new Set<number>();
  if (keepActiveTurns <= 0) return ids;
  let turnsSeen = 0;
  for (let i = history.length - 1; i >= 0 && turnsSeen < keepActiveTurns; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    turnsSeen++;
    for (const id of getMatchedLoreIds(msg.metadata)) ids.add(id);
  }
  return ids;
}

function toTriggeredEntry(e: TriggeredEntry): TriggeredEntry {
  return { id: e.id, lorebookId: e.lorebookId, title: e.title, content: e.content, priority: e.priority, constant: e.constant };
}

const byPriority = (a: TriggeredEntry, b: TriggeredEntry) => b.priority - a.priority || a.id - b.id;

/**
 * Pick the non-constant entries that are active this turn (new keyword match or still kept active),
 * then fill the lore budget (characters of entry content) in priority order.
 */
export function selectActiveEntries(
  entries: ReadonlyArray<LoreEntryRow>,
  messageText: string,
  keptActiveIds: ReadonlySet<number>,
  loreLimit: number,
): ActiveLoreSelection {
  const matched = new Set<number>();
  const candidates: LoreEntryRow[] = [];
  for (const entry of entries) {
    if (entry.constant) continue;
    const isMatch = entryMatches(entry, messageText);
    if (isMatch) matched.add(entry.id);
    if (isMatch || keptActiveIds.has(entry.id)) candidates.push(entry);
  }
  candidates.sort(byPriority);

  const selected: TriggeredEntry[] = [];
  let used = 0;
  for (const entry of candidates) {
    if (used + entry.content.length > loreLimit) continue;
    used += entry.content.length;
    selected.push(toTriggeredEntry(entry));
  }

  return {
    entries: selected,
    matchedIds: selected.filter(e => matched.has(e.id)).map(e => e.id),
  };
}

/** Constant entries from linked lorebooks; the global lorebook is trigger-only. */
export function selectConstantEntries(entries: ReadonlyArray<LoreEntryRow>): TriggeredEntry[] {
  return entries
    .filter(e => e.constant && e.lorebookId !== GLOBAL_LOREBOOK_ID)
    .sort(byPriority)
    .map(toTriggeredEntry);
}
