import React from 'react';
import { Modal } from '../Modal';

export interface TruncationInfo {
  wasTruncated: boolean;
  sentCount?: number;
  baseCount?: number;
  truncationLimit?: number;
}

interface TruncationModalProps {
  info: TruncationInfo;
  onClose: () => void;
  onOpenSummary: () => void;
}

export function TruncationModal({ info, onClose, onOpenSummary }: TruncationModalProps) {
  const removed = info.baseCount != null && info.sentCount != null
    ? Math.max(0, info.baseCount - info.sentCount)
    : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Truncation is active"
      maxWidth="560px"
      footer={
        <div className="flex gap-3 justify-center">
          <button className="btn btn-primary" onClick={onOpenSummary}>Write a summary</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      }
    >
      <p className="mb-4">
        This chat is longer than the model can read in one go, so the oldest messages are left out
        of each request. Nothing has been deleted — your full history is still here, the AI just
        cannot see all of it at once.
      </p>
      <div className="card card-compact mb-4">
        {removed !== null && info.baseCount != null ? (
          <p className="truncation-stat">
            <strong>{removed}</strong> of <strong>{info.baseCount}</strong> messages were left out
            of the most recent request.
          </p>
        ) : (
          <p className="truncation-stat">Older messages were left out of the most recent request.</p>
        )}
        {info.truncationLimit != null && (
          <p className="truncation-stat truncation-stat--muted">
            Current limit: {info.truncationLimit.toLocaleString()} characters (Max Characters in Settings).
          </p>
        )}
      </div>
      <p>
        Writing a summary keeps the earlier plot available to the AI in a fraction of the space.
        Raising Max Characters in Settings also helps, if your model supports a larger context.
      </p>
    </Modal>
  );
}
