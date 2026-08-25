import React, { useState } from 'react';
import { Modal } from './Modal';
import { useToast } from './ToastProvider';
import { downloadSessionLog, type DebugLogKind } from '../lib/chat/debugDownload';
import type { ChatErrorCopy } from '../lib/chat/errorCopy';

interface ErrorModalProps {
  error: ChatErrorCopy;
  onClose: () => void;
  /** Enables the debug downloads; they read the last request/response for this session. */
  sessionId?: number | string;
  devMode?: boolean;
  /** Shown as the primary action when the failure is worth another attempt. */
  onRetry?: () => void;
}

export function ErrorModal({ error, onClose, sessionId, devMode, onRetry }: ErrorModalProps) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<DebugLogKind | null>(null);
  const canDownload = devMode && sessionId != null;

  const download = async (kind: DebugLogKind) => {
    if (sessionId == null) return;
    setBusy(kind);
    const failure = await downloadSessionLog(kind, sessionId);
    if (failure) showToast(failure, 'error');
    setBusy(null);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={error.title}
      maxWidth="560px"
      footer={
        <div className="flex gap-3 justify-center">
          {onRetry && <button className="btn btn-primary" onClick={onRetry}>Retry</button>}
          <button className={onRetry ? 'btn btn-secondary' : 'btn btn-primary'} onClick={onClose}>Close</button>
        </div>
      }
    >
      <p className="mb-4">{error.body}</p>
      {error.detail && (
        <div className="card card-compact error-details">
          <code>{error.detail}</code>
        </div>
      )}
      {canDownload && (
        <div className="error-debug">
          <p className="error-debug__label">Debug data</p>
          <div className="error-debug__actions">
            <button className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => download('request')}>
              {busy === 'request' ? 'Preparing…' : 'Last request'}
            </button>
            <button className="btn btn-secondary btn-small" disabled={busy !== null} onClick={() => download('response')}>
              {busy === 'response' ? 'Preparing…' : 'Last response'}
            </button>
          </div>
          <p className="error-debug__hint">
            The request is what we sent the model; the response is what came back. Both are JSON and
            safe to attach to a bug report.
          </p>
        </div>
      )}
    </Modal>
  );
}
