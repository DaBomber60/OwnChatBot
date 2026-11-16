/**
 * Lorebook read models for the management UI and pickers.
 */
import prisma from '../prisma';
import { GLOBAL_LOREBOOK_ID, priorityLevel } from './constants';
import { parseKeywordList } from './keywords';
import { byPriorityThenTitle, byTitle } from './trigger';
import type { LoreEntry, LorebookDetail, LorebookSummary } from '../../types/models';

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
