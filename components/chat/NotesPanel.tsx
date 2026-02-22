import React from 'react';
import { Modal } from '../Modal';

interface NotesPanelProps {
  notesContent: string;
  setNotesContent: (v: string) => void;
  savingNotes: boolean;
  saveNotes: () => void;
  cancelNotesChanges: () => void;
  hasNotesChanges: () => boolean;
  isWideScreen: boolean;
  onClose: () => void;
}

/** Shared footer buttons for both overlay and sidecar variants. */
function NotesFooter({ hasNotesChanges, cancelNotesChanges, saveNotes, savingNotes, onClose }: Pick<NotesPanelProps, 'hasNotesChanges' | 'cancelNotesChanges' | 'saveNotes' | 'savingNotes' | 'onClose'>) {
  return (
    <div className="flex gap-3 flex-wrap mb-3">
      {hasNotesChanges() ? (
        <>
          <button className="btn btn-secondary" onClick={cancelNotesChanges}>Cancel Changes</button>
          <button className="btn btn-primary" onClick={saveNotes} disabled={savingNotes}>
            {savingNotes ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      ) : (
        <>
          <button className="btn btn-primary" onClick={onClose}>Close</button>
          <button className="btn btn-secondary btn-disabled-muted" disabled>No Changes</button>
        </>
      )}
    </div>
  );
}

/** Notes overlay modal for narrow screens. */
export function NotesOverlayModal(props: NotesPanelProps) {
  if (props.isWideScreen) return null;
  return (
    <Modal
      open
      onClose={props.onClose}
      title="Chat Notes"
      overlayClassName="notes-modal-overlay"
      contentClassName="notes-modal"
      footer={<NotesFooter {...props} />}
    >
      <div className="form-group">
        <label className="form-label">Personal Notes</label>
        <textarea
          className="form-textarea"
          value={props.notesContent}
          onChange={(e) => props.setNotesContent(e.target.value)}
          placeholder="Write your personal notes here... These are private and never sent to the AI."
          rows={12}
          style={{ minHeight: '300px' }}
        />
        <div className="text-xs text-muted mt-1">
          💡 Use this space to keep track of important details, ideas, or context as you chat.
        </div>
      </div>
    </Modal>
  );
}

/** Notes sidecar panel for wide screens. */
export function NotesSidecar(props: NotesPanelProps) {
  if (!props.isWideScreen) return null;
  return (
    <div className="notes-modal-sidecar">
      <div className="modal-header">
        <h2 className="modal-title">Chat Notes</h2>
      </div>
      <div className="modal-body">
        <div className="form-group">
          <label className="form-label">Personal Notes</label>
          <textarea
            className="form-textarea"
            value={props.notesContent}
            onChange={(e) => props.setNotesContent(e.target.value)}
            placeholder="Write your personal notes here... These are private and never sent to the AI."
          />
          <div className="text-xs text-muted mt-1">
            💡 Use this space to keep track of important details, ideas, or context as you chat.
          </div>
        </div>
      </div>
      <NotesFooter {...props} />
    </div>
  );
}
