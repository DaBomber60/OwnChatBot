import { useRef, useState } from 'react';
import { normalizeKeywords, splitKeywordInput, MAX_KEYWORD_LENGTH, type LoreKeyword } from '../../lib/lorebook/keywords';

interface KeywordInputProps {
  value: LoreKeyword[];
  onChange: (keywords: LoreKeyword[]) => void;
  disabled?: boolean;
  id?: string;
}

/** New keywords match whole words only; each chip's checkbox switches it to part-word matching. */
export const NEW_KEYWORD_WHOLE_WORD = true;

/** Keyword chips: Enter or comma adds, Backspace on an empty field removes the last one. */
export function KeywordInput({ value, onChange, disabled = false, id }: KeywordInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (text: string) => {
    const added = splitKeywordInput(text, NEW_KEYWORD_WHOLE_WORD);
    if (added.length > 0) onChange(normalizeKeywords([...value, ...added]));
    setDraft('');
  };

  const setWholeWord = (keyword: LoreKeyword, wholeWord: boolean) =>
    onChange(value.map(k => (k === keyword ? { ...k, wholeWord } : k)));

  return (
    <div className="keyword-input" onClick={() => inputRef.current?.focus()}>
      {value.map(keyword => (
        <span
          key={keyword.text.toLowerCase()}
          className={`lore-chip${keyword.wholeWord ? '' : ' lore-chip--partial'}`}
          title={keyword.wholeWord ? 'Whole word only' : 'Also matches inside longer words'}
        >
          <input
            type="checkbox"
            className="lore-chip-check"
            checked={keyword.wholeWord}
            disabled={disabled}
            aria-label={`Match “${keyword.text}” as a whole word only`}
            onClick={e => e.stopPropagation()}
            onChange={e => setWholeWord(keyword, e.target.checked)}
          />
          {keyword.text}
          {!disabled && (
            <button
              type="button"
              className="lore-chip-remove"
              aria-label={`Remove keyword ${keyword.text}`}
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
        className="keyword-input-field"
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
