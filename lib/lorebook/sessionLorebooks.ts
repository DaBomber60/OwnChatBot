/**
 * Chat ↔ lorebook links.
 *
 * Each chat owns its set of lorebooks (chat_session_lorebooks). Character links are only defaults:
 * they are copied into a chat when it is created, after which the chat's set is edited independently.
 * The global lorebook (ID 0) is never stored as a link; it is controlled by chat_sessions.globalLoreEnabled.
 */
import prisma from '../prisma';
import { getDefaultGlobalLoreEnabled } from '../globalLorebook';
import { GLOBAL_LOREBOOK_ID } from './constants';

export interface SessionLoreConfig {
  lorebookIds: number[];
  globalLoreEnabled: boolean;
}

/** Deduplicate and drop anything that isn't a positive integer (this also excludes the global lorebook). */
export function normalizeLorebookIds(ids: readonly unknown[] | null | undefined): number[] {
  if (!ids) return [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) seen.add(id);
  }
  return [...seen];
}

/** Lorebooks whose trigger entries can fire in a chat: its linked lorebooks plus the global one when enabled. */
export function triggerLorebookIds(config: SessionLoreConfig): number[] {
  const ids = normalizeLorebookIds(config.lorebookIds);
  return config.globalLoreEnabled ? [...ids, GLOBAL_LOREBOOK_ID] : ids;
}

/** Keep only IDs that exist, preserving input order. */
export async function filterExistingLorebookIds(ids: number[]): Promise<number[]> {
  const normalized = normalizeLorebookIds(ids);
  if (normalized.length === 0) return [];
  const rows = await prisma.lorebook.findMany({
    where: { id: { in: normalized } },
    select: { id: true },
  });
  const existing = new Set(rows.map(r => r.id));
  return normalized.filter(id => existing.has(id));
}

export async function getCharacterDefaultLorebookIds(characterId: number): Promise<number[]> {
  const links = await prisma.characterLorebook.findMany({
    where: { characterId },
    select: { lorebookId: true },
    orderBy: { id: 'asc' },
  });
  return normalizeLorebookIds(links.map(l => l.lorebookId));
}

/**
 * Work out a new chat's lorebooks. Explicit `lorebookIds` replace the character defaults entirely,
 * since the user may have removed defaults or added other lorebooks while creating the chat.
 */
export async function resolveInitialSessionLore(
  characterId: number,
  requested: Partial<SessionLoreConfig> = {},
): Promise<SessionLoreConfig> {
  const candidateIds = requested.lorebookIds === undefined
    ? await getCharacterDefaultLorebookIds(characterId)
    : requested.lorebookIds;
  const lorebookIds = await filterExistingLorebookIds(candidateIds);
  const globalLoreEnabled = requested.globalLoreEnabled ?? await getDefaultGlobalLoreEnabled();
  return { lorebookIds, globalLoreEnabled };
}

/** Fields to spread into `chatSession.create({ data })` so the links are created with the chat. */
export function sessionLoreCreateData(config: SessionLoreConfig) {
  return {
    globalLoreEnabled: config.globalLoreEnabled,
    ...(config.lorebookIds.length > 0
      ? { lorebooks: { create: config.lorebookIds.map(lorebookId => ({ lorebookId })) } }
      : {}),
  };
}

/**
 * Database import: the (exported, pre-remap) lorebook IDs for each exported chat.
 * Exports made before chat-level links existed only carry character links, so — like the
 * migration backfill — each chat falls back to its character's lorebooks.
 */
