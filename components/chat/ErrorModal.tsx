import React from 'react';
import { Modal } from '../Modal';
import type { ChatErrorCopy } from '../../lib/chat/errorCopy';

interface ErrorModalProps {
  error: ChatErrorCopy;
  onDownloadRequest: () => void;
  onDownloadResponse: () => void;
  onClose: () => void;
  devMode?: boolean;
}

export function ErrorModal({ error, onDownloadRequest, onDownloadResponse, onClose, devMode }: ErrorModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title={error.title}
      maxWidth="560px"
      footer={
        <div className="flex gap-3 justify-center">
          {devMode && <button className="btn btn-secondary" onClick={onDownloadRequest}>Download Last Request</button>}
          {devMode && <button className="btn btn-secondary" onClick={onDownloadResponse}>Download Last Response</button>}
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      }
    >
      <p className="mb-4">{error.body}</p>
      {error.detail && (
        <div className="card card-compact error-details">
          <code>{error.detail}</code>
        </div>
      )}
    </Modal>
  );
}
