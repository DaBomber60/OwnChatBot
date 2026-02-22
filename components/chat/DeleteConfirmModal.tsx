import React from 'react';
import type { ChatMessage } from '../../types/models';
import { Modal } from '../Modal';

interface DeleteConfirmModalProps {
  messages: ChatMessage[];
  deleteMessageIndex: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmModal({ messages, deleteMessageIndex, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const messageCount = messages.length - deleteMessageIndex;
  return (
    <Modal
      open
      onClose={onCancel}
      title="🗑️ Delete Message"
      maxWidth="500px"
      footer={
        <div className="flex gap-3 justify-center">
          <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>
            Delete {messageCount === 1 ? 'Message' : 'Messages'}
          </button>
        </div>
      }
    >
      <div className="text-center">
        <p className="mb-4">
          {messageCount === 1
            ? 'Are you sure you want to delete this message?'
            : `Are you sure you want to delete this message and ${messageCount - 1} subsequent message(s)?`}
        </p>
        <div className="text-sm text-muted mb-4">
          <strong>⚠️ This action cannot be undone.</strong>
        </div>
        {messageCount > 1 && (
          <div className="warning-box">
            💡 Deleting this message will also remove all messages that come after it in the conversation.
          </div>
        )}
      </div>
    </Modal>
  );
}
