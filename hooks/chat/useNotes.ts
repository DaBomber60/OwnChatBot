import { useState, useEffect } from 'react';

export interface UseNotesReturn {
  showNotesModal: boolean;
  setShowNotesModal: (v: boolean) => void;
  notesContent: string;
  setNotesContent: (v: string) => void;
  originalNotesContent: string;
  setOriginalNotesContent: (v: string) => void;
  savingNotes: boolean;
  loadNotes: () => Promise<void>;
  saveNotes: () => Promise<void>;
  cancelNotesChanges: () => void;
  hasNotesChanges: () => boolean;
}

/**
 * Encapsulates all notes state and CRUD logic for a chat session.
 * Auto-loads notes when `sessionId` changes.
 */
export function useNotes(sessionId: string | string[] | undefined): UseNotesReturn {
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesContent, setNotesContent] = useState('');
  const [originalNotesContent, setOriginalNotesContent] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const loadNotes = async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/sessions/${sessionId}/notes`);
      if (response.ok) {
        const data = await response.json();
        const notes = data.notes || '';
        setNotesContent(notes);
        setOriginalNotesContent(notes);
      } else if (response.status !== 404) {
        console.error('Failed to load notes:', response.status);
      }
    } catch (error) {
      console.error('Failed to load notes:', error);
    }
  };

  // Auto-load notes when session id is available / changes
  useEffect(() => {
    if (sessionId) {
      loadNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const saveNotes = async () => {
    if (!sessionId) return;
    setSavingNotes(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesContent }),
      });
      if (!response.ok) throw new Error('Failed to save notes');
      setOriginalNotesContent(notesContent);
    } catch (error) {
      console.error('Failed to save notes:', error);
      alert('Failed to save notes. Please try again.');
    } finally {
      setSavingNotes(false);
    }
  };

  const cancelNotesChanges = () => {
    setNotesContent(originalNotesContent);
  };

  const hasNotesChanges = () => notesContent !== originalNotesContent;

  return {
    showNotesModal,
    setShowNotesModal,
    notesContent,
    setNotesContent,
    originalNotesContent,
    setOriginalNotesContent,
    savingNotes,
    loadNotes,
    saveNotes,
    cancelNotesChanges,
    hasNotesChanges,
  };
}
