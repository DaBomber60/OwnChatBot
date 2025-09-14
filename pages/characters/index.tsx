import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const fetcher = (url: string) => fetch(url).then(res => res.json());

type Character = {
  id: number;
  name: string;
  profileName?: string;
  bio?: string;
  scenario: string;
  personality: string;
  firstMessage: string;
  exampleDialogue: string;
  groupId?: number | null;
  sortOrder?: number;
  group?: CharacterGroup | null;
};

type CharacterGroup = {
  id: number;
  name: string;
  color: string;
  isCollapsed: boolean;
  sortOrder: number;
  characters: Character[];
};

// Utility to render multiline text with paragraphs
function renderMultiline(text: string) {
  return text.split(/\r?\n/).map((line, idx) => (
    <p key={idx} style={{ margin: '0.05rem 0' }}>{line}</p>
  ));
}

// Utility to get preview text for character cards
function getCharacterPreview(character: Character): { text: string; label: string } | null {
  // If there's a bio, use it
  if (character.bio && character.bio.trim()) {
    const text = character.bio.length > 120 ? character.bio.substring(0, 120) + '...' : character.bio;
    return { text, label: 'Bio' };
  }
  
  // If no bio, use personality
  if (character.personality && character.personality.trim()) {
    const text = character.personality.length > 120 ? character.personality.substring(0, 120) + '...' : character.personality;
    return { text, label: 'Personality' };
  }
  
  // If no bio or personality, use scenario
  if (character.scenario && character.scenario.trim()) {
    const text = character.scenario.length > 120 ? character.scenario.substring(0, 120) + '...' : character.scenario;
    return { text, label: 'Scenario' };
  }
  
  return null;
}

