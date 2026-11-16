import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { strictFetcher, sendJson } from '../../lib/fetcher';
import { GLOBAL_LOREBOOK_ID } from '../../lib/lorebook/constants';
import type { LorebookDetail, LorebookSummary } from '../../types/models';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { useClickOutside } from '../../hooks/useClickOutside';
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider, ConfirmDeleteItem } from '../../components/DropdownMenu';
import { LoreSettingsCard } from '../../components/lorebooks/LoreSettingsCard';

const SEARCH_THRESHOLD = 6;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function LorebookStats({ lorebook }: { lorebook: LorebookSummary }) {
  return (
    <div className="lore-stats">
      <span>📄 {plural(lorebook.entryCount, 'entry', 'entries')}</span>
      {lorebook.id !== GLOBAL_LOREBOOK_ID && (
        <>
          <span>🎭 Default for {plural(lorebook.characterCount, 'character')}</span>
          <span>💬 In {plural(lorebook.chatCount, 'chat')}</span>
        </>
      )}
    </div>
  );
}

export default function LorebooksPage() {
  const router = useRouter();
  const { showToast } = useToast();
  // Same key as the lorebook pickers, so creating/deleting here refreshes them too.
  const { data: lorebooks, error, mutate } = useSWR<LorebookSummary[]>('/api/lorebooks?view=summary', strictFetcher);
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const closeMenu = () => { setOpenMenuId(null); setConfirmDeleteId(null); };
  useClickOutside(openMenuId !== null, closeMenu);

  const resetForm = () => { setIsAdding(false); setName(''); setDescription(''); };

  const createLorebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await sendJson<LorebookDetail>('/api/lorebooks', 'POST', {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      await mutate();
      resetForm();
      router.push(`/lorebooks/${created.id}`);
    } catch (err) {
      showToast(`Could not create the lorebook: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const deleteLorebook = async (lorebook: LorebookSummary) => {
    closeMenu();
    try {
      await sendJson(`/api/lorebooks/${lorebook.id}`, 'DELETE');
      await mutate();
      showToast(`Deleted “${lorebook.name}”`, 'success');
    } catch (err) {
      showToast(`Could not delete the lorebook: ${err instanceof Error ? err.message : 'unknown error'}`, 'error');
    }
  };

  if (error) return <div className="text-center text-error">Error loading lorebooks.</div>;
  if (!lorebooks) return <div className="text-center">Loading...</div>;

  const globalBook = lorebooks.find(lb => lb.id === GLOBAL_LOREBOOK_ID);
  const books = lorebooks.filter(lb => lb.id !== GLOBAL_LOREBOOK_ID);
  const query = search.trim().toLowerCase();
  const visible = query
    ? books.filter(lb => lb.name.toLowerCase().includes(query) || (lb.description ?? '').toLowerCase().includes(query))
    : books;

  return (
    <>
      <Head>
        <title>Lorebooks - World Info for Your Chats</title>
        <meta name="description" content="Create lorebooks of world info that get added to chats when they're relevant." />
      </Head>

      <PageHeader title="Lorebooks" />

      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Create New Lorebook</h3>
          <p className="card-description">Collections of world info added to your chats when they&apos;re relevant</p>
        </div>

        {isAdding ? (
          <form onSubmit={createLorebook}>
            <div className="form-group">
              <label className="form-label" htmlFor="new-lorebook-name">Name</label>
              <input
                id="new-lorebook-name"
                className="form-input"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={200}
                placeholder="e.g. Kingdom of Eldoria"
                required
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="new-lorebook-description">Description (Optional)</label>
              <textarea
                id="new-lorebook-description"
                className="form-textarea"
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="What this lorebook covers..."
              />
              <small className="lore-field-hint">For your reference; not sent to the AI.</small>
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
                {creating ? 'Creating...' : 'Create Lorebook'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={creating}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <button className="btn btn-primary mb-4" onClick={() => setIsAdding(true)}>
              + New Lorebook
            </button>
            <details className="lore-help">
              <summary>How do lorebooks work?</summary>
              <ul>
                <li><strong>📌 Always-included</strong> entries go into the system prompt of every chat using the lorebook. Keep them short.</li>
                <li><strong>🔑 Keyword</strong> entries are added only when your message mentions one of their keywords, then stay for a few replies.</li>
                <li>Attach lorebooks to a chat when you start it or from the chat&apos;s ☰ menu. Set a character&apos;s defaults in the character editor.</li>
                <li>The <strong>🌐 Global Lorebook</strong> holds keyword entries available to every chat that has it switched on.</li>
              </ul>
            </details>
          </>
        )}
      </div>

      {globalBook && (
        <div
          className="card lore-global-card cursor-pointer mb-6"
          onClick={() => router.push(`/lorebooks/${GLOBAL_LOREBOOK_ID}`)}
        >
          <h3 className="lore-card-title">🌐 {globalBook.name}</h3>
          <p className="lore-card-desc">Keyword-triggered lore available in every chat that has it switched on.</p>
          <LorebookStats lorebook={globalBook} />
        </div>
      )}

      {books.length > SEARCH_THRESHOLD && (
        <div className="card mb-6">
          <div className="card-header">
            <h3 className="card-title">Search Lorebooks</h3>
            <p className="card-description">Filter by name or description</p>
          </div>
          <div className="form-group mb-0">
            <input
              className="form-input"
              type="search"
              placeholder="Type to search lorebooks..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      )}

      {books.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-secondary mb-4">No lorebooks created yet.</p>
          {!isAdding && (
            <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
              Create Your First Lorebook
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 mb-6">
          {visible.map(lb => (
            <div key={lb.id} className="card cursor-pointer" onClick={() => router.push(`/lorebooks/${lb.id}`)}>
              <div className="flex items-start justify-between gap-4">
                <div className="lore-entry-body">
                  <h3 className="lore-card-title">📖 {lb.name}</h3>
                  {lb.description && <p className="lore-card-desc">{lb.description}</p>}
                  <LorebookStats lorebook={lb} />
                </div>
                <div onClick={e => e.stopPropagation()}>
                  <DropdownMenu
                    entityId={lb.id}
                    isOpen={openMenuId === lb.id}
                    onToggle={() => { setConfirmDeleteId(null); setOpenMenuId(openMenuId === lb.id ? null : lb.id); }}
                    onClose={closeMenu}
                  >
                    <DropdownMenuItem icon="📖" label="Open Lorebook" onClick={() => router.push(`/lorebooks/${lb.id}`)} />
                    <DropdownMenuDivider />
                    <ConfirmDeleteItem
                      label="Delete Lorebook"
                      isConfirming={confirmDeleteId === lb.id}
                      onRequestDelete={() => setConfirmDeleteId(lb.id)}
                      onConfirm={() => deleteLorebook(lb)}
                      onCancel={closeMenu}
                    />
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="text-center text-secondary">No lorebooks match &ldquo;{search}&rdquo;.</p>
          )}
        </div>
      )}

      <LoreSettingsCard />
    </>
  );
}
