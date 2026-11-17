import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Modal } from '../Modal';
import { strictFetcher } from '../../lib/fetcher';
import { GLOBAL_LOREBOOK_ID, LORE_PRIORITY_LABELS } from '../../lib/lorebook/constants';
import type { MessageLoreEntry, MessageLoreResponse } from '../../types/models';

/** Entries longer than this get a "Show full entry" toggle; the preview is clamped to three lines. */
const PREVIEW_CHARS = 200;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ReasonLine({ entry, keepActiveTurns }: { entry: MessageLoreEntry; keepActiveTurns: number }) {
  if (entry.reason === 'active') {
    return (
      <p className="lore-details-reason">
        ⏳ Still active: a keyword came up in a recent message, and entries stay for {plural(keepActiveTurns, 'reply', 'replies')}.
      </p>
    );
  }
  if (entry.matchedKeywords.length === 0) {
    return <p className="lore-details-reason">🔑 A keyword came up in the message this reply answers.</p>;
  }
  return (
    <div className="lore-details-reason">
      <span>🔑 Matched</span>
      {entry.matchedKeywords.map(keyword => <span key={keyword} className="lore-chip">{keyword}</span>)}
    </div>
  );
}

interface LoreDetailsModalProps {
  messageId: number;
  onClose: () => void;
}

/** What keyword-triggered lore went into one reply, and why each entry was included. */
export function LoreDetailsModal({ messageId, onClose }: LoreDetailsModalProps) {
  const { data, error } = useSWR<MessageLoreResponse>(`/api/messages/${messageId}/lore`, strictFetcher);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="📖 Lore in this reply"
      maxWidth="600px"
      footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {error ? (
        <p className="text-sm text-error">Couldn&apos;t load the lore for this reply: {error.message}</p>
      ) : !data ? (
        <p className="text-sm text-muted">Loading lore...</p>
      ) : (
        <>
          <p className="text-sm text-secondary lore-details-intro">
            {data.entries.length > 0
              ? `${plural(data.entries.length, 'keyword-triggered entry was', 'keyword-triggered entries were')} added to the prompt for this reply, in the order they were picked.`
              : 'The lore used for this reply is no longer available.'}
          </p>

          {data.entries.length > 0 && (
            <ul className="lore-details-list">
              {data.entries.map(entry => {
                const isExpanded = expanded.has(entry.id);
                const long = entry.content.length > PREVIEW_CHARS || entry.content.split('\n').length > 3;
                return (
                  <li key={entry.id} className="lore-details-entry">
                    <div className="lore-entry-title-row">
                      <h3 className="lore-entry-title">{entry.title}</h3>
                      <span className={`lore-badge${entry.priority === 'critical' ? ' lore-badge--critical' : ''}`}>
                        {LORE_PRIORITY_LABELS[entry.priority]}
                      </span>
                      {!entry.enabled && <span className="lore-badge lore-badge--disabled">⏸ Disabled since</span>}
                    </div>
                    <ReasonLine entry={entry} keepActiveTurns={data.keepActiveTurns} />
                    <p className={`lore-entry-preview${isExpanded ? ' is-expanded' : ''}`}>{entry.content}</p>
                    <div className="lore-details-footer">
                      {long && (
                        <button
                          type="button"
                          className="lore-details-toggle"
                          onClick={() => toggle(entry.id)}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? 'Show less' : 'Show full entry'}
                        </button>
                      )}
                      <Link href={`/lorebooks/${entry.lorebookId}`} className="lore-details-link">
                        {entry.lorebookId === GLOBAL_LOREBOOK_ID ? '🌐' : '📚'} {entry.lorebookName} →
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {data.missingCount > 0 && (
            <p className="text-xs text-muted lore-details-note">
              {plural(data.missingCount, 'entry', 'entries')} used for this reply {data.missingCount === 1 ? 'has' : 'have'} since been deleted.
            </p>
          )}
          <p className="text-xs text-muted lore-details-note">
            Always-included entries aren&apos;t listed here; they go into the system prompt for every reply.
          </p>
        </>
      )}
    </Modal>
  );
}