// Sortable Character Card Component with dnd-kit
function SortableCharacterCard({ 
  character, 
  expandedId, 
  setExpandedId, 
  editingId, 
  setEditingId,
  editName,
  setEditName,
  editProfileName,
  setEditProfileName,
  editBio,
  setEditBio,
  editScenario,
  setEditScenario,
  editPersonality,
  setEditPersonality,
  editFirstMessage,
  setEditFirstMessage,
  editExampleDialogue,
  setEditExampleDialogue,
  openMenuId,
  setOpenMenuId,
  confirmDeleteId,
  setConfirmDeleteId,
  onClone,
  onDelete,
  mutate,
  closeMenu,
  disableDrag = false
}: {
  character: Character;
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  editingId: number | null;
  setEditingId: (id: number | null) => void;
  editName: string;
  setEditName: (name: string) => void;
  editProfileName: string;
  setEditProfileName: (name: string) => void;
  editBio: string;
  setEditBio: (bio: string) => void;
  editScenario: string;
  setEditScenario: (scenario: string) => void;
  editPersonality: string;
  setEditPersonality: (personality: string) => void;
  editFirstMessage: string;
  setEditFirstMessage: (message: string) => void;
  editExampleDialogue: string;
  setEditExampleDialogue: (dialogue: string) => void;
  openMenuId: number | string | null;
  setOpenMenuId: (id: number | string | null) => void;
  confirmDeleteId: number | null;
  setConfirmDeleteId: (id: number | null) => void;
  onClone: (character: Character) => void;
  onDelete: (id: number) => void;
  mutate: () => void;
  closeMenu: () => void;
  disableDrag?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `character-${character.id}`,
    disabled: editingId === character.id || disableDrag,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const toggleMenu = (characterId: number) => {
    setOpenMenuId(openMenuId === characterId ? null : characterId);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`card ${editingId !== character.id ? 'cursor-pointer' : ''} ${isDragging ? 'shadow-lg z-50' : ''}`}
      onClick={editingId !== character.id ? () => setExpandedId(expandedId === character.id ? null : character.id) : undefined}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {!disableDrag && (
              <div
                className="cursor-grab hover:cursor-grabbing text-gray-400 hover:text-gray-600"
                style={{
                  // Keep original visual size - just like before
                  padding: '4px',
                  position: 'relative',
                  fontSize: '12px',
                  lineHeight: '1',
                  userSelect: 'none'
                }}
                onClick={(e) => e.stopPropagation()}
                title="Drag to move"
              >
                {/* Large invisible touch target that extends beyond the visual element */}
                <div
                  {...(listeners as any)}
                  style={{
                    position: 'absolute',
                    top: '-16px',    // Extend 16px above
                    left: '-16px',   // Extend 16px to the left
                    right: '-16px',  // Extend 16px to the right
                    bottom: '-16px', // Extend 16px below
                    cursor: 'grab',
                    zIndex: 1
                  }}
                />
                ⋮⋮
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-primary">{character.name}</h3>
              {character.profileName && (
                <p className="text-sm text-secondary italic" style={{ marginTop: '-1rem', marginBottom: '-0.25rem' }}>{character.profileName}</p>
              )}
              {(() => {
                const preview = getCharacterPreview(character);
                if (preview) {
                  return (
                    <div style={{ marginTop: '0.5rem' }}>
                      <span className="text-s font-medium text-accent uppercase tracking-wide">
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
          </div>
        </div>
        <div className="flex gap-4" onClick={(e) => e.stopPropagation()}>
          <div 
            className="menu-container relative"
            style={{
              height: openMenuId === character.id ? '2rem' : 'auto',
              minHeight: openMenuId === character.id ? '2rem' : 'auto',
              zIndex: openMenuId === character.id ? 999999 : 'auto'
            }}
          >
            {openMenuId !== character.id && (
              <button
                className="btn btn-secondary btn-small"
                onClick={() => toggleMenu(character.id)}
                title="More actions"
              >
                ⋯
              </button>
            )}
            
            {openMenuId === character.id && (
              <div 
                className="absolute right-0 min-w-48 overflow-hidden"
                style={{
                  top: openMenuId === character.id ? '0' : 'calc(100% + 4px)',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: 'var(--radius-lg)',
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
                  zIndex: 999999
                }}
              >
                <div>
                  <button
                    className="w-full text-left text-sm transition-colors duration-150 flex items-center gap-3 font-medium"
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
                    onClick={() => {
                      setEditingId(character.id);
                      setEditName(character.name);
                      setEditProfileName(character.profileName || '');
                      setEditBio(character.bio || '');
                      setEditScenario(character.scenario);
                      setEditPersonality(character.personality);
                      setEditFirstMessage(character.firstMessage);
                      setEditExampleDialogue(character.exampleDialogue);
                      closeMenu();
                    }}
                  >
                    <span className="text-base">✏️</span>
                    <span className="font-medium">Edit Character</span>
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
                    onClick={() => onClone(character)}
                  >
                    <span className="text-base">📋</span>
                    <span className="font-medium">Clone Character</span>
                  </button>
                  
                  <div style={{ 
                    height: '1px', 
                    backgroundColor: 'var(--border-secondary)', 
                    margin: '8px 20px' 
                  }}></div>
                  
                  {confirmDeleteId === character.id ? (
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
                        onClick={() => onDelete(character.id)}
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
                        onClick={() => {
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
                      onClick={() => {
                        setConfirmDeleteId(character.id);
                      }}
                    >
                      <span className="text-base">🗑️</span>
                      <span>Delete Character</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Full content when expanded or editing */}
      {(expandedId === character.id || editingId === character.id) && (
        <div style={{ marginTop: '0.25rem', marginBottom: '0', paddingBottom: '0' }}>
          {editingId === character.id ? (
            <form onSubmit={async (e) => {
              e.preventDefault();
              await fetch(`/api/characters/${character.id}`, {
                method: 'PUT',
                headers: {'Content-Type':'application/json'},
                body: JSON.stringify({
                  name: editName,
                  // Send empty strings instead of null; backend schema normalizes
                  profileName: editProfileName || '',
                  bio: editBio || '',
                  scenario: editScenario, personality: editPersonality, 
                  firstMessage: editFirstMessage, exampleDialogue: editExampleDialogue
                })
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
                  <label className="form-label">Bio (Optional)</label>
                  <textarea 
                    className="form-textarea"
                    value={editBio} 
                    onChange={e => setEditBio(e.target.value)}
                    placeholder="Brief description to help identify this character..."
                    rows={2}
                  />
                  <small className="text-xs text-muted mt-1">Personal notes about this character - not sent to AI</small>
                </div>
                <div className="form-group">
                  <label className="form-label">Scenario</label>
                  <textarea 
                    className="form-textarea"
                    value={editScenario} 
                    onChange={e => setEditScenario(e.target.value)}
                    rows={3}
                    placeholder="Describe the setting and context..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Personality</label>
                  <textarea 
                    className="form-textarea"
                    value={editPersonality} 
                    onChange={e => setEditPersonality(e.target.value)}
                    rows={3}
                    placeholder="Describe personality traits, quirks, and behavior..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">First Message</label>
                  <textarea 
                    className="form-textarea"
                    value={editFirstMessage} 
                    onChange={e => setEditFirstMessage(e.target.value)}
                    rows={3}
                    placeholder="The character's opening message..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Example Dialogue</label>
                  <textarea 
                    className="form-textarea"
                    value={editExampleDialogue} 
                    onChange={e => setEditExampleDialogue(e.target.value)}
                    rows={4}
                    placeholder="Sample conversation showing the character's speaking style..."
                  />
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 mt-2">
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
          ) : expandedId === character.id ? (
            <div style={{ paddingBottom: '0', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div className="character-section" style={{ marginBottom: '0' }}>
                <h4 className="character-section-title" style={{ marginBottom: '0.125rem' }}>Scenario</h4>
                <div className="character-section-content">
                  {renderMultiline(character.scenario)}
                </div>
              </div>
              
              <div className="character-section" style={{ marginBottom: '0' }}>
                <h4 className="character-section-title" style={{ marginBottom: '0.125rem' }}>Personality</h4>
                <div className="character-section-content">
                  {renderMultiline(character.personality)}
                </div>
              </div>
              
              <div className="character-section" style={{ marginBottom: '0' }}>
                <h4 className="character-section-title" style={{ marginBottom: '0.125rem' }}>First Message</h4>
                <div className="character-section-content">
                  {renderMultiline(character.firstMessage)}
                </div>
              </div>
              
              <div className="character-section" style={{ marginBottom: '0' }}>
                <h4 className="character-section-title" style={{ marginBottom: '0.125rem' }}>Example Dialogue</h4>
                <div className="character-section-content">
                  {renderMultiline(character.exampleDialogue)}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Droppable Area Component for dnd-kit
function DroppableArea({ 
  id, 
  children, 
  className = '',
  style = {}
}: { 
  id: string; 
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: id,
  });

  return (
    <div
      ref={setNodeRef}
      id={id}
      className={className}
      style={{
        ...style,
        backgroundColor: isOver ? 'rgba(139, 92, 246, 0.1)' : undefined,
        borderColor: isOver ? 'var(--border-accent)' : undefined,
        transition: 'all 0.2s ease'
      }}
    >
      {children}
    </div>
  );
}

export default function CharactersPage() {
  const router = useRouter();
  const { data: chars, error, mutate } = useSWR<Character[]>('/api/characters', fetcher);
  const { data: groups, error: groupsError, mutate: mutateGroups } = useSWR<CharacterGroup[]>('/api/character-groups', fetcher);
  
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [profileName, setProfileName] = useState('');
  const [bio, setBio] = useState('');
  const [scenario, setScenario] = useState('');
  const [personality, setPersonality] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [exampleDialogue, setExampleDialogue] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editProfileName, setEditProfileName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editScenario, setEditScenario] = useState('');
  const [editPersonality, setEditPersonality] = useState('');
  const [editFirstMessage, setEditFirstMessage] = useState('');
  const [editExampleDialogue, setEditExampleDialogue] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Group management state
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#6366f1');
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupColor, setEditGroupColor] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<number | null>(null);
  
  // Drag and drop state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Cleanup effect for component unmount and route changes
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

    // Cleanup on unmount
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [openMenuId]);

  const toggleMenu = (characterId: number) => {
    setOpenMenuId(openMenuId === characterId ? null : characterId);
  };

  const closeMenu = () => {
    setOpenMenuId(null);
  };

  const cloneCharacter = (character: Character) => {
    // Fill the create form with character data and append " - [Clone]" to profile name
    setName(character.name);
    setProfileName(character.profileName ? `${character.profileName} - [Clone]` : `${character.name} - [Clone]`);
    setBio(character.bio || '');
    setScenario(character.scenario);
    setPersonality(character.personality);
    setFirstMessage(character.firstMessage);
    setExampleDialogue(character.exampleDialogue);
    
    // Open the create form and close the menu
    setIsAdding(true);
    closeMenu();
    
    // Scroll to top to show the create form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Group management functions
  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) {
      alert('Please enter a group name.');
      return;
    }

    try {
      const res = await fetch('/api/character-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName.trim(), color: newGroupColor })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to create group', err);
        alert('Error creating group: ' + (err.error || 'Unknown error'));
        return;
      }

      setIsCreatingGroup(false);
      setNewGroupName('');
      setNewGroupColor('#6366f1');
      mutateGroups();
    } catch (error) {
      console.error('Error creating group:', error);
      alert('Error creating group');
    }
  };

  const updateGroup = async (groupId: number, updates: Partial<CharacterGroup>) => {
    try {
      const res = await fetch(`/api/character-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to update group', err);
        alert('Error updating group: ' + (err.error || 'Unknown error'));
        return;
      }

      mutateGroups();
    } catch (error) {
      console.error('Error updating group:', error);
      alert('Error updating group');
    }
  };

  const deleteGroup = async (groupId: number) => {
    try {
      const res = await fetch(`/api/character-groups/${groupId}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to delete group', err);
        alert('Error deleting group: ' + (err.error || 'Unknown error'));
        return;
      }

      setConfirmDeleteGroupId(null);
      mutateGroups();
      mutate(); // Refresh characters too since they'll be ungrouped
    } catch (error) {
      console.error('Error deleting group:', error);
      alert('Error deleting group');
    }
  };

  const toggleGroupCollapse = (groupId: number) => {
    const group = groups?.find(g => g.id === groupId);
    if (group) {
      updateGroup(groupId, { isCollapsed: !group.isCollapsed });
    }
  };

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setIsDragging(true);
    
    // Prevent scrolling during drag on mobile
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    // Re-enable scrolling
    document.body.style.overflow = '';
    document.body.style.touchAction = '';

    if (!over || active.id === over.id) {
      // Clear activeId immediately if no valid drop
      setActiveId(null);
      setIsDragging(false);
      return;
    }

    const characterId = parseInt((active.id as string).replace('character-', ''));
    let newGroupId: number | null = null;

    // Determine the target group
    if (over.id !== 'ungrouped') {
      if ((over.id as string).startsWith('group-')) {
        // Extract group ID from either 'group-X' or 'group-X-content'
        const groupIdMatch = (over.id as string).match(/^group-(\d+)/);
        if (groupIdMatch && groupIdMatch[1]) {
          newGroupId = parseInt(groupIdMatch[1]);
        }
      } else if ((over.id as string).startsWith('character-')) {
        // Dropped on another character, find its group
        const targetCharacterId = parseInt((over.id as string).replace('character-', ''));
        const targetCharacter = chars?.find(c => c.id === targetCharacterId);
        newGroupId = targetCharacter?.groupId || null;
      }
    }

    try {
      const res = await fetch('/api/characters/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          groupId: newGroupId
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Failed to move character', err);
        alert('Error moving character: ' + (err.error || 'Unknown error'));
        // Clear drag state on error
        setActiveId(null);
        setIsDragging(false);
        return;
      }

      // Refresh both characters and groups
      await Promise.all([mutate(), mutateGroups()]);
      
      // Small delay to let the UI update before clearing drag state
      setTimeout(() => {
        setActiveId(null);
        setIsDragging(false);
      }, 50);

    } catch (error) {
      console.error('Error moving character:', error);
      alert('Error moving character');
      // Clear drag state on error
      setActiveId(null);
      setIsDragging(false);
    }
  };

  // Organize characters by groups
  const organizeCharacters = () => {
    if (!chars || !groups) return { grouped: {}, ungrouped: [] };

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

    // Sort characters within each group by sortOrder
    Object.keys(grouped).forEach(groupId => {
      const groupArray = grouped[parseInt(groupId)];
      if (groupArray) {
        groupArray.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      }
    });

    // Sort ungrouped characters by sortOrder
    ungrouped.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    return { grouped, ungrouped };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // client-side validation - only name is required
    if (!name.trim()) {
      alert('Please enter a character name.');
      return;
    }
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name, 
  profileName: profileName || '', 
  bio: bio || '', 
        scenario, 
        personality, 
        firstMessage, 
        exampleDialogue, 
        groupId: selectedGroupId 
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('Failed to add character', err);
      alert('Error adding character: ' + (err.error || 'Unknown error'));
      return;
    }
    setIsAdding(false);
    setName(''); setProfileName(''); setBio(''); setScenario(''); setPersonality(''); setFirstMessage(''); setExampleDialogue(''); setSelectedGroupId(null);
    mutate();
  };

  // Handle loading state
  if (!chars || !groups) return <div className="container text-center">Loading...</div>;

  // Validate data shapes (in case API returned an error object due to auth)
  const charsIsArray = Array.isArray(chars);
  const groupsIsArray = Array.isArray(groups);
  if (!charsIsArray || !groupsIsArray || error || groupsError) {
    return (
      <div className="container text-center text-error">
        <p>Failed to load characters or groups.</p>
        {!charsIsArray && <p>Characters response was not a list (maybe not authenticated).</p>}
        {!groupsIsArray && <p>Groups response was not a list (maybe not authenticated).</p>}
        <button className="btn btn-secondary mt-4" onClick={() => { location.reload(); }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="container">
      <Head>
        <title>Characters - AI Character Builder</title>
        <meta name="description" content="Create and manage AI characters with detailed personalities, scenarios, and backstories for immersive conversations." />
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold mb-0">Characters</h1>
        <button className="btn btn-secondary" onClick={() => router.push('/')}>
          🏠 Home
        </button>
      </div>

      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Create New Character</h3>
          <p className="card-description">Design detailed AI characters with personalities and backgrounds</p>
        </div>
        
        {isAdding ? (
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Character Name</label>
                <input 
                  className="form-input"
                  value={name} 
                  onChange={e => setName(e.target.value)}
                  placeholder="Enter character name (used in chats)"
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
                <label className="form-label">Bio (Optional)</label>
                <textarea 
                  className="form-textarea"
                  value={bio} 
                  onChange={e => setBio(e.target.value)}
                  placeholder="Brief description to help identify this character..."
                  rows={2}
                />
                <small className="text-xs text-muted mt-1">Personal notes about this character - not sent to AI</small>
              </div>
              <div className="form-group">
                <label className="form-label">Group (Optional)</label>
                <select 
                  className="form-input"
                  value={selectedGroupId || ''}
                  onChange={e => setSelectedGroupId(e.target.value ? parseInt(e.target.value) : null)}
                >
                  <option value="">No Group</option>
                  {groups?.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <small className="text-xs text-muted mt-1">Assign this character to a group for better organization</small>
              </div>
              <div className="form-group">
                <label className="form-label">Scenario</label>
                <textarea 
                  className="form-textarea"
                  value={scenario} 
                  onChange={e => setScenario(e.target.value)}
                  placeholder="Describe the setting and context..."
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Personality</label>
                <textarea 
                  className="form-textarea"
                  value={personality} 
                  onChange={e => setPersonality(e.target.value)}
                  placeholder="Describe personality traits, quirks, and behavior..."
                  rows={3}
                />
              </div>
              <div className="form-group">
                <label className="form-label">First Message</label>
                <textarea 
                  className="form-textarea"
                  value={firstMessage} 
                  onChange={e => setFirstMessage(e.target.value)}
                  placeholder="The character's opening message..."
                  rows={3}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Example Dialogue</label>
              <textarea 
                className="form-textarea"
                value={exampleDialogue} 
                onChange={e => setExampleDialogue(e.target.value)}
                placeholder="Sample conversation showing the character's speaking style..."
                rows={4}
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button type="submit" className="btn btn-primary">Create Character</button>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => {
                  setIsAdding(false);
                  setName(''); setProfileName(''); setBio(''); setScenario(''); setPersonality(''); setFirstMessage(''); setExampleDialogue(''); setSelectedGroupId(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="button-container">
            <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
              + New Character
            </button>
            <style jsx>{`
              .button-container {
                display: flex;
                flex-direction: column;
                gap: 12px;
              }
              @media (min-width: 640px) {
                .button-container {
                  flex-direction: row;
                }
              }
            `}</style>
          </div>
        )}
      </div>

      {/* Search Characters */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="card-title">Search Characters</h3>
          <p className="card-description">Filter by name, display name, bio, scenario, personality, first message, or example dialogue</p>
        </div>
        <div className="form-group mb-0">
          <input
            className="form-input"
            type="text"
            placeholder="Type to search characters..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Character Groups and Drag-Drop Context */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {(() => {
          const query = searchQuery.trim().toLowerCase();
          const isSearching = query.length > 0;
          const matches = (c: Character) => {
            const fields = [
              c.name,
              c.profileName || '',
              c.bio || '',
              c.scenario || '',
              c.personality || '',
              c.firstMessage || '',
              c.exampleDialogue || ''
            ];
            return fields.some(v => v.toLowerCase().includes(query));
          };

          if (isSearching) {
            const filtered = chars.filter(matches);
            return (
              <div className="card mb-6">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-semibold text-primary mb-0">Search Results</h3>
                    <span className="text-sm text-muted">({filtered.length} {filtered.length === 1 ? 'character' : 'characters'})</span>
                  </div>
                  <span className="text-xs text-muted">Groups are hidden while searching</span>
                </div>
                {filtered.length === 0 ? (
                  <div className="text-center py-8 text-muted">No characters match your search.</div>
                ) : (
                  <SortableContext items={filtered.map(c => `character-${c.id}`)} strategy={verticalListSortingStrategy}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {filtered.map((character) => (
                        <SortableCharacterCard
                          key={character.id}
                          character={character}
                          expandedId={expandedId}
                          setExpandedId={setExpandedId}
                          editingId={editingId}
                          setEditingId={setEditingId}
                          editName={editName}
                          setEditName={setEditName}
                          editProfileName={editProfileName}
                          setEditProfileName={setEditProfileName}
                          editBio={editBio}
                          setEditBio={setEditBio}
                          editScenario={editScenario}
                          setEditScenario={setEditScenario}
                          editPersonality={editPersonality}
                          setEditPersonality={setEditPersonality}
                          editFirstMessage={editFirstMessage}
                          setEditFirstMessage={setEditFirstMessage}
                          editExampleDialogue={editExampleDialogue}
                          setEditExampleDialogue={setEditExampleDialogue}
                          openMenuId={openMenuId}
                          setOpenMenuId={setOpenMenuId}
                          confirmDeleteId={confirmDeleteId}
                          setConfirmDeleteId={setConfirmDeleteId}
                          onClone={cloneCharacter}
                          onDelete={async (id: number) => {
                            await fetch(`/api/characters/${id}`, { method: 'DELETE' });
                            setConfirmDeleteId(null);
                            mutate();
                            closeMenu();
                          }}
                          mutate={mutate}
                          closeMenu={closeMenu}
                          disableDrag={true}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </div>
            );
          }

          return null;
        })()}

        {/* Character Groups */}
  {searchQuery.trim().length === 0 && groupsIsArray && groups.map(group => {
          const { grouped } = organizeCharacters();
          const groupCharacters = grouped[group.id] || [];
          
          return (
            <DroppableArea
              key={group.id}
              id={`group-${group.id}`}
              className="mb-6"
            >
              <div 
                key={group.id} 
                className={`card cursor-pointer select-none transition-colors duration-150 hover:bg-gray-100 hover:bg-opacity-10 ${
                  isDragging ? 'border-2 border-dashed border-transparent hover:border-blue-400 hover:bg-blue-50 hover:bg-opacity-20' : ''
                }`} 
                style={{ borderLeft: `4px solid ${group.color}` }}
                onClick={() => toggleGroupCollapse(group.id)}
                title={group.isCollapsed ? 'Click to expand group or drop characters here' : 'Click to collapse group'}
              >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div 
                      style={{ 
                        width: '12px', 
                        height: '12px', 
                        backgroundColor: group.color, 
                        borderRadius: '2px' 
                      }}
                    ></div>
                    <h3 className="text-xl font-semibold text-primary mb-0">{group.name}</h3>
                    <span className="text-sm text-muted">({groupCharacters.length} characters)</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {editingGroupId === group.id ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input 
                        type="text"
                        className="form-input"
                        value={editGroupName}
                        onChange={e => setEditGroupName(e.target.value)}
                        style={{ width: '150px' }}
                        placeholder="Group name"
                      />
                      <input 
                        type="color"
                        className="form-input"
                        value={editGroupColor}
                        onChange={e => setEditGroupColor(e.target.value)}
                        style={{ width: '40px', height: '32px', padding: '2px' }}
                      />
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => {
                          updateGroup(group.id, { name: editGroupName, color: editGroupColor });
                          setEditingGroupId(null);
                          setEditGroupName('');
                          setEditGroupColor('');
                        }}
                      >
                        ✓
                      </button>
                      <button
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          setEditingGroupId(null);
                          setEditGroupName('');
                          setEditGroupColor('');
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div 
                      className="menu-container relative"
                      style={{
                        height: openMenuId === `group-${group.id}` ? '2rem' : 'auto',
                        minHeight: openMenuId === `group-${group.id}` ? '2rem' : 'auto',
                        zIndex: openMenuId === `group-${group.id}` ? 999999 : 'auto'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {openMenuId !== `group-${group.id}` && (
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(`group-${group.id}`);
                          }}
                          title="More actions"
                        >
                          ⋯
                        </button>
                      )}
                      
                      {openMenuId === `group-${group.id}` && (
                        <div 
                          className="absolute right-0 min-w-48 overflow-hidden"
                          style={{
                            top: openMenuId === `group-${group.id}` ? '0' : 'calc(100% + 4px)',
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
                              onClick={() => {
                                setEditingGroupId(group.id);
                                setEditGroupName(group.name);
                                setEditGroupColor(group.color);
                                setOpenMenuId(null);
                              }}
                            >
                              <span className="text-base">✏️</span>
                              <span className="font-medium">Edit Group</span>
                            </button>
                            
                            <div style={{ 
                              height: '1px', 
                              backgroundColor: 'var(--border-secondary)', 
                              margin: '8px 20px' 
                            }}></div>
                            
                            {confirmDeleteGroupId === group.id ? (
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
                                  onClick={() => deleteGroup(group.id)}
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
                                  onClick={() => {
                                    setConfirmDeleteGroupId(null);
                                    setOpenMenuId(null);
                                  }}
                                >
                                  <span className="text-base">✕</span>
                                  <span className="font-medium">Cancel</span>
                                </button>
                              </>
                            ) : (
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
                                onClick={() => {
                                  setConfirmDeleteGroupId(group.id);
                                }}
                              >
                                <span className="text-base">🗑️</span>
                                <span>Delete Group</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              
              {!group.isCollapsed && (
                <div onClick={(e) => e.stopPropagation()}>
                  <DroppableArea
                    id={`group-${group.id}-content`}
                    className="min-h-24 rounded-lg p-4 border-2 border-dashed"
                    style={{
                      backgroundColor: 'var(--bg-tertiary)',
                      borderColor: 'var(--border-secondary)'
                    }}
                  >
                  {groupCharacters.length === 0 ? (
                    <div className="text-center py-8 text-muted">
                      <p>No characters in this group yet.</p>
                      <p className="text-sm">Drag characters here to add them to this group.</p>
                    </div>
                  ) : (
                    <SortableContext items={groupCharacters.map(c => `character-${c.id}`)} strategy={verticalListSortingStrategy}>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {groupCharacters.map((character) => (
                          <SortableCharacterCard
                            key={character.id}
                            character={character}
                            expandedId={expandedId}
                            setExpandedId={setExpandedId}
                            editingId={editingId}
                            setEditingId={setEditingId}
                            editName={editName}
                            setEditName={setEditName}
                            editProfileName={editProfileName}
                            setEditProfileName={setEditProfileName}
                            editBio={editBio}
                            setEditBio={setEditBio}
                            editScenario={editScenario}
                            setEditScenario={setEditScenario}
                            editPersonality={editPersonality}
                            setEditPersonality={setEditPersonality}
                            editFirstMessage={editFirstMessage}
                            setEditFirstMessage={setEditFirstMessage}
                            editExampleDialogue={editExampleDialogue}
                            setEditExampleDialogue={setEditExampleDialogue}
                            openMenuId={openMenuId}
                            setOpenMenuId={setOpenMenuId}
                            confirmDeleteId={confirmDeleteId}
                            setConfirmDeleteId={setConfirmDeleteId}
                            onClone={cloneCharacter}
                            onDelete={async (id: number) => {
                              await fetch(`/api/characters/${id}`, { method: 'DELETE' });
                              setConfirmDeleteId(null);
                              mutate();
                              closeMenu();
                            }}
                            mutate={mutate}
                            closeMenu={closeMenu}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  )}
                </DroppableArea>
              </div>
              )}
              </div>
            </DroppableArea>
          );
        })}

  {/* Ungrouped Characters */}
  {searchQuery.trim().length === 0 && (() => {
          const { ungrouped } = organizeCharacters();
          
          return (
            <div className="card mb-6">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-semibold text-primary mb-0">Ungrouped Characters</h3>
                    <span className="text-sm text-muted">({ungrouped.length} characters)</span>
                  </div>
                </div>
                
                {/* New group button - responsive */}
                {!isCreatingGroup && (
                  <div className="mb-3">
                    <button 
                      className="btn btn-primary btn-small new-group-btn" 
                      onClick={() => setIsCreatingGroup(true)}
                      title="Create new character group"
                    >
                      + New Group
                    </button>
                    <style jsx>{`
                      .new-group-btn {
                        width: 100%;
                      }
                      @media (min-width: 640px) {
                        .new-group-btn {
                          width: auto;
                        }
                      }
                    `}</style>
                  </div>
                )}
                
                {/* Group creation form - responsive layout */}
                {isCreatingGroup && (
                  <div className="border rounded-lg p-4 mb-4" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                      <div className="flex-1 w-full sm:w-auto">
                        <input 
                          type="text"
                          className="form-input"
                          value={newGroupName} 
                          onChange={e => setNewGroupName(e.target.value)}
                          placeholder="Group name"
                          style={{ width: '100%', minWidth: '200px' }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              createGroup(e as any);
                            }
                          }}
                        />
                      </div>
                      <div>
                        <input 
                          type="color"
                          className="form-input"
                          value={newGroupColor}
                          onChange={e => setNewGroupColor(e.target.value)}
                          style={{ width: '50px', height: '40px', padding: '4px' }}
                        />
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          className="btn btn-primary"
                          style={{ padding: '8px 16px', fontSize: '14px' }}
                          onClick={(e) => createGroup(e as any)}
                        >
                          Create
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '8px 16px', fontSize: '14px' }}
                          onClick={() => {
                            setIsCreatingGroup(false);
                            setNewGroupName('');
                            setNewGroupColor('#6366f1');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              <DroppableArea
                id="ungrouped"
                className="min-h-24 rounded-lg p-4 border-2 border-dashed"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  borderColor: 'var(--border-secondary)'
                }}
              >
                <div onClick={(e) => e.stopPropagation()}>
                {ungrouped.length === 0 ? (
                  <div className="text-center py-8 text-muted">
                    <p>No ungrouped characters.</p>
                    <p className="text-sm">Create character groups above, then drag characters here to ungroup them.</p>
                  </div>
                ) : (
                  <SortableContext items={ungrouped.map(c => `character-${c.id}`)} strategy={verticalListSortingStrategy}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {ungrouped.map((character) => (
                        <SortableCharacterCard
                          key={character.id}
                          character={character}
                          expandedId={expandedId}
                          setExpandedId={setExpandedId}
                          editingId={editingId}
                          setEditingId={setEditingId}
                          editName={editName}
                          setEditName={setEditName}
                          editProfileName={editProfileName}
                          setEditProfileName={setEditProfileName}
                          editBio={editBio}
                          setEditBio={setEditBio}
                          editScenario={editScenario}
                          setEditScenario={setEditScenario}
                          editPersonality={editPersonality}
                          setEditPersonality={setEditPersonality}
                          editFirstMessage={editFirstMessage}
                          setEditFirstMessage={setEditFirstMessage}
                          editExampleDialogue={editExampleDialogue}
                          setEditExampleDialogue={setEditExampleDialogue}
                          openMenuId={openMenuId}
                          setOpenMenuId={setOpenMenuId}
                          confirmDeleteId={confirmDeleteId}
                          setConfirmDeleteId={setConfirmDeleteId}
                          onClone={cloneCharacter}
                          onDelete={async (id: number) => {
                            await fetch(`/api/characters/${id}`, { method: 'DELETE' });
                            setConfirmDeleteId(null);
                            mutate();
                            closeMenu();
                          }}
                          mutate={mutate}
                          closeMenu={closeMenu}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
                </div>
              </DroppableArea>
            </div>
          );
        })()}

        {searchQuery.trim().length === 0 && (
          <DragOverlay dropAnimation={{
            duration: 0,
            easing: 'ease'
          }}>
            {activeId ? (
              <div className="card opacity-80 transform rotate-2">
                <div className="text-lg font-semibold text-primary">
                  {chars?.find(c => `character-${c.id}` === activeId)?.name || 'Character'}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        )}
      </DndContext>

      {chars.length === 0 && (
        <div className="text-center py-12">
          <p className="text-secondary mb-4">No characters created yet.</p>
          <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
            Create Your First Character
          </button>
        </div>
      )}
    </div>
  );
}
