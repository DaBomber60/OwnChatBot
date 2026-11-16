import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useToast } from '../ToastProvider';
import { fetcher, sendJson } from '../../lib/fetcher';
import { readLoreSettings, type LoreSettings } from '../../lib/lorebook/settings';
import {
  LORE_KEEP_ACTIVE_MAX, LORE_KEEP_ACTIVE_MIN, LORE_LIMIT_MAX, LORE_LIMIT_MIN,
} from '../../lib/lorebook/constants';

type Draft = { loreLimit: string; keepActiveTurns: string; globalLoreDefault: boolean };

const toDraft = (s: LoreSettings): Draft => ({
  loreLimit: String(s.loreLimit),
  keepActiveTurns: String(s.keepActiveTurns),
  globalLoreDefault: s.globalLoreDefault,
});

/** Budget, keep-active window and the global lorebook default for new chats. */
export function LoreSettingsCard() {
  const { showToast } = useToast();
  const { data: settingsData, mutate } = useSWR<Record<string, string>>('/api/settings', fetcher);
  const saved = settingsData ? readLoreSettings(settingsData) : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (saved && !draft) setDraft(toDraft(saved));
  }, [saved, draft]);

  if (!saved || !draft) {
    return (
      <div className="card mb-6">
        <div className="card-header"><h3 className="card-title">⚙️ Lore Settings</h3></div>
        <p className="text-sm text-muted mb-0">Loading...</p>
      </div>
    );
  }

  const parse = (text: string, min: number, max: number) => {
    const n = Number(text);
    return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const loreLimit = parse(draft.loreLimit, LORE_LIMIT_MIN, LORE_LIMIT_MAX);
  const keepActiveTurns = parse(draft.keepActiveTurns, LORE_KEEP_ACTIVE_MIN, LORE_KEEP_ACTIVE_MAX);
  const valid = loreLimit !== null && keepActiveTurns !== null;
  const next: LoreSettings = {
    loreLimit: loreLimit ?? saved.loreLimit,
    keepActiveTurns: keepActiveTurns ?? saved.keepActiveTurns,
    globalLoreDefault: draft.globalLoreDefault,
  };
  const dirty = next.loreLimit !== saved.loreLimit
    || next.keepActiveTurns !== saved.keepActiveTurns
    || next.globalLoreDefault !== saved.globalLoreDefault;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    try {
      await sendJson('/api/settings', 'POST', {
        loreLimit: next.loreLimit,
        loreKeepActiveTurns: next.keepActiveTurns,
        globalLoreEnabled: next.globalLoreDefault,
      });
      await mutate();
      setDraft(toDraft(next));
      showToast('Lore settings saved', 'success');
    } catch (err) {
      showToast(`Could not save lore settings: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id="lore-settings" className="card mb-6" onSubmit={save} noValidate>
      <div className="card-header mb-4">
        <h3 className="card-title">⚙️ Lore Settings</h3>
        <p className="card-description">Applies to every chat</p>
      </div>

      <div className="lore-form-row">
        <div className="form-group">
          <label className="form-label" htmlFor="lore-limit">Lore budget (characters)</label>
          <input
            id="lore-limit"
            className="form-input"
            type="number"
            inputMode="numeric"
            min={LORE_LIMIT_MIN}
            max={LORE_LIMIT_MAX}
            step={500}
            value={draft.loreLimit}
            onChange={e => setDraft({ ...draft, loreLimit: e.target.value })}
          />
          {loreLimit === null && (
            <small className="lore-field-warning">
              Use a whole number from {LORE_LIMIT_MIN} to {LORE_LIMIT_MAX.toLocaleString()}.
            </small>
          )}
          <small className="lore-field-hint">
            Most keyword-triggered lore added to one reply. Higher-priority entries go first; ones that don&apos;t fit are skipped.
            Always-included entries don&apos;t count toward it.
          </small>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="lore-keep-active">Keep triggered entries for (replies)</label>
          <input
            id="lore-keep-active"
            className="form-input"
            type="number"
            inputMode="numeric"
            min={LORE_KEEP_ACTIVE_MIN}
            max={LORE_KEEP_ACTIVE_MAX}
            step={1}
            value={draft.keepActiveTurns}
            onChange={e => setDraft({ ...draft, keepActiveTurns: e.target.value })}
          />
          {keepActiveTurns === null && (
            <small className="lore-field-warning">
              Use a whole number from {LORE_KEEP_ACTIVE_MIN} to {LORE_KEEP_ACTIVE_MAX}.
            </small>
          )}
          <small className="lore-field-hint">
            After a keyword comes up, its entry stays for this many more replies. Mentioning it again restarts the count.
          </small>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label flex items-center gap-3 mb-0">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={draft.globalLoreDefault}
            onChange={e => setDraft({ ...draft, globalLoreDefault: e.target.checked })}
          />
          Turn on the Global Lorebook for new chats
        </label>
        <small className="lore-field-hint">Each chat can still switch it on or off from its menu.</small>
      </div>

      <div className="flex gap-3">
        <button type="submit" className="btn btn-primary" disabled={!dirty || !valid || saving}>
          {saving ? 'Saving...' : 'Save Lore Settings'}
        </button>
        {dirty && !saving && (
          <button type="button" className="btn btn-secondary" onClick={() => setDraft(toDraft(saved))}>
            Reset
          </button>
        )}
      </div>
    </form>
  );
}
