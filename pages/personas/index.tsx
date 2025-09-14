import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import Head from 'next/head';

const fetcher = (url: string) => fetch(url).then(res => res.json());

type Persona = { id: number; name: string; profileName?: string; profile: string }; // removed userPrompt

// Utility to render multiline text into paragraphs
function renderMultiline(text: string) {
  return text.split(/\r?\n/).map((line, idx) => (
    <p key={idx} style={{ margin: '0.05rem 0' }}>{line}</p>
  ));
}

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
  const router = useRouter();

  // Add click outside and escape key functionality
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
    setProfile(persona.profile);
    
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

  if (error) return <div className="container text-center text-error">Error loading personas.</div>;
  if (!personas) return <div className="container text-center">Loading...</div>;

  return (
    <div className="container">
      <Head>
        <title>Personas - Manage AI Conversation Styles</title>
        <meta name="description" content="Create and manage AI personas to define different conversation styles and personalities for your chats." />
      </Head>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold mb-0">Personas</h1>
        <button className="btn btn-secondary" onClick={() => router.push('/')}>
          🏠 Home
        </button>
      </div>

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

      <div className="grid gap-4">
        {personas.map(p => (
          <div 
            key={p.id} 
            className={`card ${editingId !== p.id ? 'cursor-pointer' : ''}`}
            onClick={editingId !== p.id ? () => setExpandedId(expandedId === p.id ? null : p.id) : undefined}
          >
            <div className="flex items-start justify-between">
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
                <div 
                  className="menu-container relative"
                  style={{
                    height: openMenuId === p.id ? '2rem' : 'auto',
                    minHeight: openMenuId === p.id ? '2rem' : 'auto',
                    zIndex: openMenuId === p.id ? 999999 : 'auto'
                  }}
                >
                  {openMenuId !== p.id && (
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => toggleMenu(p.id)}
                      title="More actions"
                    >
                      ⋯
                    </button>
                  )}
                  
                  {openMenuId === p.id && (
                    <div 
                      className="absolute right-0 min-w-48 overflow-hidden"
                      style={{
                        top: openMenuId === p.id ? '0' : 'calc(100% + 4px)',
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
                            setEditingId(p.id);
                            setEditName(p.name);
                            setEditProfileName(p.profileName || '');
                            setEditProfile(p.profile);
                            closeMenu();
                          }}
                        >
                          <span className="text-base">✏️</span>
                          <span className="font-medium">Edit Persona</span>
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
                          onClick={() => clonePersona(p)}
                        >
                          <span className="text-base">📋</span>
                          <span className="font-medium">Clone Persona</span>
                        </button>
                        
                        <div style={{ 
                          height: '1px', 
                          backgroundColor: 'var(--border-secondary)', 
                          margin: '8px 20px' 
                        }}></div>
                        
                        {confirmDeleteId === p.id ? (
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
                              onClick={async () => {
                                await fetch(`/api/personas/${p.id}`, { method: 'DELETE' });
                                setConfirmDeleteId(null);
                                mutate();
                                closeMenu();
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
                              setConfirmDeleteId(p.id);
                            }}
                          >
                            <span className="text-base">🗑️</span>
                            <span>Delete Persona</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
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
                        {renderMultiline(p.profile)}
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
    </div>
  );
}
