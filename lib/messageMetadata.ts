/**
 * Utilities for working with chat message metadata.
 * Metadata is stored as JSON in the message.metadata field.
 */

export interface MessageMetadata {
  /** Trigger-type lore entries injected for this reply (keyword matches plus kept-active entries). */
  triggeredLoreIds?: number[];
  /** Entries whose keywords matched on this turn. Only these renew the keep-active window. */
  matchedLoreIds?: number[];
  [key: string]: unknown;
}

/**
 * Parse message metadata from JSON string.
 * Returns empty object if metadata is null/undefined or not a JSON object.
 */
export function parseMessageMetadata(metadataJson: string | null | undefined): MessageMetadata {
  if (!metadataJson || !metadataJson.trim()) return {};
  try {
    const parsed = JSON.parse(metadataJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn('Failed to parse message metadata:', err);
    return {};
  }
}

function idList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : [];
}

/**
 * Get triggered lore entry IDs from message metadata.
 */
export function getTriggeredLoreIds(metadataJson: string | null | undefined): number[] {
  return idList(parseMessageMetadata(metadataJson).triggeredLoreIds);
}

/**
 * Get the lore entry IDs whose keywords matched on this message's turn.
 */
export function getMatchedLoreIds(metadataJson: string | null | undefined): number[] {
  return idList(parseMessageMetadata(metadataJson).matchedLoreIds);
}

/**
 * Check if a message has any triggered lore entries.
 */
export function hasTriggeredLore(metadataJson: string | null | undefined): boolean {
  return getTriggeredLoreIds(metadataJson).length > 0;
}

/**
 * Create message metadata with triggered lore IDs.
 */
export function createMessageMetadata(triggeredLoreIds: number[] = [], matchedLoreIds: number[] = []): MessageMetadata {
  return {
    triggeredLoreIds,
    ...(matchedLoreIds.length > 0 ? { matchedLoreIds } : {}),
  };
}

/**
 * Serialized metadata for a new assistant message, or null when there is nothing worth storing.
 */
export function serializeLoreMetadata(triggeredLoreIds: number[], matchedLoreIds: number[]): string | null {
  if (triggeredLoreIds.length === 0 && matchedLoreIds.length === 0) return null;
  return JSON.stringify(createMessageMetadata(triggeredLoreIds, matchedLoreIds));
}

/**
 * Rewrite lore entry IDs through an old→new map (database import), dropping IDs that weren't imported.
 * Other metadata fields are kept as-is. Returns null for empty or unreadable metadata.
 */
export function remapLoreMetadata(
  metadataJson: string | null | undefined,
  entryIdMap: ReadonlyMap<number, number>,
): string | null {
  const metadata = parseMessageMetadata(metadataJson);
  if (Object.keys(metadata).length === 0) return null;

  const remap = (value: unknown) => idList(value)
    .map(id => entryIdMap.get(id))
    .filter((id): id is number => id !== undefined);

  const next: MessageMetadata = { ...metadata };
  if ('triggeredLoreIds' in metadata) next.triggeredLoreIds = remap(metadata.triggeredLoreIds);
  if ('matchedLoreIds' in metadata) next.matchedLoreIds = remap(metadata.matchedLoreIds);
  return JSON.stringify(next);
}
