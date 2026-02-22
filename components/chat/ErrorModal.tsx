import React from 'react';
import { Modal } from '../Modal';

interface ErrorModalProps {
  apiErrorMessage: string;
  onDownloadRequest: () => void;
  onDownloadResponse: () => void;
  onClose: () => void;
}

export function ErrorModal({ apiErrorMessage, onDownloadRequest, onDownloadResponse, onClose }: ErrorModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="⚠️ API Error"
      maxWidth="560px"
      footer={
        <div className="flex gap-3 justify-center">
          <button className="btn btn-secondary" onClick={onDownloadRequest}>Download Last Request</button>
          <button className="btn btn-secondary" onClick={onDownloadResponse}>Download Last Response</button>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      }
    >
      <p className="mb-4">The API encountered an error.</p>
      <div className="card card-compact" style={{ background: 'var(--bg-tertiary)' }}>
        <code style={{ whiteSpace: 'pre-wrap' }}>{apiErrorMessage}</code>
      </div>
    </Modal>
  );
}
