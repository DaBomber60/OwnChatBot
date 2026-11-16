/**
 * Global lorebook helpers
 *
 * The global lorebook (ID 0) holds trigger-only lore that applies to every chat.
 * Each chat can switch it off via chat_sessions.globalLoreEnabled.
 */

import prisma from './prisma';
import { GLOBAL_LOREBOOK_ID } from './lorebook/constants';

export { GLOBAL_LOREBOOK_ID };

/**
 * Whether new chats start with the global lorebook enabled.
 * Reads the user-level `globalLoreEnabled` setting; defaults to true when unset or unreadable.
 */
export async function getDefaultGlobalLoreEnabled(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: 'globalLoreEnabled' } });
    return row?.value !== 'false';
  } catch (error) {
    console.error('[globalLore] Error reading default global lore setting:', error);
    return true;
  }
}

/**
 * Check if global lore is enabled for a specific session. Returns null when the session doesn't exist.
 */
export async function isGlobalLoreEnabledForSession(sessionId: number): Promise<boolean | null> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    select: { globalLoreEnabled: true },
  });
  return session ? session.globalLoreEnabled : null;
}

/**
 * Set global lore enabled/disabled for a specific session.
 * Returns false when the session doesn't exist.
 */
export async function setGlobalLoreEnabledForSession(sessionId: number, enabled: boolean): Promise<boolean> {
  const result = await prisma.chatSession.updateMany({
    where: { id: sessionId },
    data: { globalLoreEnabled: enabled },
  });
  return result.count > 0;
}

/**
 * Get the global lorebook (ID 0).
 */
export async function getGlobalLorebook() {
  return prisma.lorebook.findUnique({
    where: { id: GLOBAL_LOREBOOK_ID },
    include: {
      entries: {
        where: { enabled: true },
        orderBy: { priority: 'desc' }
      }
    }
  });
}
