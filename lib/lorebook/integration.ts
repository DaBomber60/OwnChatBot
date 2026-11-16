/**
 * Integration point: resolves a chat's lore for one turn (DB access lives here; selection is pure in trigger.ts).
 */
import prisma from '../prisma';
import { selectActiveEntries, selectConstantEntries, recentlyMatchedLoreIds, type LoreEntryRow, type TriggeredEntry } from './trigger';
import { triggerLorebookIds, type SessionLoreConfig } from './sessionLorebooks';

export interface LoreForTurn {
  /** Permanent entries for the system prompt (never from the global lorebook). */
  constantEntries: TriggeredEntry[];
  /** Keyword-triggered and kept-active entries for the latest user message. */
  triggeredEntries: TriggeredEntry[];
  /** Triggered entries whose keywords matched this turn. */
  matchedIds: number[];
}

export const EMPTY_LORE: LoreForTurn = { constantEntries: [], triggeredEntries: [], matchedIds: [] };

export interface LoreTurnContext {
  config: SessionLoreConfig;
  /** DB history, oldest first; assistant metadata drives keep-active. */
  history: ReadonlyArray<{ role: string; metadata?: string | null }>;
  /** Text matched against entry keywords (the latest real user message). */
  currentMessageText: string;
  keepActiveTurns: number;
  loreLimit: number;
}

export async function loadLoreEntries(lorebookIds: number[]): Promise<LoreEntryRow[]> {
  if (lorebookIds.length === 0) return [];
  return prisma.loreEntry.findMany({
    where: { lorebookId: { in: lorebookIds }, enabled: true },
    select: { id: true, lorebookId: true, title: true, content: true, keys: true, constant: true, priority: true },
  });
}

/** Resolve all lore for one turn of a chat with a single entry query. */
export async function resolveLoreForTurn(ctx: LoreTurnContext): Promise<LoreForTurn> {
  const entries = await loadLoreEntries(triggerLorebookIds(ctx.config));
  if (entries.length === 0) return EMPTY_LORE;

  const { entries: triggeredEntries, matchedIds } = selectActiveEntries(
    entries,
    ctx.currentMessageText,
    recentlyMatchedLoreIds(ctx.history, ctx.keepActiveTurns),
    ctx.loreLimit,
  );
  return { constantEntries: selectConstantEntries(entries), triggeredEntries, matchedIds };
}

/** The latest user message in a history, which is what keywords are matched against. */
export function latestUserMessageText(history: ReadonlyArray<{ role: string; content: string }>): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'user') return history[i]!.content;
  }
  return '';
}

/** Like resolveLoreForTurn, but never throws: chat generation continues without lore on failure. */
export async function resolveLoreForTurnSafe(ctx: LoreTurnContext, label: string): Promise<LoreForTurn> {
  try {
    return await resolveLoreForTurn(ctx);
  } catch (err) {
    console.warn(`${label} Failed to resolve lore, continuing without it:`, err);
    return EMPTY_LORE;
  }
}
