import React, { useEffect, useCallback } from 'react';

interface ModalProps {
  /** Controls visibility. When false, renders nothing. */
  open: boolean;
  /** Called when the user requests dismissal (overlay click, Escape key). */
  onClose: () => void;
  /** Modal title rendered inside .modal-header > h2.modal-title */
  title: string;
  /** Optional inline maxWidth override for .modal-content (e.g. '500px'). Default: CSS 750px. */
  maxWidth?: string;
  /** Extra className(s) appended to .modal-overlay. */
  overlayClassName?: string;
  /** Extra className(s) appended to .modal-content. */
  contentClassName?: string;
  /** Whether clicking the overlay backdrop closes the modal. Default: true. */
  closeOnOverlayClick?: boolean;
  /** Whether pressing Escape closes the modal. Default: true. */
  closeOnEscape?: boolean;
  /** Content rendered inside .modal-body */
  children: React.ReactNode;
  /** Content rendered inside .modal-footer. If omitted, no footer is rendered. */
  footer?: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  maxWidth,
  overlayClassName,
  contentClassName,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  children,
  footer,
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeOnEscape, handleKeyDown]);

  if (!open) return null;

  const overlayClasses = ['modal-overlay', overlayClassName].filter(Boolean).join(' ');
  const contentClasses = ['modal-content', contentClassName].filter(Boolean).join(' ');

  return (
    <div
      className={overlayClasses}
      onClick={closeOnOverlayClick ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div className={contentClasses} style={maxWidth ? { maxWidth } : undefined}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
