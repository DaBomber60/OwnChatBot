import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Avatar } from './Avatar';
import { characterAvatarUrl, groupAvatarUrl } from '../lib/avatar';
import { useClickOutside } from '../hooks/useClickOutside';
import type { Character, CharacterGroup } from '../types/models';

interface Section {
  key: string;
  label: string | null;
  group?: CharacterGroup;
  characters: Character[];
}

const optionLabel = (c: Character) => c.profileName || c.name;
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Groups alphabetically, then ungrouped characters; characters sorted by their label within each. */
function buildCharacterSections(characters: Character[], groups: CharacterGroup[], query: string): Section[] {
  const q = query.trim().toLowerCase();
  const groupById = new Map(groups.map(g => [g.id, g]));
  const byGroup = new Map<number | null, Character[]>();

  for (const character of characters) {
    const group = character.groupId != null ? groupById.get(character.groupId) : undefined;
    if (q && ![character.name, character.profileName, group?.name].some(v => v?.toLowerCase().includes(q))) continue;
    const key = group ? group.id : null;
    const list = byGroup.get(key);
    if (list) list.push(character);
    else byGroup.set(key, [character]);
  }

  const sortCharacters = (list: Character[]) => list.sort((a, b) => collator.compare(optionLabel(a), optionLabel(b)));
  const sections: Section[] = [...groups]
    .sort((a, b) => collator.compare(a.name, b.name))
    .filter(group => byGroup.has(group.id))
    .map(group => ({ key: `group-${group.id}`, label: group.name, group, characters: sortCharacters(byGroup.get(group.id)!) }));

  const ungrouped = byGroup.get(null);
  if (ungrouped) sections.push({ key: 'ungrouped', label: sections.length ? 'Ungrouped' : null, characters: sortCharacters(ungrouped) });
  return sections;
}

function GroupMarker({ group }: { group: CharacterGroup }) {
  const src = groupAvatarUrl(group);
  if (src) return <Avatar name={group.name} src={src} size="1.25rem" />;
  return <span className="character-picker-swatch" style={{ backgroundColor: group.color }} aria-hidden="true" />;
}

interface CharacterPickerProps {
  characters: Character[];
  groups: CharacterGroup[];
  /** Selected character ID, or 0 for none. */
  value: number;
  onChange: (characterId: number) => void;
  id?: string;
}

/** Searchable character select showing each character's picture, grouped like the characters page. */
export function CharacterPicker({ characters, groups, value, onChange, id }: CharacterPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const optionId = (characterId: number) => `${listboxId}-option-${characterId}`;

  const selected = characters.find(c => c.id === value) ?? null;
  const sections = useMemo(() => buildCharacterSections(characters, groups, query), [characters, groups, query]);
  const options = useMemo(() => sections.flatMap(s => s.characters), [sections]);

  const close = (focusTrigger = false) => {
    setOpen(false);
    setQuery('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  useClickOutside(open, () => close(), { containerRef, eventType: 'mousedown', escapeToClose: false });

  const openPicker = () => {
    setActiveId(value || null);
    setOpen(true);
  };

  // Keep the highlighted option on screen, and on the list when filtering removes it.
  useEffect(() => {
    if (!open) return;
    if (activeId == null || !options.some(o => o.id === activeId)) {
      setActiveId(options[0]?.id ?? null);
      return;
    }
    document.getElementById(`${listboxId}-option-${activeId}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeId, options, listboxId]);

  const choose = (characterId: number) => {
    onChange(characterId);
    close(true);
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const index = options.findIndex(o => o.id === activeId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length === 0) return;
      const next = e.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
      setActiveId(options[next]!.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeId != null && index >= 0) choose(activeId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      openPicker();
    }
  };

  return (
    <div className="character-picker" ref={containerRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="form-select character-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={onTriggerKeyDown}
      >
        {selected ? (
          <>
            <Avatar name={selected.name} src={characterAvatarUrl(selected)} size="1.75rem" />
            <span className="character-picker-text">
              <span className="character-picker-label">{optionLabel(selected)}</span>
              {selected.profileName && <span className="character-picker-sub">{selected.name}</span>}
            </span>
          </>
        ) : (
          <span className="character-picker-placeholder">Choose a character...</span>
        )}
        <span className="character-picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="character-picker-panel">
          <input
            className="form-input character-picker-search"
            placeholder="Search characters..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeId != null ? optionId(activeId) : undefined}
            aria-label="Search characters"
            autoFocus
          />
          <div className="character-picker-list" role="listbox" id={listboxId} aria-label="Characters">
            {sections.length === 0 && (
              <div className="character-picker-empty">No characters match &ldquo;{query.trim()}&rdquo;</div>
            )}
            {sections.map(section => (
              <div key={section.key} role="group" aria-label={section.label ?? 'Characters'}>
                {section.label && (
                  <div className="character-picker-group" aria-hidden="true">
                    {section.group && <GroupMarker group={section.group} />}
                    <span>{section.label}</span>
                  </div>
                )}
                {section.characters.map(character => (
                  <div
                    key={character.id}
                    id={optionId(character.id)}
                    role="option"
                    aria-selected={character.id === value}
                    className={[
                      'character-picker-option',
                      character.id === activeId ? 'is-active' : '',
                      character.id === value ? 'is-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseDown={e => e.preventDefault()}
                    onMouseMove={() => { if (activeId !== character.id) setActiveId(character.id); }}
                    onClick={() => choose(character.id)}
                  >
                    <Avatar name={character.name} src={characterAvatarUrl(character)} size="2rem" />
                    <span className="character-picker-text">
                      <span className="character-picker-label">{optionLabel(character)}</span>
                      {character.profileName && <span className="character-picker-sub">{character.name}</span>}
                    </span>
                    {character.id === value && <span className="character-picker-check" aria-hidden="true">✓</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
