import { useEffect, useRef } from 'react';

/**
 * Hook to close a menu/modal on Escape key press and clicks outside a container.
 *
 * @param isOpen - Whether the menu/modal is currently open (no listeners attached when false)
 * @param onClose - Callback to invoke when an outside click or Escape press is detected
 * @param opts.containerSelector - CSS selector to detect inside clicks (default: '.menu-container')
 * @param opts.containerRef - Alternative: a React ref to the container element (overrides selector)
 * @param opts.eventType - Mouse event to listen for (default: 'click')
 * @param opts.escapeToClose - Whether Escape key triggers onClose (default: true)
 */
export function useClickOutside(
  isOpen: boolean,
  onClose: () => void,
  opts: {
    containerSelector?: string;
    containerRef?: { current: HTMLElement | null };
    eventType?: 'click' | 'mousedown';
    escapeToClose?: boolean;
  } = {}
): void {
  const {
    containerSelector = '.menu-container',
    containerRef,
    eventType = 'click',
    escapeToClose = true,
  } = opts;

  // Stable ref so the effect doesn't re-run when onClose identity changes
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (containerRef?.current) {
        if (!containerRef.current.contains(target)) onCloseRef.current();
      } else {
        if (!target.closest(containerSelector)) onCloseRef.current();
      }
    };

    if (escapeToClose) {
      document.addEventListener('keydown', handleKeyDown);
    }
    document.addEventListener(eventType, handleClickOutside as EventListener);

    return () => {
      if (escapeToClose) {
        document.removeEventListener('keydown', handleKeyDown);
      }
      document.removeEventListener(eventType, handleClickOutside as EventListener);
    };
  }, [isOpen, containerSelector, containerRef, eventType, escapeToClose]);
}
