// Client-safe lorebook constants (no server imports).

/** The global lorebook: trigger-only lore available to every chat that hasn't switched it off. */
export const GLOBAL_LOREBOOK_ID = 0;

/** Character budget for keyword-triggered lore added to a single reply. */
export const DEFAULT_LORE_LIMIT = 4000;
export const LORE_LIMIT_MIN = 0;
export const LORE_LIMIT_MAX = 50000;

/** How many replies a triggered entry stays active after its keywords last came up. */
export const DEFAULT_LORE_KEEP_ACTIVE_TURNS = 3;
export const LORE_KEEP_ACTIVE_MIN = 0;
export const LORE_KEEP_ACTIVE_MAX = 20;

export const LORE_PRIORITY_MIN = 0;
export const LORE_PRIORITY_MAX = 1000;
export const DEFAULT_LORE_PRIORITY = 100;
