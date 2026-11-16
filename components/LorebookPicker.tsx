import { useMemo, useState } from 'react';
import Link from 'next/link';
import { GLOBAL_LOREBOOK_ID } from '../lib/lorebook/constants';
import type { LorebookSummary } from '../types/models';

const FILTER_THRESHOLD = 8;

interface LorebookPickerProps {
  /** All lorebooks (the global one is split out into its own toggle). */
  lorebooks: LorebookSummary[] | undefined;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  /** Pass both to show the per-chat global lorebook toggle. */
  globalLoreEnabled?: boolean;
  onGlobalLoreChange?: (enabled: boolean) => void;
  /** Lorebooks that are the character's defaults, labelled in the list. */
  defaultIds?: number[];
  disabled?: boolean;
}

function entryLabel(count: number) {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

export function LorebookPicker({
  lorebooks, selectedIds, onChange, globalLoreEnabled, onGlobalLoreChange, defaultIds = [], disabled = false,
}: LorebookPickerProps) {
  const [filter, setFilter] = useState('');
  const globalBook = lorebooks?.find(lb => lb.id === GLOBAL_LOREBOOK_ID);
  const books = useMemo(() => (lorebooks ?? []).filter(lb => lb.id !== GLOBAL_LOREBOOK_ID), [lorebooks]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const defaults = useMemo(() => new Set(defaultIds), [defaultIds]);

  const query = filter.trim().toLowerCase();
  const visible = query
    ? books.filter(lb => lb.name.toLowerCase().includes(query) || (lb.description ?? '').toLowerCase().includes(query))
    : books;

  const toggle = (id: number) => {
    onChange(selected.has(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };

  if (!lorebooks) {
    return <div className="text-sm text-muted">Loading lorebooks...</div>;
  }

  const showGlobal = onGlobalLoreChange !== undefined && globalLoreEnabled !== undefined;

  return (
    <div className="lorebook-picker">
      {showGlobal && (
        <label className="lorebook-picker-item lorebook-picker-global">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={globalLoreEnabled}
            disabled={disabled}
            onChange={e => onGlobalLoreChange(e.target.checked)}
          />
          <span className="lorebook-picker-text">
            <span className="lorebook-picker-name">
              🌐 Global Lorebook
              <span className="lorebook-picker-meta">{entryLabel(globalBook?.entryCount ?? 0)}</span>
            </span>
            <span className="lorebook-picker-desc">Keyword-triggered lore shared by every chat</span>
          </span>
        </label>
      )}

      {books.length > FILTER_THRESHOLD && (
        <input
          className="form-input lorebook-picker-filter"
          type="search"
          placeholder="Filter lorebooks..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          disabled={disabled}
        />
      )}

      {books.length === 0 ? (
        <div className="text-sm text-muted">
          No lorebooks yet. <Link href="/lorebooks" className="text-accent">Create one on the Lorebooks page</Link>.
        </div>
      ) : (
        <div className="lorebook-picker-list">
          {visible.map(lb => (
            <label key={lb.id} className="lorebook-picker-item">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={selected.has(lb.id)}
                disabled={disabled}
                onChange={() => toggle(lb.id)}
              />
              <span className="lorebook-picker-text">
                <span className="lorebook-picker-name">
                  {lb.name}
                  <span className="lorebook-picker-meta">{entryLabel(lb.entryCount)}</span>
                  {defaults.has(lb.id) && <span className="lorebook-picker-tag">Character default</span>}
                </span>
                {lb.description && <span className="lorebook-picker-desc">{lb.description}</span>}
              </span>
            </label>
          ))}
          {visible.length === 0 && <div className="text-sm text-muted">No lorebooks match &ldquo;{filter}&rdquo;.</div>}
        </div>
      )}
    </div>
  );
}
