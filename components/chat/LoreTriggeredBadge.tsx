import { getTriggeredLoreIds } from '../../lib/messageMetadata';

interface LoreTriggeredBadgeProps {
  /** JSON metadata from ChatMessage.metadata */
  metadata: string | null | undefined;
  /** Opens the details of the lore used for this reply. */
  onShowDetails: () => void;
}

/**
 * Message action button shown when keyword-triggered lore was added to a reply.
 * Renders nothing when no lore was used.
 */
export function LoreTriggeredBadge({ metadata, onShowDetails }: LoreTriggeredBadgeProps) {
  const count = new Set(getTriggeredLoreIds(metadata)).size;
  if (count === 0) return null;

  return (
    <button
      type="button"
      className="lore-btn"
      onClick={onShowDetails}
      aria-haspopup="dialog"
      aria-label={`Lore used in this reply: ${count} ${count === 1 ? 'entry' : 'entries'}. Show details`}
    >
      📖
    </button>
  );
}
