import { useState } from 'react';
import { KeywordInput } from './KeywordInput';
import { useToast } from '../ToastProvider';
import { sendJson, FetchError } from '../../lib/fetcher';
import { normalizeKeywords } from '../../lib/lorebook/keywords';
import { DEFAULT_LORE_PRIORITY, LORE_PRIORITY_MAX, LORE_PRIORITY_MIN } from '../../lib/lorebook/constants';
import type { LoreEntry } from '../../types/models';

const MIN_CONTENT_FOR_SUGGESTIONS = 10;
const LONG_CONSTANT_ENTRY = 2000;

interface LoreEntryEditorProps {
  lorebookId: number;
  /** Global lorebook entries are always keyword-triggered. */
  isGlobal: boolean;
  /** Omit to create a new entry. */
  entry?: LoreEntry;
  /** Character budget for triggered lore, used to warn about entries that can never fit. */
  loreLimit: number;
  onSaved: (entry: LoreEntry) => void;
  onCancel: () => void;
}

const formatNumber = (n: number) => n.toLocaleString();

export function LoreEntryEditor({ lorebookId, isGlobal, entry, loreLimit, onSaved, onCancel }: LoreEntryEditorProps) {
  const { showToast } = useToast();
  const [title, setTitle] = useState(entry?.title ?? '');
  const [content, setContent] = useState(entry?.content ?? '');
  const [keys, setKeys] = useState<string[]>(entry?.keys ?? []);
  const [constant, setConstant] = useState(!isGlobal && !!entry?.constant);
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);
  const [priority, setPriority] = useState(String(entry?.priority ?? DEFAULT_LORE_PRIORITY));
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionNote, setSuggestionNote] = useState<string | null>(null);

  const priorityValue = Number(priority);
  const priorityValid = priority.trim() !== '' && Number.isInteger(priorityValue)
    && priorityValue >= LORE_PRIORITY_MIN && priorityValue <= LORE_PRIORITY_MAX;
  const trimmedContent = content.trim();
  const canSave = !!title.trim() && !!trimmedContent && priorityValid && !saving;
  const canSuggest = trimmedContent.length >= MIN_CONTENT_FOR_SUGGESTIONS && !suggesting && !saving;

  const suggestKeywords = async () => {
    setSuggesting(true);
    setSuggestionNote(null);
    try {
      const result = await sendJson<{ keywords: string[]; reasoning?: string }>('/api/lorebooks/keywords/generate', 'POST', {
        content: trimmedContent,
        ...(title.trim() ? { entryTitle: title.trim() } : {}),
      });
      const merged = normalizeKeywords([...keys, ...result.keywords]);
      const addedCount = merged.length - keys.length;
      setKeys(merged);
      setSuggestionNote(addedCount > 0
        ? `Added ${addedCount} suggested keyword${addedCount === 1 ? '' : 's'}. Remove any that don't fit.${result.reasoning ? ` ${result.reasoning}` : ''}`
        : 'No new keywords suggested; the current list already covers them.');
    } catch (err) {
      const message = err instanceof FetchError && err.code === 'API_KEY_NOT_CONFIGURED'
        ? 'Add an API key in Settings to use keyword suggestions.'
        : `Could not suggest keywords: ${err instanceof Error ? err.message : 'unknown error'}`;
      showToast(message, 'error');
    } finally {
      setSuggesting(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        content: trimmedContent,
        keys: normalizeKeywords(keys),
        constant,
        enabled,
        priority: priorityValue,
      };
      const saved = entry
        ? await sendJson<LoreEntry>(`/api/lorebooks/${lorebookId}/entries/${entry.id}`, 'PATCH', body)
        : await sendJson<LoreEntry>(`/api/lorebooks/${lorebookId}/entries`, 'POST', body);
      showToast(entry ? 'Entry saved' : 'Entry added', 'success');
      onSaved(saved);
    } catch (err) {
      showToast(`Could not save the entry: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
      setSaving(false);
    }
  };

  return (
    <form className="card lore-editor" onSubmit={save}>
      <div className="card-header mb-4">
        <h3 className="card-title">{entry ? '✏️ Edit Entry' : '➕ New Entry'}</h3>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="lore-entry-title">Title</label>
        <input
          id="lore-entry-title"
          className="form-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
          placeholder="e.g. The Silver Citadel"
          required
          autoFocus={!entry}
        />
        <small className="lore-field-hint">Shown to the AI as the entry&apos;s heading.</small>
      </div>

      {!isGlobal && (
        <div className="form-group">
          <span className="form-label">When to include it</span>
          <div className="lore-mode-toggle" role="radiogroup">
            <label className={`lore-mode-option${!constant ? ' is-selected' : ''}`}>
              <input type="radio" name="lore-mode" checked={!constant} onChange={() => setConstant(false)} />
              <span>
                <span className="lore-mode-title">🔑 When keywords come up</span>
                <span className="lore-mode-desc">Added to a reply only when your message mentions one of its keywords.</span>
              </span>
            </label>
            <label className={`lore-mode-option${constant ? ' is-selected' : ''}`}>
              <input type="radio" name="lore-mode" checked={constant} onChange={() => setConstant(true)} />
              <span>
                <span className="lore-mode-title">📌 Always</span>
                <span className="lore-mode-desc">Part of the system prompt in every chat using this lorebook.</span>
              </span>
            </label>
          </div>
        </div>
      )}

      {!constant && (
        <div className="form-group">
          <div className="lore-label-row">
            <label className="form-label" htmlFor="lore-entry-keywords">Keywords</label>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={suggestKeywords}
              disabled={!canSuggest}
              title={canSuggest ? 'Ask your AI model to suggest keywords from the content' : 'Write some content first'}
            >
              {suggesting ? '⏳ Suggesting...' : '✨ Suggest keywords'}
            </button>
          </div>
          <KeywordInput id="lore-entry-keywords" value={keys} onChange={setKeys} disabled={saving} />
          {suggestionNote && <small className="lore-field-hint">{suggestionNote}</small>}
          <small className="lore-field-hint">
            Matched against your latest message, ignoring case. A keyword with spaces matches as a whole phrase.
          </small>
          {keys.length === 0 && (
            <small className="lore-field-warning">Without keywords this entry will never be added.</small>
          )}
        </div>
      )}

      <div className="form-group">
        <div className="lore-label-row">
          <label className="form-label" htmlFor="lore-entry-content">Content</label>
          <span className="text-xs text-muted">{formatNumber(trimmedContent.length)} characters</span>
        </div>
        <textarea
          id="lore-entry-content"
          className="form-textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={6}
          maxLength={50000}
          placeholder="What the AI should know when this entry is included..."
          required
        />
        {!constant && trimmedContent.length > loreLimit && (
          <small className="lore-field-warning">
            Longer than your lore budget ({formatNumber(loreLimit)} characters), so it will never be added.
            Shorten it or raise the budget in Lore Settings on the Lorebooks page.
          </small>
        )}
        {constant && trimmedContent.length > LONG_CONSTANT_ENTRY && (
          <small className="lore-field-warning">
            Always-included entries are sent with every message, so long ones use up context quickly.
          </small>
        )}
      </div>

      <div className="lore-form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="lore-entry-priority">Priority</label>
          <input
            id="lore-entry-priority"
            className="form-input"
            type="number"
            inputMode="numeric"
            min={LORE_PRIORITY_MIN}
            max={LORE_PRIORITY_MAX}
            step={1}
            value={priority}
            onChange={e => setPriority(e.target.value)}
          />
          {priorityValid ? (
            <small className="lore-field-hint">
              {constant
                ? 'Higher numbers appear first in the system prompt.'
                : 'When several entries trigger at once, higher numbers are added first if the budget is tight.'}
            </small>
          ) : (
            <small className="lore-field-warning">Use a whole number from {LORE_PRIORITY_MIN} to {LORE_PRIORITY_MAX}.</small>
          )}
        </div>
        <div className="form-group">
          <span className="form-label">Status</span>
          <label className="form-label flex items-center gap-3 mb-0">
            <input type="checkbox" className="form-checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <small className="lore-field-hint">Disabled entries are kept here but never sent to the AI.</small>
        </div>
      </div>

      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary" disabled={!canSave}>
          {saving ? 'Saving...' : entry ? 'Save Changes' : 'Add Entry'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
