import React from 'react';
import { Modal } from '../Modal';

interface ContextWarningModalProps {
  percentage: number;
  onClose: () => void;
  onOpenSummary: () => void;
}

export function ContextWarningModal({ percentage, onClose, onOpenSummary }: ContextWarningModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      title="This chat is nearly too big to fit"
      maxWidth="560px"
      footer={
        <div className="flex gap-3 justify-center">
          <button className="btn btn-primary" onClick={onOpenSummary}>Write the story so far</button>
          <button className="btn btn-secondary" onClick={onClose}>Not now</button>
        </div>
      }
    >
      <p className="mb-4">
        You are using about <strong>{percentage}%</strong> of the context window. Once it fills up,
        the oldest messages start getting left out of each request and the AI will begin losing
        track of how the story began.
      </p>
      <p>
        Now is a good moment to write a summary — &quot;the story so far&quot; — which keeps the early
        plot available in a fraction of the space. You will only see this notice once; afterwards
        you can check the state of things from the Warnings section of the chat menu.
      </p>
    </Modal>
  );
}
