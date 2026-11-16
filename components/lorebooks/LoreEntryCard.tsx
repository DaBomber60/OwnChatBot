import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider, ConfirmDeleteItem } from '../DropdownMenu';
import { LORE_PRIORITY_LABELS } from '../../lib/lorebook/constants';
import type { LoreEntry } from '../../types/models';

interface LoreEntryCardProps {
  entry: LoreEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

export function LoreEntryCard({
  entry, expanded, onToggleExpand, menuOpen, onToggleMenu, onCloseMenu,
  confirmingDelete, onRequestDelete, onEdit, onToggleEnabled, onDelete,
}: LoreEntryCardProps) {
  return (
    <div
      className={`card card-compact cursor-pointer lore-entry-card${entry.enabled ? '' : ' is-disabled'}`}
      onClick={onToggleExpand}
    >
      <div className="lore-entry-header">
        <div className="lore-entry-body">
          <div className="lore-entry-title-row">
            <h3 className="lore-entry-title">{entry.title}</h3>
            {entry.constant
              ? <span className="lore-badge lore-badge--constant">📌 Always</span>
              : <span className="lore-badge lore-badge--triggered">🔑 Keywords</span>}
            {!entry.enabled && <span className="lore-badge lore-badge--disabled">⏸ Disabled</span>}
            {!entry.constant && (
              <span
                className={`lore-badge${entry.priority === 'critical' ? ' lore-badge--critical' : ''}`}
                title={entry.priority === 'critical' ? 'Always added when triggered, even past the lore budget' : 'Priority'}
              >
                {LORE_PRIORITY_LABELS[entry.priority]}
              </span>
            )}
          </div>

          {!entry.constant && (
            entry.keys.length > 0 ? (
              <div className="lore-chip-list">
                {entry.keys.map(key => (
                  <span
                    key={key.text.toLowerCase()}
                    className={`lore-chip${key.wholeWord ? '' : ' lore-chip--partial'}`}
                    title={key.wholeWord ? 'Whole word only' : 'Also matches inside longer words'}
                  >
                    {key.text}
                  </span>
                ))}
              </div>
            ) : (
              <span className="lore-field-warning">No keywords, so this entry is never added.</span>
            )
          )}

          <p className={`lore-entry-preview${expanded ? ' is-expanded' : ''}`}>{entry.content}</p>
        </div>

        <div onClick={e => e.stopPropagation()}>
          <DropdownMenu entityId={`entry-${entry.id}`} isOpen={menuOpen} onToggle={onToggleMenu} onClose={onCloseMenu}>
            <DropdownMenuItem icon="✏️" label="Edit Entry" onClick={() => { onCloseMenu(); onEdit(); }} />
            <DropdownMenuItem
              icon={entry.enabled ? '⏸' : '▶️'}
              label={entry.enabled ? 'Disable Entry' : 'Enable Entry'}
              onClick={() => { onCloseMenu(); onToggleEnabled(); }}
            />
            <DropdownMenuDivider />
            <ConfirmDeleteItem
              label="Delete Entry"
              isConfirming={confirmingDelete}
              onRequestDelete={onRequestDelete}
              onConfirm={onDelete}
              onCancel={onCloseMenu}
            />
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
