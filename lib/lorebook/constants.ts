// Client-safe lorebook constants (no server imports).

/** The global lorebook: trigger-only lore available to every chat that hasn't switched it off. */
export const GLOBAL_LOREBOOK_ID = 0;

/** Character budget for keyword-triggered lore added to a single reply. */
export const DEFAULT_LORE_LIMIT = 20000;
export const LORE_LIMIT_MIN = 0;
export const LORE_LIMIT_MAX = 50000;

/** How many replies a triggered entry stays active after its keywords last came up. */
export const DEFAULT_LORE_KEEP_ACTIVE_TURNS = 5;
export const LORE_KEEP_ACTIVE_MIN = 0;
export const LORE_KEEP_ACTIVE_MAX = 20;

/** Keyword-entry priority, highest first. Stored as a number (see LORE_PRIORITY_VALUES); "Always" entries don't use it. */
export const LORE_PRIORITIES = ['critical', 'important', 'helpful', 'information', 'minor'] as const;
export type LorePriority = typeof LORE_PRIORITIES[number];

export const LORE_PRIORITY_VALUES: Record<LorePriority, number> = {
  critical: 400,
  important: 300,
  helpful: 200,
  information: 100,
  minor: 0,
};

export const LORE_PRIORITY_LABELS: Record<LorePriority, string> = {
  critical: 'Critical',
  important: 'Important',
  helpful: 'Helpful',
  information: 'Information',
  minor: 'Minor',
};

/** Matches the database column default (100). */
export const DEFAULT_LORE_PRIORITY: LorePriority = 'information';

/** Level for a stored number. Values between levels (older API data) round down to the level below. */
export function priorityLevel(value: number): LorePriority {
  return LORE_PRIORITIES.find(level => value >= LORE_PRIORITY_VALUES[level]) ?? 'minor';
}

/** Stored number for a level name, or a legacy number rounded down to its level. */
export function storedPriority(priority: LorePriority | number): number {
  return LORE_PRIORITY_VALUES[typeof priority === 'number' ? priorityLevel(priority) : priority];
}

/** 0 for critical through 4 for minor. */
export function priorityRank(value: number): number {
  return LORE_PRIORITIES.indexOf(priorityLevel(value));
}
