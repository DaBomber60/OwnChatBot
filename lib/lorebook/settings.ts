// Client-safe reading of the lore settings stored in the settings table (see lib/aiProvider for the server side).
import {
  DEFAULT_LORE_KEEP_ACTIVE_TURNS, DEFAULT_LORE_LIMIT,
  LORE_KEEP_ACTIVE_MAX, LORE_KEEP_ACTIVE_MIN, LORE_LIMIT_MAX, LORE_LIMIT_MIN,
} from './constants';

export interface LoreSettings {
  /** Character budget for keyword-triggered lore per reply. */
  loreLimit: number;
  /** Replies a triggered entry stays active after its keywords last came up. */
  keepActiveTurns: number;
  /** Whether new chats start with the global lorebook switched on. */
  globalLoreDefault: boolean;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function readLoreSettings(settings: Record<string, string> | null | undefined): LoreSettings {
  return {
    loreLimit: clampInt(settings?.loreLimit, LORE_LIMIT_MIN, LORE_LIMIT_MAX, DEFAULT_LORE_LIMIT),
    keepActiveTurns: clampInt(settings?.loreKeepActiveTurns, LORE_KEEP_ACTIVE_MIN, LORE_KEEP_ACTIVE_MAX, DEFAULT_LORE_KEEP_ACTIVE_TURNS),
    globalLoreDefault: settings?.globalLoreEnabled !== 'false',
  };
}