export function exportedSessionLorebookLookup(data: {
  sessionLorebooks?: ReadonlyArray<{ sessionId: number; lorebookId: number }>;
  characterLorebooks?: ReadonlyArray<{ characterId: number; lorebookId: number }>;
}): (session: { id: number; characterId: number }) => number[] {
  const group = <T>(rows: ReadonlyArray<T>, key: (row: T) => number, value: (row: T) => number) => {
    const map = new Map<number, number[]>();
    for (const row of rows) {
      const bucket = map.get(key(row));
      if (bucket) bucket.push(value(row));
      else map.set(key(row), [value(row)]);
    }
    return map;
  };

  if (Array.isArray(data.sessionLorebooks)) {
    const bySession = group(data.sessionLorebooks, r => r.sessionId, r => r.lorebookId);
    return session => bySession.get(session.id) ?? [];
  }
  const byCharacter = group(data.characterLorebooks ?? [], r => r.characterId, r => r.lorebookId);
  return session => byCharacter.get(session.characterId) ?? [];
}

export async function getSessionLoreConfig(sessionId: number): Promise<SessionLoreConfig | null> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: {
      globalLoreEnabled: true,
      lorebooks: { select: { lorebookId: true }, orderBy: { id: 'asc' } },
    },
  });
  if (!session) return null;
  return {
    lorebookIds: normalizeLorebookIds(session.lorebooks.map(l => l.lorebookId)),
    globalLoreEnabled: session.globalLoreEnabled,
  };
}

/**
 * Replace a chat's lorebook set (and optionally its global toggle). Unknown lorebook IDs are ignored.
 * Returns the stored config, or null when the session doesn't exist.
 */
export async function setSessionLore(
  sessionId: number,
  update: { lorebookIds: number[]; globalLoreEnabled?: boolean },
): Promise<SessionLoreConfig | null> {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!session) return null;

  const lorebookIds = await filterExistingLorebookIds(update.lorebookIds);
  await prisma.$transaction([
    prisma.chatSessionLorebook.deleteMany({
      where: { sessionId, lorebookId: { notIn: lorebookIds } },
    }),
    prisma.chatSessionLorebook.createMany({
      data: lorebookIds.map(lorebookId => ({ sessionId, lorebookId })),
      skipDuplicates: true,
    }),
    ...(update.globalLoreEnabled === undefined
      ? []
      : [prisma.chatSession.update({ where: { id: sessionId }, data: { globalLoreEnabled: update.globalLoreEnabled } })]),
  ]);

  return getSessionLoreConfig(sessionId);
}

/**
 * Replace a character's default lorebooks. When `applyToExistingChats` is set, lorebooks that were
 * newly added as defaults are also attached to every existing chat with that character (one-time).
 * Returns null when the character doesn't exist.
 */
export async function setCharacterDefaultLorebooks(
  characterId: number,
  requestedIds: number[],
  applyToExistingChats = false,
): Promise<{ lorebookIds: number[]; addedIds: number[]; chatsUpdated: number } | null> {
  const character = await prisma.character.findUnique({ where: { id: characterId }, select: { id: true } });
  if (!character) return null;

  const lorebookIds = await filterExistingLorebookIds(requestedIds);
  const previous = new Set(await getCharacterDefaultLorebookIds(characterId));
  const addedIds = lorebookIds.filter(id => !previous.has(id));

  await prisma.$transaction([
    prisma.characterLorebook.deleteMany({
      where: { characterId, lorebookId: { notIn: lorebookIds } },
    }),
    prisma.characterLorebook.createMany({
      data: lorebookIds.map(lorebookId => ({ characterId, lorebookId })),
      skipDuplicates: true,
    }),
  ]);

  let chatsUpdated = 0;
  if (applyToExistingChats && addedIds.length > 0) {
    const sessions = await prisma.chatSession.findMany({ where: { characterId }, select: { id: true } });
    if (sessions.length > 0) {
      await prisma.chatSessionLorebook.createMany({
        data: sessions.flatMap(s => addedIds.map(lorebookId => ({ sessionId: s.id, lorebookId }))),
        skipDuplicates: true,
      });
      chatsUpdated = sessions.length;
    }
  }

  return { lorebookIds, addedIds, chatsUpdated };
}
