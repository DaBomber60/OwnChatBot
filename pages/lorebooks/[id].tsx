import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { fetcher, strictFetcher, sendJson, FetchError } from '../../lib/fetcher';
import { readLoreSettings } from '../../lib/lorebook/settings';
import type { LoreEntry, LorebookDetail } from '../../types/models';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { useClickOutside } from '../../hooks/useClickOutside';
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider, ConfirmDeleteItem } from '../../components/DropdownMenu';
import { LoreEntryEditor } from '../../components/lorebooks/LoreEntryEditor';
import { LoreEntryCard } from '../../components/lorebooks/LoreEntryCard';

const SUMMARY_KEY = '/api/lorebooks?view=summary';
const FILTER_THRESHOLD = 4;
const BACK = { href: '/lorebooks', label: 'Lorebooks' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function entryMatchesFilter(entry: LoreEntry, query: string) {
  return entry.title.toLowerCase().includes(query)
    || entry.content.toLowerCase().includes(query)
    || entry.keys.some(k => k.text.toLowerCase().includes(query));
}

export default function LorebookDetailPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { mutate: mutateKey } = useSWRConfig();
  const idParam = typeof router.query.id === 'string' ? router.query.id : null;
  const detailKey = idParam ? `/api/lorebooks/${idParam}` : null;
  const { data: lorebook, error, mutate } = useSWR<LorebookDetail>(detailKey, strictFetcher);
  const { data: settingsData } = useSWR<Record<string, string>>('/api/settings', fetcher);
  const loreSettings = readLoreSettings(settingsData);

  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsDraft, setDetailsDraft] = useState({ name: '', description: '' });
  const [savingDetails, setSavingDetails] = useState(false);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const closeMenu = () => { setOpenMenu(null); setConfirmDelete(null); };
  useClickOutside(openMenu !== null, closeMenu);
  const toggleMenu = (key: string) => { setConfirmDelete(null); setOpenMenu(openMenu === key ? null : key); };

  // Entry counts on the list page and in the pickers come from the summary.
  const refresh = async () => { await Promise.all([mutate(), mutateKey(SUMMARY_KEY)]); };

  if (error) {
    const notFound = error instanceof FetchError && (error.status === 404 || error.status === 400);
    return (
      <>
        <PageHeader title="Lorebook" back={BACK} />
        <div className="text-center py-12">
          <p className="text-secondary mb-4">{notFound ? 'This lorebook doesn’t exist or was deleted.' : 'Error loading the lorebook.'}</p>
          <button className="btn btn-primary" onClick={() => router.push('/lorebooks')}>Back to Lorebooks</button>
        </div>
      </>
    );
  }
  if (!lorebook) return <div className="text-center">Loading...</div>;

  const { isGlobal, entries } = lorebook;
  const constantCount = entries.filter(e => e.constant).length;
  const disabledCount = entries.filter(e => !e.enabled).length;
  const query = filter.trim().toLowerCase();
  const visible = query ? entries.filter(e => entryMatchesFilter(e, query)) : entries;

  const startEditingDetails = () => {
    closeMenu();
    setDetailsDraft({ name: lorebook.name, description: lorebook.description ?? '' });
    setEditingDetails(true);
  };

  const saveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      const updated = await sendJson<LorebookDetail>(`/api/lorebooks/${lorebook.id}`, 'PATCH', {
        name: detailsDraft.name.trim(),
        description: detailsDraft.description.trim() || null,
      });
      await mutate(updated, { revalidate: false });
      await mutateKey(SUMMARY_KEY);
      setEditingDetails(false);
      showToast('Lorebook updated', 'success');
    } catch (err) {
      showToast(`Could not update the lorebook: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setSavingDetails(false);
    }
  };

  const deleteLorebook = async () => {
    closeMenu();
    try {
      await sendJson(`/api/lorebooks/${lorebook.id}`, 'DELETE');
      await mutateKey(SUMMARY_KEY);
      showToast(`Deleted “${lorebook.name}”`, 'success');
      router.push('/lorebooks');
    } catch (err) {
      showToast(`Could not delete the lorebook: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  };

  const toggleEnabled = async (entry: LoreEntry) => {
    try {
      await sendJson(`/api/lorebooks/${lorebook.id}/entries/${entry.id}`, 'PATCH', { enabled: !entry.enabled });
      await mutate();
    } catch (err) {
      showToast(`Could not update the entry: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  };

  const deleteEntry = async (entry: LoreEntry) => {
    closeMenu();
    try {
      await sendJson(`/api/lorebooks/${lorebook.id}/entries/${entry.id}`, 'DELETE');
      await refresh();
      showToast(`Deleted “${entry.title}”`, 'success');
    } catch (err) {
      showToast(`Could not delete the entry: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  };

  const toggleExpanded = (id: number) => setExpandedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const editorProps = {
    lorebookId: lorebook.id,
    isGlobal,
    loreLimit: loreSettings.loreLimit,
    onCancel: () => setEditing(null),
    onSaved: async () => { setEditing(null); await refresh(); },
  };

  return (
    <>
      <Head>
        <title>{`${lorebook.name} - Lorebooks`}</title>
      </Head>

      <PageHeader title={`${isGlobal ? '🌐' : '📖'} ${lorebook.name}`} back={BACK} />

      <div className={`card mb-6${isGlobal ? ' lore-global-card' : ''}${editingDetails ? ' lore-editor' : ''}`}>
        {editingDetails ? (
          <form onSubmit={saveDetails}>
            <div className="form-group">
              <label className="form-label" htmlFor="lorebook-name">Name</label>
              <input
                id="lorebook-name"
                className="form-input"
                value={detailsDraft.name}
                onChange={e => setDetailsDraft({ ...detailsDraft, name: e.target.value })}
                maxLength={200}
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="lorebook-description">Description (Optional)</label>
              <textarea
                id="lorebook-description"
                className="form-textarea"
                value={detailsDraft.description}
                onChange={e => setDetailsDraft({ ...detailsDraft, description: e.target.value })}
                maxLength={2000}
                rows={2}
              />
              <small className="lore-field-hint">For your reference; not sent to the AI.</small>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary" disabled={savingDetails || !detailsDraft.name.trim()}>
                {savingDetails ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingDetails(false)} disabled={savingDetails}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="lore-entry-body">
              {isGlobal ? (
                <p className="text-secondary mb-3">
                  Keyword-triggered lore available in every chat that has the Global Lorebook switched on.
                  Entries here can&apos;t be always-included.
                </p>
              ) : lorebook.description ? (
                <p className="text-secondary mb-3" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{lorebook.description}</p>
              ) : (
                <p className="text-muted mb-3">No description.</p>
              )}

              <div className="lore-stats mb-3">
                <span>📄 {plural(entries.length, 'entry', 'entries')}</span>
                {constantCount > 0 && <span>📌 {constantCount} always included</span>}
                {disabledCount > 0 && <span>⏸ {disabledCount} disabled</span>}
                {!isGlobal && <span>💬 In {plural(lorebook.chatCount, 'chat')}</span>}
              </div>

              {isGlobal ? (
                <p className="text-sm text-muted mb-0">
                  New chats start with it switched {loreSettings.globalLoreDefault ? 'on' : 'off'}.
                  Change that in <Link href="/settings#lore-settings" className="text-accent">Settings</Link>, or per chat from its ☰ menu.
                </p>
              ) : lorebook.characters.length > 0 ? (
                <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                  <span className="text-sm text-muted">🎭 Default for</span>
                  <div className="lore-chip-list">
                    {lorebook.characters.map(c => (
                      <span key={c.id} className="lore-chip lore-chip--muted">{c.profileName || c.name}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted mb-0">
                  🎭 Not a default for any character yet. Set defaults in the{' '}
                  <Link href="/characters" className="text-accent">character editor</Link>.
                </p>
              )}
            </div>

            {!isGlobal && (
              <DropdownMenu entityId="lorebook" isOpen={openMenu === 'lorebook'} onToggle={() => toggleMenu('lorebook')} onClose={closeMenu} stopPropagation>
                <DropdownMenuItem icon="✏️" label="Edit Details" onClick={startEditingDetails} />
                <DropdownMenuDivider />
                <ConfirmDeleteItem
                  label="Delete Lorebook"
                  isConfirming={confirmDelete === 'lorebook'}
                  onRequestDelete={() => setConfirmDelete('lorebook')}
                  onConfirm={deleteLorebook}
                  onCancel={closeMenu}
                />
              </DropdownMenu>
            )}
          </div>
        )}
      </div>

      <div className="lore-toolbar">
        <h2 className="text-2xl font-semibold">Entries</h2>
        <div className="lore-toolbar-actions">
          {entries.length > FILTER_THRESHOLD && (
            <input
              className="form-input"
              type="search"
              placeholder="Filter entries..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
              aria-label="Filter entries"
            />
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')} disabled={editing === 'new'}>
            + New Entry
          </button>
        </div>
      </div>

      {editing === 'new' && (
        <div className="mb-4">
          <LoreEntryEditor {...editorProps} />
        </div>
      )}

      {entries.length === 0 ? (
        editing !== 'new' && (
          <div className="text-center py-12">
            <p className="text-secondary mb-4">
              No entries yet. Add facts about places, people or history for the AI to draw on.
            </p>
            <button className="btn btn-primary" onClick={() => setEditing('new')}>Add Your First Entry</button>
          </div>
        )
      ) : (
        <div className="grid gap-4 mb-6">
          {visible.map(entry => (
            editing === entry.id ? (
              <LoreEntryEditor key={entry.id} {...editorProps} entry={entry} />
            ) : (
              <LoreEntryCard
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggleExpand={() => toggleExpanded(entry.id)}
                menuOpen={openMenu === `entry-${entry.id}`}
                onToggleMenu={() => toggleMenu(`entry-${entry.id}`)}
                onCloseMenu={closeMenu}
                confirmingDelete={confirmDelete === `entry-${entry.id}`}
                onRequestDelete={() => setConfirmDelete(`entry-${entry.id}`)}
                onEdit={() => setEditing(entry.id)}
                onToggleEnabled={() => toggleEnabled(entry)}
                onDelete={() => deleteEntry(entry)}
              />
            )
          ))}
          {visible.length === 0 && (
            <p className="text-center text-secondary">No entries match &ldquo;{filter}&rdquo;.</p>
          )}
        </div>
      )}
    </>
  );
}
