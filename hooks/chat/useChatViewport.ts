import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { HEADER_GAP_PX, HEADER_GAP_COMPACT_PX, INITIAL_HEADER_HEIGHT } from '../../lib/chat/layout';

/** Mirrors the @media (min-width: 1500px) / (max-width: 800px) breakpoints in globals.css. */
const WIDE_SCREEN_MIN_WIDTH = 1500;
const NARROW_SCREEN_MAX_WIDTH = 800;

export interface UseChatViewportOpts {
  headerRef: React.RefObject<HTMLElement | null>;
  /** The header re-measures whenever any of these change. */
  isBurgerMenuOpen: boolean;
  hasSession: boolean;
  isEditing: boolean;
}

export interface UseChatViewportReturn {
  /** Header height plus HEADER_GAP_PX; drives the chat container's `top`. */
  headerHeight: number;
  isWideScreen: boolean;
  isNarrowScreen: boolean;
}

/**
 * Measures the chat header and tracks the responsive breakpoints the chat page
 * needs in JS, behind a single rAF-throttled resize listener.
 */
export function useChatViewport({
  headerRef,
  isBurgerMenuOpen,
  hasSession,
  isEditing,
}: UseChatViewportOpts): UseChatViewportReturn {
  const [headerHeight, setHeaderHeight] = useState(INITIAL_HEADER_HEIGHT);
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);

  const measureHeader = useCallback(() => {
    const el = headerRef.current;
    if (!el) return;
    void el.offsetHeight; // force reflow so the read below reflects pending layout
    const height = el.offsetHeight;
    const gap = window.innerWidth < NARROW_SCREEN_MAX_WIDTH ? HEADER_GAP_COMPACT_PX : HEADER_GAP_PX;
    // A hidden header (editing on narrow screens) should reclaim its gap too
    const adjusted = height === 0 ? 0 : height + gap;
    setHeaderHeight(prev => (prev === adjusted ? prev : adjusted));
    // Consumed by .notes-modal-sidecar in globals.css
    document.documentElement.style.setProperty('--dynamic-header-height', `${adjusted}px`);
  }, [headerRef]);

  useLayoutEffect(() => {
    measureHeader();
    const rafId = requestAnimationFrame(measureHeader);
    // The header keeps settling for a few frames as session data and fonts land.
    const delays = hasSession && !isEditing ? [0, 50, 100, 200] : [50];
    const timeouts = delays.map(ms => setTimeout(measureHeader, ms));
    return () => {
      cancelAnimationFrame(rafId);
      timeouts.forEach(clearTimeout);
    };
  }, [measureHeader, isBurgerMenuOpen, hasSession, isEditing]);

  useEffect(() => () => {
    document.documentElement.style.removeProperty('--dynamic-header-height');
  }, []);

  useEffect(() => {
    const checkScreenWidth = () => {
      setIsWideScreen(window.innerWidth >= WIDE_SCREEN_MIN_WIDTH);
      setIsNarrowScreen(window.innerWidth < NARROW_SCREEN_MAX_WIDTH);
    };
    checkScreenWidth();

    let rafId: number | null = null;
    const onResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkScreenWidth();
        measureHeader();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [measureHeader]);

  return { headerHeight, isWideScreen, isNarrowScreen };
}
