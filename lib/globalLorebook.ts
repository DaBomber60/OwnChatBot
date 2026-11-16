/**
 * Global lorebook helpers
 * 
 * The global lorebook (ID 0) applies to all chats by default but can be disabled per-chat.
 * This module provides utilities for checking if global lore is enabled.
 */

import prisma from './prisma';

export const GLOBAL_LOREBOOK_ID = 0;

/**
 * Check if global lore is enabled for a specific session.
 * 
 * Checks in order:
 * 1. Session-level override: `globalLoreEnabled_{sessionId}`
 * 2. User-level default: `globalLoreEnabled`
 * 3. System default: true
 * 
 * This is efficient because it uses exact key lookups (indexed) instead of LIKE scans.
 */
export async function isGlobalLoreEnabledForSession(sessionId: number): Promise<boolean> {
  try {
    // Check session-level override first (exact key lookup - O(1))
    const sessionOverride = await prisma.setting.findUnique({
      where: { key: `globalLoreEnabled_${sessionId}` }
    });
    if (sessionOverride !== null) {
      return sessionOverride.value === 'true';
    }

    // Fall back to user-level default (exact key lookup - O(1))
    const userDefault = await prisma.setting.findUnique({
      where: { key: 'globalLoreEnabled' }
    });
    // Default to true if not set
    return userDefault?.value !== 'false';
  } catch (error) {
    console.error('[globalLore] Error checking if global lore is enabled:', error);
    // Default to true if there's a database error
    return true;
  }
}

/**
 * Set global lore enabled/disabled for a specific session.
 * Pass null to remove the session override and use user-level default.
 */
export async function setGlobalLoreEnabledForSession(
  sessionId: number,
  enabled: boolean | null
): Promise<void> {
  const key = `globalLoreEnabled_${sessionId}`;
  
  if (enabled === null) {
    // Remove the override
    await prisma.setting.delete({ where: { key } }).catch(() => {
      // Ignore if key doesn't exist
    });
  } else {
    // Upsert the setting
    await prisma.setting.upsert({
      where: { key },
      update: { value: enabled ? 'true' : 'false' },
      create: { key, value: enabled ? 'true' : 'false' }
    });
  }
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
