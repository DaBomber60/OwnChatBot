import { useRef, useState } from 'react';
import { normalizeKeywords, splitKeywordInput, MAX_KEYWORD_LENGTH } from '../../lib/lorebook/keywords';

interface KeywordInputProps {
  value: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
  id?: string;
}

/** Keyword chips: Enter or comma adds, Backspace on an empty field removes the last one. */
export function KeywordInput({ value, onChange, disabled = false, id }: KeywordInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (text: string) => {
    const added = splitKeywordInput(text);
    if (added.length > 0) onChange(normalizeKeywords([...value, ...added]));
    setDraft('');
  };

  return (
    <div className="keyword-input" onClick={() => inputRef.current?.focus()}>
      {value.map(keyword => (
        <span key={keyword.toLowerCase()} className="lore-chip">
          {keyword}
          {!disabled && (
            <button
              type="button"
              className="lore-chip-remove"
              aria-label={`Remove keyword ${keyword}`}
              onClick={e => { e.stopPropagation(); onChange(value.filter(k => k !== keyword)); }}
            >
              ×
            </button>
          )}
        </span>
      ))}
      <input
        id={id}
        ref={inputRef}
        value={draft}
        disabled={disabled}
        maxLength={MAX_KEYWORD_LENGTH}
        placeholder={value.length === 0 ? 'Type a keyword and press Enter...' : 'Add another...'}
        aria-label="Add keyword"
        onChange={e => {
          const text = e.target.value;
          if (/[,\n]/.test(text)) commit(text);
          else setDraft(text);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onPaste={e => {
          const text = e.clipboardData.getData('text');
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            commit(draft + text);
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}
