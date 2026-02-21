import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { fetcher } from '../../lib/fetcher';
import type { Persona, Character, CharacterGroup, Session, Message } from '../../types/models';

// Pure function — defined outside the component so its reference is stable.
function organizeCharactersForDisplay(
  chars: Character[] | undefined,
  groups: CharacterGroup[] | undefined
): Array<{
  isGroup: boolean;
  isHeader: boolean;
  group?: CharacterGroup;
  character?: Character;
  headerText?: string;
}> {
  if (!chars || !groups) return [];

  const organizedCharacters: Array<{
    isGroup: boolean;
    isHeader: boolean;
    group?: CharacterGroup;
    character?: Character;
    headerText?: string;
  }> = [];

  // Create a map of grouped characters
  const grouped: { [key: number]: Character[] } = {};
  const ungrouped: Character[] = [];

  // Initialize group arrays
  groups.forEach(group => {
    grouped[group.id] = [];
  });

  // Sort characters into groups
  chars.forEach(char => {
    if (char.groupId && grouped[char.groupId]) {
      const groupArray = grouped[char.groupId];
      if (groupArray) {
        groupArray.push(char);
      }
    } else {
      ungrouped.push(char);
    }
  });

  // Sort groups alphabetically by name
  const sortedGroups = [...groups].sort((a, b) => a.name.localeCompare(b.name));

  // Check if there are any groups with characters
  const hasGroupedCharacters = sortedGroups.some(group => (grouped[group.id] || []).length > 0);

  // Add grouped characters
  sortedGroups.forEach(group => {
    const groupCharacters = grouped[group.id] || [];
    if (groupCharacters.length > 0) {
      organizedCharacters.push({ isGroup: true, isHeader: true, group, headerText: group.name });
      groupCharacters.sort((a, b) => (a.profileName || a.name).localeCompare(b.profileName || b.name));
      groupCharacters.forEach(char => {
        organizedCharacters.push({ isGroup: false, isHeader: false, character: char });
      });
    }
  });

  // Add "UNGROUPED:" header and ungrouped characters
  if (ungrouped.length > 0) {
    if (hasGroupedCharacters) {
      organizedCharacters.push({ isGroup: false, isHeader: true, headerText: "UNGROUPED:" });
    }
    ungrouped.sort((a, b) => (a.profileName || a.name).localeCompare(b.profileName || b.name));
    ungrouped.forEach(char => {
      organizedCharacters.push({ isGroup: false, isHeader: false, character: char });
    });
  }

  return organizedCharacters;
}

