import { getTriggeredLoreIds } from '../../lib/messageMetadata';

interface LoreTriggeredBadgeProps {
  /** JSON metadata from ChatMessage.metadata */
  metadata: string | null | undefined;
  /** Called when badge is clicked to show more details */
  onShowDetails?: () => void;
}

/**
 * Displays a badge when a message has triggered lore entries.
 * Shows a small icon with a tooltip and optional click handler.
 */
export function LoreTriggeredBadge({ metadata, onShowDetails }: LoreTriggeredBadgeProps) {
  const triggeredIds = getTriggeredLoreIds(metadata);
  
  if (triggeredIds.length === 0) {
    return null;
  }

  const label = triggeredIds.length === 1
    ? `Triggered 1 lore entry (ID: ${triggeredIds[0]})`
    : `Triggered ${triggeredIds.length} lore entries (IDs: ${triggeredIds.join(', ')})`;

  return (
    <button
      className="lore-triggered-badge"
      title={label}
      onClick={onShowDetails}
      aria-label={label}
      tabIndex={0}
    >
      📖
    </button>
  );
}
