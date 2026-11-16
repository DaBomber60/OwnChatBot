/**
 * Lore triggering logic: keyword matching and entry selection.
 */
import prisma from '../prisma';
import { GLOBAL_LOREBOOK_ID } from '../globalLorebook';

export interface TriggerContext {
  sessionId: number;
  characterId: number;
  /** Most recent user message to search for keywords. */
  currentMessageText: string;
  /** Previous messages to track keep-active state. */
  history: Array<{ role: string; content: string; triggeredLoreIds?: number[] }>;
  /** Configured number of turns to keep triggered entries active. */
  keepActiveTurns: number;
}

export interface TriggeredEntry {
  id: number;
  lorebookId: number;
  title: string;
  content: string;
  priority: number;
  constant: boolean;
}

/**
 * Extract keywords from a space-separated string and normalize them.
 * Returns a Set of lowercase keywords for fast O(1) lookup.
 */
export function parseKeywords(keyString: string): Set<string> {
  return new Set(
    keyString
      .split(/\s+/)
      .map(k => k.toLowerCase().trim())
      .filter(k => k.length > 0)
  );
}

/**
 * Check if any keywords from the entry match text in the current message.
 * Uses case-insensitive substring matching on individual words.
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
 * Collect lore entries that should be active for this turn:
 * 1. New matches from the current message
 * 2. Entries that were triggered in recent turns (keep-active)
 *
 * Returns entries sorted by priority (higher = more important).
 */
export async function collectActiveEntries(ctx: TriggerContext): Promise<TriggeredEntry[]> {
  // Load character-applied lorebooks
  const charLorebooks = await prisma.characterLorebook.findMany({
    where: { characterId: ctx.characterId },
    select: { lorebookId: true },
  });

  const lorebookIds = charLorebooks.map(cl => cl.lorebookId);

  // Load global lorebook if enabled for this session
  const globalEnabled = await isGlobalLoreEnabledForSession(ctx.sessionId);
  if (globalEnabled) {
    lorebookIds.push(GLOBAL_LOREBOOK_ID);
  }

  if (lorebookIds.length === 0) {
    return [];
  }

  // Load all entries from applicable lorebooks
  const entries = await prisma.loreEntry.findMany({
    where: {
      lorebookId: { in: lorebookIds },
      enabled: true,
    },
    select: {
      id: true,
      lorebookId: true,
      title: true,
      content: true,
      keys: true,
      constant: true,
      priority: true,
    },
  });

  // Collect IDs of entries triggered in recent turns
  const recentlyTriggeredIds = new Set<number>();
  const historyLength = ctx.history.length;
  
  for (let i = Math.max(0, historyLength - ctx.keepActiveTurns); i < historyLength; i++) {
    const msg = ctx.history[i];
    if (msg && msg.triggeredLoreIds) {
      msg.triggeredLoreIds.forEach(id => recentlyTriggeredIds.add(id));
    }
  }

  // Determine which entries are active this turn
  const newMatches = new Set<number>();
  const active: TriggeredEntry[] = [];

  for (const entry of entries) {
    const isNewMatch = entryMatches(entry, ctx.currentMessageText);
    const isRecentlyTriggered = recentlyTriggeredIds.has(entry.id);

    if (isNewMatch || isRecentlyTriggered) {
      if (isNewMatch) {
        newMatches.add(entry.id);
      }
      active.push({
        id: entry.id,
        lorebookId: entry.lorebookId,
        title: entry.title,
        content: entry.content,
        priority: entry.priority,
        constant: entry.constant,
      });
    }
  }

  // Sort by priority (higher priority first)
  active.sort((a, b) => b.priority - a.priority);

  return active;
}

/**
 * Get entries marked as constant (always included in system prompt).
 */
export async function collectConstantEntries(characterId: number): Promise<TriggeredEntry[]> {
  const charLorebooks = await prisma.characterLorebook.findMany({
    where: { characterId },
    select: { lorebookId: true },
  });

  const lorebookIds = charLorebooks.map(cl => cl.lorebookId);
  
  if (lorebookIds.length === 0) {
    return [];
  }

  const entries = await prisma.loreEntry.findMany({
    where: {
      lorebookId: { in: lorebookIds },
      constant: true,
      enabled: true,
    },
    select: {
      id: true,
      lorebookId: true,
      title: true,
      content: true,
      priority: true,
      constant: true,
    },
  });

  // Sort by priority
  entries.sort((a, b) => b.priority - a.priority);

  return entries as TriggeredEntry[];
}

/**
 * Check if global lore is enabled for a session.
 * Falls back to user-level default if no session override.
 */
async function isGlobalLoreEnabledForSession(sessionId: number): Promise<boolean> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { personaId: true },
  });

  if (!session) return false;

  // Check session-level setting first
  const sessionSetting = await prisma.setting.findUnique({
    where: { key: `globalLoreEnabled_session_${sessionId}` },
  });

  if (sessionSetting) {
    return sessionSetting.value === 'true';
  }

  // Fall back to user-level default
  const userSetting = await prisma.setting.findUnique({
    where: { key: `globalLoreEnabled_user_${session.personaId}` },
  });

  return userSetting ? userSetting.value === 'true' : true;
}
