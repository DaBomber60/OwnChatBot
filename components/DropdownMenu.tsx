import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// DropdownMenuItem — a single button row inside a dropdown menu
// ---------------------------------------------------------------------------

interface DropdownMenuItemProps {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  /** Call e.stopPropagation() on click (needed when dropdown is inside a clickable parent) */
  stopPropagation?: boolean;
}

export function DropdownMenuItem({
  icon,
  label,
  onClick,
  variant = 'default',
  disabled = false,
  stopPropagation = false,
}: DropdownMenuItemProps) {
  const isDanger = variant === 'danger';
  return (
    <button
      className={`dropdown-menu-item w-full text-left text-sm transition-colors duration-150 flex items-center gap-3${isDanger ? ' dropdown-menu-item--danger font-medium' : ''}${disabled ? ' dropdown-menu-item--disabled' : ''}`}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
    >
      <span className="text-base">{icon}</span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DropdownMenuDivider
// ---------------------------------------------------------------------------

export function DropdownMenuDivider() {
  return <div className="dropdown-menu-divider" />;
}

// ---------------------------------------------------------------------------
// ConfirmDeleteItem — two-step delete flow inside a dropdown
// ---------------------------------------------------------------------------

interface ConfirmDeleteItemProps {
  /** Label shown on the initial delete button, e.g. "Delete Persona" */
  label: string;
  isConfirming: boolean;
  onRequestDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  stopPropagation?: boolean;
}

export function ConfirmDeleteItem({
  label,
  isConfirming,
  onRequestDelete,
  onConfirm,
  onCancel,
  stopPropagation = false,
}: ConfirmDeleteItemProps) {
  if (isConfirming) {
    return (
      <>
        <DropdownMenuItem
          icon="✓"
          label="Confirm Delete"
          onClick={onConfirm}
          variant="danger"
          stopPropagation={stopPropagation}
        />
        <DropdownMenuItem
          icon="✕"
          label="Cancel"
          onClick={onCancel}
          stopPropagation={stopPropagation}
        />
      </>
    );
  }
  return (
    <DropdownMenuItem
      icon="🗑️"
      label={label}
      onClick={onRequestDelete}
      variant="danger"
      stopPropagation={stopPropagation}
    />
  );
}

// ---------------------------------------------------------------------------
// DropdownMenu — trigger button + absolutely-positioned dropdown panel
// ---------------------------------------------------------------------------

interface DropdownMenuProps {
  entityId: number | string;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Character shown on the trigger button (default: "⋯") */
  triggerChar?: string;
  /** Call stopPropagation on the container (for dropdowns inside clickable parents) */
  stopPropagation?: boolean;
  /** Extra styles for the trigger button */
  triggerStyle?: React.CSSProperties;
  children: React.ReactNode;
}

export function DropdownMenu({
  entityId,
  isOpen,
  onToggle,
  onClose,
  triggerChar = '⋯',
  stopPropagation = false,
  triggerStyle,
  children,
}: DropdownMenuProps) {
  return (
    <div
      className={`menu-container relative${isOpen ? ' dropdown-menu-trigger-wrap--open' : ''}`}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {!isOpen && (
        <button
          className="btn btn-secondary btn-small"
          onClick={(e) => {
            if (stopPropagation) e.stopPropagation();
            onToggle();
          }}
          title="More actions"
          style={triggerStyle}
        >
          {triggerChar}
        </button>
      )}

      {isOpen && (
        <div
          className="dropdown-menu-panel absolute right-0 min-w-48 overflow-hidden"
        >
          <div>{children}</div>
        </div>
      )}
    </div>
  );
}
