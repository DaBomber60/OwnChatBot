import { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { fetcher } from '../../lib/fetcher';
import type { Persona, Character, CharacterGroup, Session, Message, LorebookSummary, CharacterLorebooksResponse } from '../../types/models';
import { useClickOutside } from '../../hooks/useClickOutside';
import { PageHeader } from '../../components/PageHeader';
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider, ConfirmDeleteItem } from '../../components/DropdownMenu';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/ToastProvider';
import { LorebookPicker } from '../../components/LorebookPicker';
import { CharacterPicker } from '../../components/CharacterPicker';
import { Avatar } from '../../components/Avatar';
import { characterAvatarUrl, groupAvatarUrl } from '../../lib/avatar';
import { GLOBAL_LOREBOOK_ID } from '../../lib/lorebook/constants';

export default function ChatIndexPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [expandedCharacters, setExpandedCharacters] = useState<Set<number>>(new Set());
  const [cloningSessionId, setCloningSessionId] = useState<number | null>(null);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [editingDescriptionId, setEditingDescriptionId] = useState<number | null>(null);
  const [descriptionText, setDescriptionText] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { data: personas } = useSWR<Persona[]>('/api/personas', fetcher);
  const { data: chars } = useSWR<Character[]>('/api/characters', fetcher);
  const { data: groups } = useSWR<CharacterGroup[]>('/api/character-groups', fetcher);
  const { data: sessions, mutate: mutateSessions } = useSWR<Session[]>('/api/sessions', fetcher);
  const { data: settingsData } = useSWR<Record<string, string>>('/api/settings', fetcher);
  const devMode = settingsData?.devMode === 'true';

  const [selectedPersona, setSelectedPersona] = useState<number>(0);
  const [selectedCharacter, setSelectedCharacter] = useState<number>(0);

  // Lorebooks for the new chat: seeded from the character's defaults, then freely edited.
  const { data: lorebooks } = useSWR<LorebookSummary[]>('/api/lorebooks?view=summary', fetcher);
  const { data: characterLore } = useSWR<CharacterLorebooksResponse>(
    selectedCharacter ? `/api/characters/${selectedCharacter}/lorebooks` : null,
    fetcher
  );
  // The user's lorebook changes for the selected character; until then its defaults apply.
  const [loreEdits, setLoreEdits] = useState<number[] | null>(null);
  const [globalLoreChoice, setGlobalLoreChoice] = useState<boolean | null>(null);
  const globalLoreEnabled = globalLoreChoice ?? settingsData?.globalLoreEnabled !== 'false';

  const loreIds = selectedCharacter ? loreEdits ?? characterLore?.lorebookIds : undefined;
  const hasAnyLore = !!lorebooks && lorebooks.some(lb => lb.id !== GLOBAL_LOREBOOK_ID || lb.entryCount > 0);

  const selectCharacter = (characterId: number) => {
    setSelectedCharacter(characterId);
    setLoreEdits(null);
  };

  const toggleCharacterExpansion = (characterId: number) => {
    setExpandedCharacters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(characterId)) {
        newSet.delete(characterId);
      } else {
        newSet.add(characterId);
      }
      return newSet;
    });
  };

  const startSession = async () => {
    if (!selectedPersona || !selectedCharacter) return;
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personaId: selectedPersona,
        characterId: selectedCharacter,
        globalLoreEnabled,
        // Only send an explicit list once the character's defaults have loaded; otherwise the server applies them.
        ...(loreIds ? { lorebookIds: loreIds } : {}),
      })
    });
    const data = await res.json();
    router.push(`/chat/${data.id}`);
  };

  const cloneSession = async (sessionId: number) => {
    setCloningSessionId(sessionId);
    closeMenu();
    try {
      const res = await fetch(`/api/sessions/${sessionId}/clone`, { method: 'POST' });
      if (!res.ok) throw new Error('Clone failed');
      const data = await res.json();
      await mutateSessions();
      router.push(`/chat/${data.id}`);
    } catch (err) {
      console.error('Error cloning session:', err);
      showToast('Could not clone that chat. Please try again.', 'error');
    } finally {
      setCloningSessionId(null);
    }
  };

  const deleteSession = async (sessionId: number) => {
    await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    setConfirmDeleteId(null);
    mutateSessions();
    closeMenu();
  };

  const toggleSelected = (sessionId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  };

  const toggleSelectAllFor = (characterSessions: Session[]) => {
    const allSelected = characterSessions.every(s => selectedIds.has(s.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      characterSessions.forEach(s => {
        if (allSelected) {
          next.delete(s.id);
        } else {
          next.add(s.id);
        }
      });
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
      const res = await fetch('/api/sessions/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      if (!res.ok) throw new Error('Bulk delete failed');
      await mutateSessions();
      setShowBulkDeleteModal(false);
      exitSelectMode();
    } catch (err) {
      console.error('Error deleting chats:', err);
      showToast('Could not delete the selected chats. Please try again.', 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  const openDescriptionModal = (sessionId: number, currentDescription: string) => {
    setEditingDescriptionId(sessionId);
    setDescriptionText(currentDescription);
    setShowDescriptionModal(true);
    closeMenu();
  };

  const closeDescriptionModal = () => {
    setShowDescriptionModal(false);
    setEditingDescriptionId(null);
    setDescriptionText('');
  };

  const saveDescription = async () => {
    if (!editingDescriptionId) return;
    
    setSavingDescription(true);
    try {
      const response = await fetch(`/api/sessions/${editingDescriptionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: descriptionText.trim()
        })
      });
      
      if (response.ok) {
        await mutateSessions();
        closeDescriptionModal();
      } else {
        throw new Error('Failed to save description');
      }
    } catch (error) {
      console.error('Error saving description:', error);
      showToast('Could not save the description. Please try again.', 'error');
    } finally {
      setSavingDescription(false);
    }
  };

  const closeMenu = () => {
    setOpenMenuId(null);
  };

  useClickOutside(openMenuId !== null, () => setOpenMenuId(null));

  if (!personas || !chars || !groups) {
    return (
      <div className="text-center">
        <div className="card">
          <div className="status-indicator">
            <div className="status-dot status-loading"></div>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Chat - Start New Conversation</title>
        <meta name="description" content="Choose a character and persona to start a new chat conversation." />
      </Head>

      <PageHeader title="Start New Chat" />

      {/* New Chat Section */}
      <div className="card mb-8">
        <div className="card-header">
          <h3 className="card-title">Create New Conversation</h3>
          <p className="card-description">Choose a character and persona to start chatting</p>
        </div>
        
        {chars.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-secondary mb-4">No characters available.</p>
            <button 
              className="btn btn-primary" 
              onClick={() => router.push('/characters')}
            >
              Create Your First Character
            </button>
          </div>
        ) : personas.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-secondary mb-4">No personas available.</p>
            <button 
              className="btn btn-primary" 
              onClick={() => router.push('/personas')}
            >
              Create Your First Persona
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="form-group">
              <label className="form-label" htmlFor="new-chat-character">Select Character</label>
              <CharacterPicker
                id="new-chat-character"
                characters={chars}
                groups={groups}
                value={selectedCharacter}
                onChange={selectCharacter}
              />
            </div>
            
            <div className="form-group">
              <label className="form-label">Select Persona</label>
              <select
                className="form-select"
                value={selectedPersona}
                onChange={e => setSelectedPersona(Number(e.target.value))}
              >
                <option value={0}>Choose a persona...</option>
                {personas
                  .slice()
                  .sort((a, b) => (a.profileName || a.name).localeCompare(b.profileName || b.name, undefined, { sensitivity: 'base' }))
                  .map(p => (
                    <option key={p.id} value={p.id}>{p.profileName || p.name}</option>
                  ))}
              </select>
            </div>
          </div>
        )}

        {chars.length > 0 && personas.length > 0 && selectedCharacter > 0 && hasAnyLore && (
          <div className="form-group">
            <label className="form-label">📖 Lorebooks</label>
            {loreIds ? (
              <LorebookPicker
                lorebooks={lorebooks}
                selectedIds={loreIds}
                onChange={setLoreEdits}
                defaultIds={characterLore?.lorebookIds}
                globalLoreEnabled={globalLoreEnabled}
                onGlobalLoreChange={setGlobalLoreChoice}
              />
            ) : (
              <div className="text-sm text-muted">Loading lorebooks...</div>
            )}
            <small className="text-xs text-muted mt-1">
              The character&apos;s default lorebooks are pre-selected. You can change them later from the chat&apos;s menu.
            </small>
          </div>
        )}
        
        {chars.length > 0 && personas.length > 0 && (
          <div className="text-center">
            <button
              className="btn btn-primary btn-large"
              onClick={startSession}
              disabled={!selectedCharacter || !selectedPersona}
            >
              🚀 Start Conversation
            </button>
          </div>
        )}
      </div>

      {/* Existing Chats Section */}
      {sessions && sessions.length > 0 && (
        <div className="card">
          <div className="card-header chat-list-header">
            <div>
              <h3 className="card-title">Continue Existing Conversations</h3>
              <p className="card-description">Resume your previous chats</p>
            </div>
            {devMode && (
              <div className="select-toolbar">
                {selectMode ? (
                  <>
                    <span className="select-toolbar__count">{selectedIds.size} selected</span>
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
                  <button className="btn btn-secondary btn-small" onClick={() => setSelectMode(true)}>
                    Select
                  </button>
                )}
              </div>
            )}
          </div>
          
          <div className="space-y-6">
            {(() => {
              // Group sessions by character and then by character group
              const sessionsByCharacter = sessions.reduce((groups, session) => {
                const characterId = session.character.id;
                if (!groups[characterId]) {
                  groups[characterId] = {
                    character: session.character,
                    sessions: [],
                    mostRecentUpdate: session.updatedAt
                  };
                }
                groups[characterId].sessions.push(session);
                // Update most recent date if this session is more recent
                if (new Date(session.updatedAt) > new Date(groups[characterId].mostRecentUpdate)) {
                  groups[characterId].mostRecentUpdate = session.updatedAt;
                }
                return groups;
              }, {} as Record<number, { character: Character; sessions: Session[]; mostRecentUpdate: string }>);

              // Now group these character sessions by character groups
              const groupedByCharacterGroup: Array<{
                isGroup: boolean;
                group?: CharacterGroup;
                characterSessions: Array<{ character: Character; sessions: Session[]; mostRecentUpdate: string }>;
              }> = [];

              const groupedCharacterSessions: { [key: number]: Array<{ character: Character; sessions: Session[]; mostRecentUpdate: string }> } = {};
              const ungroupedCharacterSessions: Array<{ character: Character; sessions: Session[]; mostRecentUpdate: string }> = [];

              // Initialize group arrays
              groups?.forEach(group => {
                groupedCharacterSessions[group.id] = [];
              });

              // Sort character sessions into groups
              Object.values(sessionsByCharacter).forEach(characterSession => {
                const groupId = characterSession.character.groupId;
                if (groupId && groupedCharacterSessions[groupId]) {
                  const groupArray = groupedCharacterSessions[groupId];
                  if (groupArray) {
                    groupArray.push(characterSession);
                  }
                } else {
                  ungroupedCharacterSessions.push(characterSession);
                }
              });

              // Add grouped character sessions
              groups?.forEach(group => {
                const groupCharacterSessions = groupedCharacterSessions[group.id] || [];
                if (groupCharacterSessions.length > 0) {
                  // Sort by most recent activity within group
                  groupCharacterSessions.sort((a, b) => new Date(b.mostRecentUpdate).getTime() - new Date(a.mostRecentUpdate).getTime());
                  groupedByCharacterGroup.push({ 
                    isGroup: true, 
                    group, 
                    characterSessions: groupCharacterSessions 
                  });
                }
              });

              // Add ungrouped character sessions
              if (ungroupedCharacterSessions.length > 0) {
                ungroupedCharacterSessions.sort((a, b) => new Date(b.mostRecentUpdate).getTime() - new Date(a.mostRecentUpdate).getTime());
                groupedByCharacterGroup.push({ 
                  isGroup: false, 
                  characterSessions: ungroupedCharacterSessions 
                });
              }

              // Sort groups by their most recent activity
              groupedByCharacterGroup.sort((a, b) => {
                const aMostRecent = Math.max(...a.characterSessions.map(cs => new Date(cs.mostRecentUpdate).getTime()));
                const bMostRecent = Math.max(...b.characterSessions.map(cs => new Date(cs.mostRecentUpdate).getTime()));
                return bMostRecent - aMostRecent;
              });

              return groupedByCharacterGroup.map((groupItem, groupIndex) => (
                <div key={groupIndex}>
                  {groupItem.isGroup && groupItem.group && (
                    <div className="mb-4">
                      <div className="flex items-center gap-3 mb-3">
                        {groupAvatarUrl(groupItem.group) ? (
                          <Avatar name={groupItem.group.name} src={groupAvatarUrl(groupItem.group)} size="1.75rem" />
                        ) : (
                          <div 
                            style={{ 
                              width: '12px', 
                              height: '12px', 
                              backgroundColor: groupItem.group.color, 
                              borderRadius: '2px' 
                            }}
                          ></div>
                        )}
                        <h3 className="text-lg font-semibold text-primary">{groupItem.group.name}</h3>
                        <span className="text-sm text-muted">
                          ({groupItem.characterSessions.length} character{groupItem.characterSessions.length !== 1 ? 's' : ''})
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {groupItem.characterSessions.map(characterGroup => {
                    const isExpanded = expandedCharacters.has(characterGroup.character.id);
                    return (
                      <div key={characterGroup.character.id} className="mb-4">
                        <div className="chat-group-header bg-secondary border border-primary rounded-lg overflow-hidden cursor-pointer">
                          <div 
                            className={`flex items-center justify-between p-4 ${isExpanded ? 'pb-0' : ''}`}
                            onClick={() => toggleCharacterExpansion(characterGroup.character.id)}
                          >
                            <div className="flex items-center gap-3">
                              <Avatar name={characterGroup.character.name} src={characterAvatarUrl(characterGroup.character)} size="2.25rem" />
                              <h4 className="text-lg font-semibold text-primary">
                                {characterGroup.character.name}
                              </h4>
                              {characterGroup.character.profileName && (
                                <span className="text-sm text-secondary italic">({characterGroup.character.profileName})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3">
                              {selectMode && (
                                <button
                                  className="btn btn-secondary btn-small"
                                  onClick={e => {
                                    e.stopPropagation();
                                    toggleSelectAllFor(characterGroup.sessions);
                                  }}
                                >
                                  {characterGroup.sessions.every(s => selectedIds.has(s.id)) ? 'Deselect all' : 'Select all'}
                                </button>
                              )}
                              <span className="text-xs text-muted">
                                {characterGroup.sessions.length} conversation{characterGroup.sessions.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="border-t border-primary p-4 space-y-3">
                              {characterGroup.sessions
                                .sort((a: Session, b: Session) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                                .map((s: Session) => (
                                  <div 
                                    key={s.id} 
                                    className={`chat-list-item bg-secondary border border-primary rounded-lg p-4 cursor-pointer${selectMode && selectedIds.has(s.id) ? ' select-item--selected' : ''}`}
                                    onClick={() => (selectMode ? toggleSelected(s.id) : router.push(`/chat/${s.id}`))}
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      {selectMode && (
                                        <input
                                          type="checkbox"
                                          className="form-checkbox"
                                          checked={selectedIds.has(s.id)}
                                          onChange={() => toggleSelected(s.id)}
                                          onClick={e => e.stopPropagation()}
                                          aria-label={`Select chat with ${s.persona.name}`}
                                        />
                                      )}
                                      <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1">
                                          <h5 className="font-medium text-primary">{s.persona.name}</h5>
                                          {s.persona.profileName && (
                                            <span className="text-xs text-secondary italic">({s.persona.profileName})</span>
                                          )}
                                        </div>
                                        <p className="text-xs text-secondary italic mb-1">
                                          {s.description 
                                            ? s.description 
                                            : s.summary 
                                              ? s.summary.length > 100 
                                                ? `${s.summary.substring(0, 100)}...` 
                                                : s.summary
                                              : 'No summary available'
                                          }
                                        </p>
                                        <div className="flex items-center gap-4 text-xs text-muted">
                                          <span>💬 {s.messageCount} message{s.messageCount !== 1 ? 's' : ''}</span>
                                          <span>🕒 {new Date(s.updatedAt).toLocaleDateString()} at {new Date(s.updatedAt).toLocaleTimeString()}</span>
                                        </div>
                                      </div>
                                      
                                      {!selectMode && (
                                      <DropdownMenu
                                        entityId={s.id}
                                        isOpen={openMenuId === s.id}
                                        onToggle={() => setOpenMenuId(s.id)}
                                        onClose={closeMenu}
                                        triggerChar="⋮"
                                        stopPropagation
                                        triggerStyle={{ minWidth: '32px' }}
                                      >
                                        <DropdownMenuItem
                                          icon="📝"
                                          label={`${s.description ? 'Edit' : 'Add'} Description`}
                                          onClick={() => openDescriptionModal(s.id, s.description || '')}
                                          stopPropagation
                                        />
                                        <DropdownMenuItem
                                          icon={cloningSessionId === s.id ? '⏳' : '📋'}
                                          label="Clone Chat"
                                          onClick={() => cloneSession(s.id)}
                                          disabled={cloningSessionId === s.id}
                                          stopPropagation
                                        />
                                        <DropdownMenuDivider />
                                        <ConfirmDeleteItem
                                          label="Delete Chat"
                                          isConfirming={confirmDeleteId === s.id}
                                          onRequestDelete={() => setConfirmDeleteId(s.id)}
                                          onConfirm={() => deleteSession(s.id)}
                                          onCancel={() => {
                                            setConfirmDeleteId(null);
                                            closeMenu();
                                          }}
                                          stopPropagation
                                        />
                                      </DropdownMenu>
                                      )}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* No sessions message */}
      {(!sessions || sessions.length === 0) && (
        <div className="text-center py-12">
          <p className="text-muted text-sm">Start your first chat above!</p>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <Modal
          open
          onClose={() => setShowBulkDeleteModal(false)}
          title="🗑️ Delete Chats"
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
                {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} Chat${selectedIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          }
        >
          <div className="text-center">
            <p className="mb-4">
              Delete {selectedIds.size} chat{selectedIds.size !== 1 ? 's' : ''}? All of their messages will be removed too.
            </p>
            <div className="text-sm text-muted mb-4">
              <strong>⚠️ This action cannot be undone.</strong>
            </div>
          </div>
        </Modal>
      )}

      {/* Description Modal */}
      {showDescriptionModal && (
        <Modal
          open
          onClose={closeDescriptionModal}
          title={descriptionText.trim() ? 'Edit Description' : 'Add Description'}
          footer={
            <div className="flex gap-3">
              <button 
                className="btn btn-secondary" 
                onClick={closeDescriptionModal}
                disabled={savingDescription}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={saveDescription}
                disabled={savingDescription}
              >
                {savingDescription ? 'Saving...' : 'Save Description'}
              </button>
            </div>
          }
        >
          <div className="form-group mb-0">
            <label className="form-label mt-2">Chat Description</label>
            <textarea
              className="form-input"
              rows={4}
              value={descriptionText}
              onChange={e => setDescriptionText(e.target.value)}
              placeholder="Enter a description for this chat conversation..."
              maxLength={500}
            />
            <p className="text-xs text-muted mt-1">
              {descriptionText.length}/500 characters
            </p>
          </div>
          
          <div className="bg-info rounded-lg p-3 text-sm">
            <p className="mb-2">
              💡 <strong>Tip:</strong> Descriptions help you quickly identify and organize your conversations.
            </p>
            <p className="mb-4">
              They will be displayed instead of the auto-generated summary in the chat list.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
