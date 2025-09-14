import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());
type UserPrompt = { id: number; title: string; body: string };

// Utility to render multiline text into paragraphs
function renderMultiline(text: string) {
  return text.split(/\r?\n/).map((line, idx) => (
    <p key={idx} style={{ margin: '0.25rem 0' }}>{line}</p>
  ));
}

export default function UserPromptsManager() {
  const { data: promptsData, error, mutate } = useSWR<UserPrompt[]>('/api/user-prompts', fetcher);
  const prompts = Array.isArray(promptsData) ? promptsData : [];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null); // collapsed by default

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !body) return;
    await fetch('/api/user-prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body })
    });
    setTitle(''); setBody('');
    setIsAdding(false);
    mutate();
  };

  if (error) return <div className="text-error">Error loading prompts.</div>;
  if (promptsData === undefined) return <div className="text-center">Loading prompts...</div>;

  return (
    <div>
      <div className="mb-6">
        {isAdding ? (
          <form onSubmit={handleSubmit} className="bg-tertiary p-4 rounded-lg border border-secondary">
            <div className="form-group">
              <label className="form-label">Title</label>
              <input 
                className="form-input"
                value={title} 
                onChange={e => setTitle(e.target.value)}
                placeholder="Enter prompt title"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Body</label>
              <textarea 
                className="form-textarea"
                value={body} 
                onChange={e => setBody(e.target.value)}
                placeholder="Enter the prompt template..."
                rows={4}
                required
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" className="btn btn-primary">Add Prompt</button>
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => { 
                  setIsAdding(false); 
                  setTitle(''); 
                  setBody(''); 
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
            + New Prompt
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {prompts.map(p => {
          const isExpanded = expandedId === p.id;
          const isEditing = editingId === p.id;
          const preview = p.body.length > 140 ? p.body.slice(0, 140) + '…' : p.body;
          return (
            <div 
              key={p.id} 
              className={`card ${!isEditing ? 'cursor-pointer' : ''}`}
              onClick={!isEditing ? () => setExpandedId(isExpanded ? null : p.id) : undefined}
            >
              <div className="card-header flex items-start justify-between">
                <h4 className="card-title flex-1 pr-2">{p.title}</h4>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : p.id); }}
                  title={isExpanded ? 'Collapse' : 'Expand'}
                >
                  {isExpanded ? '▾' : '▸'}
                </button>
              </div>

              {isEditing ? (
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  await fetch(`/api/user-prompts/${p.id}`, { 
                    method: 'PUT', 
                    headers: {'Content-Type':'application/json'}, 
                    body: JSON.stringify({ title: editTitle, body: editBody }) 
                  });
                  setEditingId(null);
                  mutate();
                }} onClick={(e)=> e.stopPropagation()}>
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input 
                      className="form-input"
                      value={editTitle} 
                      onChange={e => setEditTitle(e.target.value)}
                      placeholder="Title"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Body</label>
                    <textarea 
                      className="form-textarea"
                      value={editBody} 
                      onChange={e => setEditBody(e.target.value)}
                      placeholder="Body"
                      rows={4}
                      required
                    />
                  </div>
                  <div className="flex gap-3">
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
              ) : (
                <div>
                  {!isExpanded && (
                    <div className="text-secondary mb-2" style={{ lineHeight: '1.5', fontSize: '0.85rem' }}>
                      {preview}
                    </div>
                  )}
                  {isExpanded && (
                    <div className="text-secondary mb-4" style={{ lineHeight: '1.6' }}>
                      {renderMultiline(p.body)}
                    </div>
                  )}
                  <div className="flex gap-3" onClick={(e)=> e.stopPropagation()}>
                    <button 
                      className="btn btn-secondary btn-small" 
                      onClick={() => { 
                        setEditingId(p.id); 
                        setEditTitle(p.title); 
                        setEditBody(p.body); 
                        setExpandedId(p.id);
                      }}
                    >
                      Edit
                    </button>
                    {confirmDeleteId === p.id ? (
                      <>
                        <button
                          className="btn btn-secondary btn-small text-error"
                          onClick={async () => {
                            await fetch(`/api/user-prompts/${p.id}`, { method: 'DELETE' });
                            setConfirmDeleteId(null);
                            mutate();
                          }}
                        >
                          ✓ Delete
                        </button>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button 
                        className="btn btn-secondary btn-small text-error" 
                        onClick={() => setConfirmDeleteId(p.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {prompts.length === 0 && (
        <div className="text-center py-12">
          <p className="text-secondary mb-4">No prompts created yet.</p>
          <button className="btn btn-primary" onClick={() => setIsAdding(true)}>
            Create Your First Prompt
          </button>
        </div>
      )}
    </div>
  );
}