export default function ChatIndexPage() {
  const router = useRouter();
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [expandedCharacters, setExpandedCharacters] = useState<Set<number>>(new Set());
  const [cloningSessionId, setCloningSessionId] = useState<number | null>(null);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [editingDescriptionId, setEditingDescriptionId] = useState<number | null>(null);
  const [descriptionText, setDescriptionText] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const { data: personas } = useSWR<Persona[]>('/api/personas', fetcher);
  const { data: chars } = useSWR<Character[]>('/api/characters', fetcher);
  const { data: groups } = useSWR<CharacterGroup[]>('/api/character-groups', fetcher);
  const { data: sessions, mutate: mutateSessions } = useSWR<Session[]>('/api/sessions', fetcher);

  const [selectedPersona, setSelectedPersona] = useState<number>(0);
  const [selectedCharacter, setSelectedCharacter] = useState<number>(0);

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
      body: JSON.stringify({ personaId: selectedPersona, characterId: selectedCharacter })
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
      alert('Failed to clone session. Please try again.');
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
      alert('Failed to save description. Please try again.');
    } finally {
      setSavingDescription(false);
    }
  };

  const closeMenu = () => {
    setOpenMenuId(null);
  };

  // Click outside and keyboard handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openMenuId) {
        setOpenMenuId(null);
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (openMenuId) {
        const target = event.target as HTMLElement;
        if (!target.closest('.menu-container')) {
          setOpenMenuId(null);
        }
      }
    };

    if (openMenuId) {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [openMenuId]);

  const organizedChars = useMemo(
    () => organizeCharactersForDisplay(chars, groups),
    [chars, groups]
  );

  if (!personas || !chars || !groups) {
    return (
      <div className="container text-center">
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
    <div className="container">
      <Head>
        <title>Chat - Start New Conversation</title>
        <meta name="description" content="Choose a character and persona to start a new chat conversation." />
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold mb-0">Start New Chat</h1>
        <button className="btn btn-secondary" onClick={() => router.push('/')}>
          🏠 Home
        </button>
      </div>

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
              <label className="form-label">Select Character</label>
              <select
                className="form-select"
                value={selectedCharacter}
                onChange={e => setSelectedCharacter(Number(e.target.value))}
              >
                <option value={0}>Choose a character...</option>
                {organizedChars.map((item, index) => {
                  if (item.isHeader) {
                    return (
                      <option 
                        key={`header-${index}`} 
                        value={0} 
                        disabled 
                        style={{ 
                          color: 'var(--text-primary-dark)', 
                          fontWeight: 'bold',
                          backgroundColor: 'var(--bg-tertiary)'
                        }}
                      >
                        {item.headerText}
                      </option>
                    );
                  } else if (item.character) {
                    return (
                      <option key={item.character.id} value={item.character.id}>
                        {item.character.profileName || item.character.name}
                      </option>
                    );
                  }
                  return null;
                })}
              </select>
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
          <div className="card-header">
            <h3 className="card-title">Continue Existing Conversations</h3>
            <p className="card-description">Resume your previous chats</p>
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
                        <div 
                          style={{ 
                            width: '12px', 
                            height: '12px', 
                            backgroundColor: groupItem.group.color, 
                            borderRadius: '2px' 
                          }}
                        ></div>
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
                              <h4 className="text-lg font-semibold text-primary">
                                {groupItem.isGroup ? characterGroup.character.name : characterGroup.character.name}
                              </h4>
                              {characterGroup.character.profileName && (
                                <span className="text-sm text-secondary italic">({characterGroup.character.profileName})</span>
                              )}
                            </div>
                            <span className="text-xs text-muted">
                              {characterGroup.sessions.length} conversation{characterGroup.sessions.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          
                          {isExpanded && (
                            <div className="border-t border-primary p-4 space-y-3">
                              {characterGroup.sessions
                                .sort((a: Session, b: Session) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                                .map((s: Session) => (
                                  <div 
                                    key={s.id} 
                                    className="chat-list-item bg-secondary border border-primary rounded-lg p-4 cursor-pointer"
                                    onClick={() => router.push(`/chat/${s.id}`)}
                                  >
                                    <div className="flex items-center justify-between">
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
                                      
                                      <div 
                                        className="menu-container relative"
                                        onClick={(e) => e.stopPropagation()}
                                        style={{
                                          height: openMenuId === s.id ? '2rem' : 'auto',
                                          minHeight: openMenuId === s.id ? '2rem' : 'auto',
                                          zIndex: openMenuId === s.id ? 999999 : 'auto'
                                        }}
                                      >
                                        {openMenuId !== s.id && (
                                          <button
                                            className="btn btn-secondary btn-small"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setOpenMenuId(s.id);
                                            }}
                                            aria-label="More options"
                                            style={{ minWidth: '32px' }}
                                          >
                                            ⋮
                                          </button>
                                        )}
                                        
                                        {/* Dropdown Menu */}
                                        {openMenuId === s.id && (
                                          <div
                                            className="absolute right-0 min-w-48 overflow-hidden"
                                            style={{
                                              top: '0',
                                              backgroundColor: 'var(--bg-secondary)',
                                              border: '1px solid var(--border-primary)',
                                              borderRadius: 'var(--radius-lg)',
                                              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
                                              zIndex: 999999
                                            }}
                                          >
                                            <div>
                                              <button
                                                className="w-full text-left text-sm transition-colors duration-150 flex items-center gap-3"
                                                style={{
                                                  color: 'var(--text-primary)',
                                                  backgroundColor: 'transparent',
                                                  border: 'none',
                                                  padding: '12px 20px'
                                                }}
                                                onMouseEnter={(e) => {
                                                  e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                                }}
                                                onMouseLeave={(e) => {
                                                  e.currentTarget.style.backgroundColor = 'transparent';
                                                }}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openDescriptionModal(s.id, s.description || '');
                                                }}
                                              >
                                                <span className="text-base">📝</span>
                                                <span className="font-medium">{s.description ? 'Edit' : 'Add'} Description</span>
                                              </button>
                                              
                                              <button
                                                className="w-full text-left text-sm transition-colors duration-150 flex items-center gap-3"
                                                style={{
                                                  color: 'var(--text-primary)',
                                                  backgroundColor: 'transparent',
                                                  border: 'none',
                                                  padding: '12px 20px'
                                                }}
                                                onMouseEnter={(e) => {
                                                  if (!e.currentTarget.disabled) {
                                                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                                  }
                                                }}
                                                onMouseLeave={(e) => {
                                                  e.currentTarget.style.backgroundColor = 'transparent';
                                                }}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  cloneSession(s.id);
                                                }}
                                                disabled={cloningSessionId === s.id}
                                              >
                                                <span className="text-base">{cloningSessionId === s.id ? '⏳' : '📋'}</span>
                                                <span className="font-medium">Clone Chat</span>
                                              </button>
                                              
                                              <div style={{ 
                                                height: '1px', 
                                                backgroundColor: 'var(--border-secondary)', 
                                                margin: '8px 20px' 
                                              }}></div>
                                              
                                              {confirmDeleteId === s.id ? (
                                                <>
                                                  <button
                                                    className="w-full text-left text-sm transition-colors duration-150 flex items-center gap-3 font-medium"
                                                    style={{
                                                      color: 'var(--error)',
                                                      backgroundColor: 'transparent',
                                                      border: 'none',
                                                      padding: '12px 20px'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.backgroundColor = 'transparent';
                                                    }}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      deleteSession(s.id);
                                                    }}
                                                  >
                                                    <span className="text-base">✓</span>
                                                    <span>Confirm Delete</span>
                                                  </button>
                                                  <button
                                                    className="w-full text-left text-sm transition-colors duration-150 flex items-center gap-3"
                                                    style={{
                                                      color: 'var(--text-primary)',
                                                      backgroundColor: 'transparent',
                                                      border: 'none',
                                                      padding: '12px 20px'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                      e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                      e.currentTarget.style.backgroundColor = 'transparent';
                                                    }}
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setConfirmDeleteId(null);
                                                      closeMenu();
                                                    }}
                                                  >
                                                    <span className="text-base">✕</span>
                                                    <span className="font-medium">Cancel</span>
                                                  </button>
                                                </>
                                              ) : (
                                                <button
                                                  className="w-full text-left text-sm transition-colors duration-150 flex items-center gap-3"
                                                  style={{
                                                    color: 'var(--error)',
                                                    backgroundColor: 'transparent',
                                                    border: 'none',
                                                    padding: '12px 20px'
                                                  }}
                                                  onMouseEnter={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                                                  }}
                                                  onMouseLeave={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                  }}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setConfirmDeleteId(s.id);
                                                  }}
                                                >
                                                  <span className="text-base">🗑️</span>
                                                  <span className="font-medium">Delete Chat</span>
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
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

      {/* Description Modal */}
      {showDescriptionModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeDescriptionModal()}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="text-2xl font-semibold text-primary mb-0">
                {descriptionText.trim() ? 'Edit Description' : 'Add Description'}
              </h2>
            </div>
            
            <div className="modal-body">
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
            </div>
            
            <div className="modal-footer">
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
