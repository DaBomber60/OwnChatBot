import React from 'react';
import { Modal } from '../Modal';

interface SummaryModalProps {
  summaryContent: string;
  setSummaryContent: (v: string) => void;
  generateSummary: () => void;
  updateSummary: () => void;
  saveSummary: () => void;
  canUpdateSummary: () => boolean;
  generatingSummary: boolean;
  updatingSummary: boolean;
  savingSummary: boolean;
  session: { summary?: string; lastSummary?: number } | undefined;
  onClose: () => void;
}

export function SummaryModal({
  summaryContent, setSummaryContent,
  generateSummary, updateSummary, saveSummary, canUpdateSummary,
  generatingSummary, updatingSummary, savingSummary,
  session, onClose,
}: SummaryModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Chat Summary"
      footer={
        <>
          <div className="flex gap-3 flex-wrap mb-3">
            <button
              className="btn btn-secondary"
              onClick={generateSummary}
              disabled={generatingSummary}
              title={generatingSummary ? 'Generating summary...' : 'Generate AI summary of the conversation'}
            >
              {generatingSummary ? '⏳ Generating...' : '🤖 Generate Summary'}
            </button>
            <button
              className={`btn btn-secondary ${!canUpdateSummary() ? 'btn-disabled-muted' : ''}`}
              onClick={updateSummary}
              disabled={updatingSummary || !canUpdateSummary()}
              title={
                !session?.summary
                  ? 'Generate a summary first before updating'
                  : !session?.lastSummary
                    ? "No summary update point set. Use 'Generate Summary' first."
                    : !canUpdateSummary()
                      ? 'No new messages to update summary with'
                      : updatingSummary
                        ? 'Updating summary...'
                        : 'Update summary with new messages since last update'
              }
            >
              {updatingSummary ? '⏳ Updating...' : '🔄 Update Summary'}
            </button>
          </div>

          <div className="flex gap-3 flex-wrap">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={saveSummary} disabled={savingSummary}>
              {savingSummary ? 'Saving...' : 'Save Summary'}
            </button>
          </div>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">Summary Content</label>
        <textarea
          className="form-textarea"
          value={summaryContent}
          onChange={(e) => setSummaryContent(e.target.value)}
          placeholder="Enter a summary of this chat session..."
          rows={8}
          style={{ minHeight: '200px' }}
        />
      </div>
    </Modal>
  );
}
