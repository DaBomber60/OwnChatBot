/**
 * Lorebook read models for the management UI and pickers.
 */
import prisma from '../prisma';
import { GLOBAL_LOREBOOK_ID, priorityLevel } from './constants';
import { keywordMatches, parseKeywordList } from './keywords';
import { byPriorityThenTitle, byTitle } from './trigger';
import { getMatchedLoreIds, getTriggeredLoreIds } from '../messageMetadata';
import type { LoreEntry, LorebookDetail, LorebookSummary, MessageLoreEntry } from '../../types/models';

type LoreEntryRow = {
  id: number;
  lorebookId: number;
  title: string;
  content: string;
  keys: string;
  constant: boolean;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Lorebook IDs start at 0 (the global lorebook), so the shared positive-ID parser can't be used. */
export function parseLorebookId(raw: string | string[] | undefined): number | null {
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str || !/^\d{1,9}$/.test(str)) return null;
  return parseInt(str, 10);
}

/** API shape of an entry: keys as a list instead of the stored string. */
export function toLoreEntry(row: LoreEntryRow): LoreEntry {
  return {
    id: row.id,
    lorebookId: row.lorebookId,
    title: row.title,
    content: row.content,
    keys: parseKeywordList(row.keys),
    constant: row.constant,
    enabled: row.enabled,
    priority: priorityLevel(row.priority),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** All lorebooks with usage counts, global first, then by name. */
export async function listLorebookSummaries(): Promise<LorebookSummary[]> {
  const rows = await prisma.lorebook.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { entries: true, characters: true, sessions: true } },
    },
    orderBy: { name: 'asc' },
  });
  return rows
    .map(({ _count, ...lb }) => ({
      ...lb,
      entryCount: _count.entries,
      characterCount: _count.characters,
      chatCount: _count.sessions,
    }))
    .sort((a, b) => Number(b.id === GLOBAL_LOREBOOK_ID) - Number(a.id === GLOBAL_LOREBOOK_ID));
}

/** "Always" entries first (alphabetical), then keyword entries in the order they'd be picked. */
function entryDisplayOrder(a: LoreEntryRow, b: LoreEntryRow): number {
  if (a.constant !== b.constant) return a.constant ? -1 : 1;
  return a.constant ? byTitle(a, b) : byPriorityThenTitle(a, b);
}

/** One lorebook with its entries and where it's used, or null. */
export async function getLorebookDetail(id: number): Promise<LorebookDetail | null> {
  const lorebook = await prisma.lorebook.findUnique({
    where: { id },
    include: {
      entries: true,
      characters: {
        select: { character: { select: { id: true, name: true, profileName: true } } },
        orderBy: { id: 'asc' },
      },
      _count: { select: { sessions: true } },
    },
  });
  if (!lorebook) return null;

  return {
    id: lorebook.id,
    name: lorebook.name,
    description: lorebook.description,
    isGlobal: lorebook.id === GLOBAL_LOREBOOK_ID,
    entries: [...lorebook.entries].sort(entryDisplayOrder).map(toLoreEntry),
    characters: lorebook.characters.map(link => link.character),
    chatCount: lorebook._count.sessions,
    createdAt: lorebook.createdAt.toISOString(),
    updatedAt: lorebook.updatedAt.toISOString(),
  };
}

/**
 * The keyword-triggered entries recorded for one reply, in the order they were picked, with why each was
 * included. Null when the message doesn't exist.
 */
export async function getMessageLore(messageId: number): Promise<{ entries: MessageLoreEntry[]; missingCount: number } | null> {
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, sessionId: true, createdAt: true, metadata: true },
  });
  if (!message) return null;

  const triggeredIds = [...new Set(getTriggeredLoreIds(message.metadata))];
  if (triggeredIds.length === 0) return { entries: [], missingCount: 0 };
  const matchedIds = new Set(getMatchedLoreIds(message.metadata));

  const [rows, answeredMessage] = await Promise.all([
    prisma.loreEntry.findMany({
      where: { id: { in: triggeredIds } },
      include: { lorebook: { select: { name: true } } },
    }),
    // Keywords were matched against the user message this reply answered. A send and its reply can
    // share a millisecond, so ties fall back to id order.
    matchedIds.size === 0 ? null : prisma.chatMessage.findFirst({
      where: {
        sessionId: message.sessionId,
        role: 'user',
        OR: [
          { createdAt: { lt: message.createdAt } },
          { createdAt: message.createdAt, id: { lt: message.id } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { content: true },
    }),
  ]);

  const entries = [...rows].sort(byPriorityThenTitle).map(({ lorebook, ...row }): MessageLoreEntry => {
    const entry = toLoreEntry(row);
    const matched = matchedIds.has(row.id);
    return {
      ...entry,
      lorebookName: lorebook.name,
      reason: matched ? 'matched' : 'active',
      matchedKeywords: matched && answeredMessage
        ? entry.keys.filter(key => keywordMatches(key, answeredMessage.content)).map(key => key.text)
        : [],
    };
  });
  return { entries, missingCount: triggeredIds.length - rows.length };
}
