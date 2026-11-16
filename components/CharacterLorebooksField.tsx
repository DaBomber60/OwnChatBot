import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import useSWR from 'swr';
import { LorebookPicker } from './LorebookPicker';
import { useToast } from './ToastProvider';
import { fetcher } from '../lib/fetcher';
import { extractErrorFromResponse } from '../lib/chat/errorUtils';
import type { CharacterLorebooksResponse, LorebookSummary } from '../types/models';

export interface CharacterLorebooksFieldHandle {
  /** Persist pending changes. Resolves false (after showing a toast) when saving failed. */
  save: () => Promise<boolean>;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Character editor field for the lorebooks copied into every new chat with this character. */
export const CharacterLorebooksField = forwardRef<CharacterLorebooksFieldHandle, { characterId: number }>(
  function CharacterLorebooksField({ characterId }, ref) {
    const { showToast } = useToast();
    const key = `/api/characters/${characterId}/lorebooks`;
    const { data: lorebooks } = useSWR<LorebookSummary[]>('/api/lorebooks?view=summary', fetcher);
    const { data: current, mutate } = useSWR<CharacterLorebooksResponse>(key, fetcher);
    const [selected, setSelected] = useState<number[] | null>(null);
    const [applyToExisting, setApplyToExisting] = useState(false);

    useEffect(() => {
      if (current && selected === null) setSelected(current.lorebookIds);
    }, [current, selected]);

    const addedIds = useMemo(
      () => (selected && current ? selected.filter(id => !current.lorebookIds.includes(id)) : []),
      [selected, current]
    );
    const dirty = !!selected && !!current
      && (addedIds.length > 0 || current.lorebookIds.some(id => !selected.includes(id)));
    const canApplyToExisting = addedIds.length > 0 && (current?.existingChatCount ?? 0) > 0;

    useImperativeHandle(ref, () => ({
      save: async () => {
        if (!dirty || !selected) return true;
        try {
          const res = await fetch(key, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lorebookIds: selected, applyToExistingChats: canApplyToExisting && applyToExisting }),
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => null);
            throw new Error(extractErrorFromResponse(errData, res.statusText));
          }
          const result: { chatsUpdated: number } = await res.json();
          setApplyToExisting(false);
          await mutate();
          if (result.chatsUpdated > 0) {
            showToast(`Added to ${plural(result.chatsUpdated, 'existing chat')}`, 'success');
          }
          return true;
        } catch (err) {
          showToast(`Could not save default lorebooks: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
          return false;
        }
      },
    }), [dirty, selected, key, canApplyToExisting, applyToExisting, mutate, showToast]);

    return (
      <div className="form-group">
        <label className="form-label">📖 Default Lorebooks</label>
        {selected ? (
          <LorebookPicker lorebooks={lorebooks} selectedIds={selected} onChange={setSelected} />
        ) : (
          <div className="text-sm text-muted">Loading lorebooks...</div>
        )}
        <small className="text-xs text-muted mt-1">
          Added to every new chat with this character. Each chat can still add or remove lorebooks from its menu.
        </small>
        {canApplyToExisting && (
          <label className="form-label flex items-center gap-3 mt-2">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={applyToExisting}
              onChange={e => setApplyToExisting(e.target.checked)}
            />
            Also add the newly selected {addedIds.length === 1 ? 'lorebook' : 'lorebooks'} to this
            character&apos;s {plural(current!.existingChatCount, 'existing chat')}
          </label>
        )}
      </div>
    );
  }
);
