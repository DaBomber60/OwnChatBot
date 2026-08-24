import { useState } from 'react';
import useSWR from 'swr';
import Head from 'next/head';
import { fetcher } from '../../lib/fetcher';
import type { Persona } from '../../types/models';
import { renderMultiline } from '../../components/RenderMultiline';
import { useClickOutside } from '../../hooks/useClickOutside';
import { PageHeader } from '../../components/PageHeader';
import { Modal } from '../../components/Modal';
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider, ConfirmDeleteItem } from '../../components/DropdownMenu';

// Utility to get preview text for persona cards
function getPersonaPreview(persona: Persona): { text: string; label: string } | null {
  if (persona.profile && persona.profile.trim()) {
    const text = persona.profile.length > 120 ? persona.profile.substring(0, 120) + '...' : persona.profile;
    return { text, label: 'Profile' };
  }
  return null;
}

export default function PersonasPage() {
  const { data: personas, error, mutate } = useSWR<Persona[]>('/api/personas', fetcher);
  const [name, setName] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profile, setProfile] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editProfileName, setEditProfileName] = useState('');
  const [editProfile, setEditProfile] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { data: settingsData } = useSWR<Record<string, string>>('/api/settings', fetcher);
  const devMode = settingsData?.devMode === 'true';
  useClickOutside(openMenuId !== null, () => setOpenMenuId(null));

  const toggleSelected = (personaId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(personaId)) {
        next.delete(personaId);
      } else {
        next.add(personaId);
      }
      return next;
    });
  };

  const toggleSelectAll = (list: Persona[]) => {
    const allSelected = list.every(p => selectedIds.has(p.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      list.forEach(p => (allSelected ? next.delete(p.id) : next.add(p.id)));
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const bulkDeleteSelected = async () => {
    setBulkDeleting(true);
    try {
      const res = await fetch('/api/personas/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      if (!res.ok) throw new Error('Bulk delete failed');
      await mutate();
      setShowBulkDeleteModal(false);
      exitSelectMode();
    } catch (err) {
      console.error('Error deleting personas:', err);
      alert('Failed to delete the selected personas. Please try again.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleMenu = (personaId: number) => {
    setOpenMenuId(openMenuId === personaId ? null : personaId);
  };

  const closeMenu = () => {
    setOpenMenuId(null);
  };

  const clonePersona = (persona: Persona) => {
    // Fill the create form with persona data and append " - [Clone]" to profile name
    setName(persona.name);
    setProfileName(persona.profileName ? `${persona.profileName} - [Clone]` : `${persona.name} - [Clone]`);
    setProfile(persona.profile || '');
    
    // Open the create form and close the menu
    setIsAdding(true);
    closeMenu();
    
    // Scroll to top to show the create form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !profile) return;
    await fetch('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, profileName: profileName || null, profile })
    });
    setName(''); setProfileName(''); setProfile('');
    setIsAdding(false);
    mutate();
  };

  if (error) return <div className="text-center text-error">Error loading personas.</div>;
  if (!personas) return <div className="text-center">Loading...</div>;

  return (
    <>
      <Head>
        <title>Personas - Manage AI Conversation Styles</title>
        <meta name="description" content="Create and manage AI personas to define different conversation styles and personalities for your chats." />
      </Head>

      <PageHeader title="Personas" />

      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Create New Persona</h3>
          <p className="card-description">Define AI personalities for different conversation styles</p>
        </div>
        
        {isAdding ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input 
                className="form-input"
                value={name} 
                onChange={e => setName(e.target.value)}
                placeholder="Enter persona name (used in chats)"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Profile Name (Optional)</label>
              <input 
                className="form-input"
                value={profileName} 
                onChange={e => setProfileName(e.target.value)}
                placeholder="Display name for menus and selection (optional)"
              />
              <small className="text-xs text-muted mt-1">If provided, this will be shown in dropdowns instead of the name</small>
            </div>
            <div className="form-group">
              <label className="form-label">Profile</label>
              <textarea 
                className="form-textarea"
                value={profile} 
                onChange={e => setProfile(e.target.value)}
                placeholder="Describe the persona's characteristics, speaking style, and behavior..."
                rows={4}
                required
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary">Create Persona</button>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => { 
                  setIsAdding(false); 
                  setName(''); 
                  setProfileName('');
                  setProfile(''); 
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
            + New Persona
          </button>
        )}
      </div>

      {devMode && personas.length > 0 && (
        <div className="select-bar">
          <div className="select-toolbar">
            {selectMode ? (
              <>
                <span className="select-toolbar__count">{selectedIds.size} selected</span>
                <button className="btn btn-secondary btn-small" onClick={() => toggleSelectAll(personas)}>
                  {personas.every(p => selectedIds.has(p.id)) ? 'Deselect all' : 'Select all'}
                </button>
                <button
                  className={`btn btn-danger btn-small ${selectedIds.size === 0 ? 'btn-disabled-muted' : ''}`}
                  onClick={() => setShowBulkDeleteModal(true)}
                  disabled={selectedIds.size === 0}
                >
                  Delete Selected
                </button>
                <button className="btn btn-secondary btn-small" onClick={exitSelectMode}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setExpandedId(null);
                  setEditingId(null);
                  setSelectMode(true);
                }}
              >
                Select
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4">
        {personas.map(p => (
          <div 
            key={p.id} 
            className={`card ${editingId !== p.id ? 'cursor-pointer' : ''}${selectMode && selectedIds.has(p.id) ? ' select-item--selected' : ''}`}
            onClick={
              selectMode
                ? () => toggleSelected(p.id)
                : editingId !== p.id
                  ? () => setExpandedId(expandedId === p.id ? null : p.id)
                  : undefined
            }
          >
            <div className="flex items-start justify-between">
              {selectMode && (
                <input
                  type="checkbox"
                  className="form-checkbox mt-2"
                  checked={selectedIds.has(p.id)}
                  onChange={() => toggleSelected(p.id)}
                  onClick={e => e.stopPropagation()}
                  aria-label={`Select ${p.name}`}
                />
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-primary">{p.name}</h3>
                {p.profileName && (
                  <p className="text-sm text-secondary italic" style={{ marginTop: '-1rem', marginBottom: '-0.25rem' }}>{p.profileName}</p>
                )}
                {(() => {
                  const preview = getPersonaPreview(p);
                  if (preview) {
                    return (
                      <div style={{ marginTop: '0.25rem' }}>
                        <span className="text-xs font-medium text-accent uppercase tracking-wide">
                          {preview.label}
                        </span>
                        <p className="text-base text-muted" style={{ 
                          fontStyle: 'normal',
                          lineHeight: '1.3',
                          color: 'var(--text-secondary)',
                          marginTop: '0.125rem',
                          marginBottom: '0.125rem'
                        }}>
                          {preview.text}
                        </p>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
              <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                {!selectMode && (
                <DropdownMenu
                  entityId={p.id}
                  isOpen={openMenuId === p.id}
                  onToggle={() => toggleMenu(p.id)}
                  onClose={closeMenu}
                >
                  <DropdownMenuItem
                    icon="✏️"
                    label="Edit Persona"
                    onClick={() => {
                      setEditingId(p.id);
                      setEditName(p.name);
                      setEditProfileName(p.profileName || '');
                      setEditProfile(p.profile || '');
                      closeMenu();
                    }}
                  />
                  <DropdownMenuItem
                    icon="📋"
                    label="Clone Persona"
                    onClick={() => clonePersona(p)}
                  />
                  <DropdownMenuDivider />
                  <ConfirmDeleteItem
                    label="Delete Persona"
                    isConfirming={confirmDeleteId === p.id}
                    onRequestDelete={() => setConfirmDeleteId(p.id)}
                    onConfirm={async () => {
                      await fetch(`/api/personas/${p.id}`, { method: 'DELETE' });
                      setConfirmDeleteId(null);
                      mutate();
                      closeMenu();
                    }}
                    onCancel={() => {
                      setConfirmDeleteId(null);
                      closeMenu();
                    }}
                  />
                </DropdownMenu>
                )}
              </div>
            </div>
            
            {/* Full content when expanded or editing */}
            {(expandedId === p.id || editingId === p.id) && (
              <div style={{ marginTop: '0.25rem', marginBottom: '0', paddingBottom: '0' }}>
                {editingId === p.id ? (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    await fetch(`/api/personas/${p.id}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: editName, profileName: editProfileName || null, profile: editProfile })
                    });
                    setEditingId(null);
                    mutate();
                  }}>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="form-group">
                        <label className="form-label">Name</label>
                        <input 
                          className="form-input"
                          value={editName} 
                          onChange={e => setEditName(e.target.value)}
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Profile Name (Optional)</label>
                        <input 
                          className="form-input"
                          value={editProfileName} 
                          onChange={e => setEditProfileName(e.target.value)}
                          placeholder="Display name for menus and selection (optional)"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Profile</label>
                        <textarea 
                          className="form-textarea"
                          value={editProfile} 
                          onChange={e => setEditProfile(e.target.value)}
                          rows={4}
                          required
                        />
                      </div>
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button type="submit" className="btn btn-primary">Save Changes</button>
                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : expandedId === p.id ? (
                  <div style={{ paddingBottom: '0' }}>
                    <div style={{ marginBottom: '0' }}>
                      <h4 className="character-section-title" style={{ marginBottom: '0.125rem' }}>Profile</h4>
                      <div className="character-section-content">
                        {renderMultiline(p.profile || '')}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>

      {personas.length === 0 && (
        <div className="text-center py-12">
          <p className="text-secondary mb-4">No personas created yet.</p>
          <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
            Create Your First Persona
          </button>
        </div>
      )}

      {showBulkDeleteModal && (
        <Modal
          open
          onClose={() => setShowBulkDeleteModal(false)}
          title="🗑️ Delete Personas"
          maxWidth="500px"
          footer={
            <div className="flex gap-3 justify-center">
              <button
                className="btn btn-secondary"
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={bulkDeleting}
              >
                Cancel
              </button>
              <button
                className={`btn btn-danger ${bulkDeleting ? 'btn-disabled-muted' : ''}`}
                onClick={bulkDeleteSelected}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} Persona${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          }
        >
          <div className="text-center">
            <p className="mb-4">
              Delete {selectedIds.size} persona{selectedIds.size !== 1 ? 's' : ''}? Every chat belonging to them will be removed too.
            </p>
            <div className="text-sm text-muted mb-4">
              <strong>⚠️ This action cannot be undone.</strong>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
