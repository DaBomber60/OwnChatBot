import { useState, useEffect } from 'react';
import type { SessionData } from '../../types/models';

export interface UseSummaryReturn {
  showSummaryModal: boolean;
  setShowSummaryModal: (v: boolean) => void;
  summaryContent: string;
  setSummaryContent: (v: string) => void;
  savingSummary: boolean;
  generatingSummary: boolean;
  updatingSummary: boolean;
  saveSummary: () => Promise<void>;
  generateSummary: () => Promise<void>;
  updateSummary: () => Promise<void>;
  canUpdateSummary: () => boolean;
}

/**
 * Encapsulates all summary state and AI summary generation logic.
 * `onMutate` is called after server-side changes to trigger a session refresh.
 */
export function useSummary(
  session: SessionData | undefined,
  sessionId: string | string[] | undefined,
  onMutate: () => Promise<void>,
): UseSummaryReturn {
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryContent, setSummaryContent] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [updatingSummary, setUpdatingSummary] = useState(false);

  // Sync summary content when session data arrives/changes
  useEffect(() => {
    if (session?.summary) {
      setSummaryContent(session.summary);
    }
  }, [session?.summary]);

  const saveSummary = async () => {
    if (!sessionId) return;
    setSavingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summaryContent }),
      });
      if (!response.ok) throw new Error('Failed to save summary');
      await onMutate();
      setShowSummaryModal(false);
    } catch (error) {
      console.error('Failed to save summary:', error);
      alert('Failed to save summary. Please try again.');
    } finally {
      setSavingSummary(false);
    }
  };

  const generateSummary = async () => {
    if (!sessionId) return;
    setGeneratingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/generate-summary`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to generate summary');
      const data = await response.json();
      setSummaryContent(data.summary);
      await onMutate();
    } catch (error) {
      console.error('Failed to generate summary:', error);
      alert('Failed to generate summary. Please try again.');
    } finally {
      setGeneratingSummary(false);
    }
  };

  const updateSummary = async () => {
    if (!sessionId) return;
    setUpdatingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/update-summary`, {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update summary');
      }
      const data = await response.json();
      setSummaryContent(data.summary);
      await onMutate();
    } catch (error) {
      console.error('Failed to update summary:', error);
      alert(`Failed to update summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUpdatingSummary(false);
    }
  };

  const canUpdateSummary = () => {
    if (!session || !session.summary) return false;
    const lastSummaryId = session.lastSummary;
    if (!lastSummaryId) return false;
    return session.messages.some(msg => msg.id > lastSummaryId);
  };

  return {
    showSummaryModal,
    setShowSummaryModal,
    summaryContent,
    setSummaryContent,
    savingSummary,
    generatingSummary,
    updatingSummary,
    saveSummary,
    generateSummary,
    updateSummary,
    canUpdateSummary,
  };
}
