import React from 'react';

interface ErrorModalProps {
  apiErrorMessage: string;
  onDownloadRequest: () => void;
  onDownloadResponse: () => void;
  onClose: () => void;
}

export function ErrorModal({ apiErrorMessage, onDownloadRequest, onDownloadResponse, onClose }: ErrorModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '560px' }}>
        <div className="modal-header">
          <h2 className="modal-title">⚠️ API Error</h2>
        </div>

        <div className="modal-body">
          <p className="mb-4">The API encountered an error.</p>
          <div className="card card-compact" style={{ background: 'var(--bg-tertiary)' }}>
            <code style={{ whiteSpace: 'pre-wrap' }}>{apiErrorMessage}</code>
          </div>
        </div>

        <div className="modal-footer">
          <div className="flex gap-3 justify-center">
            <button className="btn btn-secondary" onClick={onDownloadRequest}>Download Last Request</button>
            <button className="btn btn-secondary" onClick={onDownloadResponse}>Download Last Response</button>
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
