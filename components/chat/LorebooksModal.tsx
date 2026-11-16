import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Modal } from '../Modal';
import { LorebookPicker } from '../LorebookPicker';
import { useToast } from '../ToastProvider';
import { fetcher } from '../../lib/fetcher';
import { extractErrorFromResponse } from '../../lib/chat/errorUtils';
import type { LorebookSummary, SessionLorebooksResponse } from '../../types/models';

interface LorebooksModalProps {
  sessionId: number;
  onClose: () => void;
}

/** Add or remove the lorebooks attached to one chat, including its global lorebook toggle. */
export function LorebooksModal({ sessionId, onClose }: LorebooksModalProps) {
  const { showToast } = useToast();
  const { data: lorebooks } = useSWR<LorebookSummary[]>('/api/lorebooks?view=summary', fetcher);
  const { data: current, mutate } = useSWR<SessionLorebooksResponse>(`/api/sessions/${sessionId}/lorebooks`, fetcher);
  const [draft, setDraft] = useState<{ lorebookIds: number[]; globalLoreEnabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (current && !draft) setDraft({ lorebookIds: current.lorebookIds, globalLoreEnabled: current.globalLoreEnabled });
  }, [current, draft]);

  const dirty = !!current && !!draft && (
    draft.globalLoreEnabled !== current.globalLoreEnabled
    || draft.lorebookIds.length !== current.lorebookIds.length
    || draft.lorebookIds.some(id => !current.lorebookIds.includes(id))
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/lorebooks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(extractErrorFromResponse(errData, res.statusText));
      }
      await mutate();
      showToast('Lorebooks updated', 'success');
      onClose();
    } catch (err) {
      showToast(`Could not update lorebooks: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="📖 Chat Lorebooks"
      maxWidth="560px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <p className="text-sm text-secondary mb-4">
        Constant entries from these lorebooks go into the system prompt; other entries are added when their keywords come up.
      </p>
      {draft ? (
        <LorebookPicker
          lorebooks={lorebooks}
          selectedIds={draft.lorebookIds}
          onChange={lorebookIds => setDraft(d => (d ? { ...d, lorebookIds } : d))}
          defaultIds={current?.characterDefaultIds}
          globalLoreEnabled={draft.globalLoreEnabled}
          onGlobalLoreChange={globalLoreEnabled => setDraft(d => (d ? { ...d, globalLoreEnabled } : d))}
          disabled={saving}
        />
      ) : (
        <div className="text-sm text-muted">Loading lorebooks...</div>
      )}
    </Modal>
  );
}
