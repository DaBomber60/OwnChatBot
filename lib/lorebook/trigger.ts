/**
 * Lore triggering logic: keyword matching and entry selection.
 */
import { GLOBAL_LOREBOOK_ID, priorityLevel, priorityRank } from './constants';
import { keywordMatches, parseKeywordList } from './keywords';
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
  /** Entries to inject this turn: critical first, then by level and title, within the lore budget. */
  entries: TriggeredEntry[];
  /** Injected entries whose keywords matched the current message; these renew keep-active. */
  matchedIds: number[];
}

/**
 * Check if any of the entry's keywords appear in the current message.
 * Case-insensitive; each keyword is either a whole-word or part-word match (see keywordPattern).
 */
export function entryMatches(entry: { keys: string }, messageText: string): boolean {
  if (!messageText) return false;
  return parseKeywordList(entry.keys).some(keyword => keywordMatches(keyword, messageText));
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

const titleCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Alphabetical by title (case-insensitive), then by id so the order is always stable. */
export const byTitle = (a: { title: string; id: number }, b: { title: string; id: number }) =>
  titleCollator.compare(a.title, b.title) || a.id - b.id;

/** Critical first down to minor; alphabetical within a level. */
export const byPriorityThenTitle = (a: { priority: number; title: string; id: number }, b: { priority: number; title: string; id: number }) =>
  priorityRank(a.priority) - priorityRank(b.priority) || byTitle(a, b);

/**
 * Pick the non-constant entries that are active this turn (new keyword match or still kept active),
 * then fill the lore budget (characters of entry content). Critical entries are always included, even
 * past the budget, and count toward it; the rest go in level order, alphabetically within a level,
 * skipping any that no longer fit.
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
  candidates.sort(byPriorityThenTitle);

  const selected: TriggeredEntry[] = [];
  let used = 0;
  for (const entry of candidates) {
    const critical = priorityLevel(entry.priority) === 'critical';
    if (!critical && used + entry.content.length > loreLimit) continue;
    used += entry.content.length;
    selected.push(toTriggeredEntry(entry));
  }

  return {
    entries: selected,
    matchedIds: selected.filter(e => matched.has(e.id)).map(e => e.id),
  };
}

/** Constant ("Always") entries from linked lorebooks, alphabetically; the global lorebook is trigger-only. */
export function selectConstantEntries(entries: ReadonlyArray<LoreEntryRow>): TriggeredEntry[] {
  return entries
    .filter(e => e.constant && e.lorebookId !== GLOBAL_LOREBOOK_ID)
    .sort(byTitle)
    .map(toTriggeredEntry);
}
