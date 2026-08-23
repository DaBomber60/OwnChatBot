import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { SMOOTH_SCROLL_MS } from '../../lib/chat/layout';
import type { ChatMessage } from '../../types/models';

export interface UseChatScrollOpts {
  containerRef: React.RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  isStreaming: boolean;
  generatingVariant: number | null;
  editingMessageIndex: number | null;
}

export interface UseChatScrollReturn {
  /** Stop rAF-based streaming follow loop */
  stopStreamingFollow: () => void;
  /** Conditionally start streaming follow if pinned and streaming */
  maybeStartStreamingFollow: () => void;
  /** Handler for the "jump-to-latest" button */
  handleScrollToLatestClick: () => void;
  /** Eased scroll to the bottom over SMOOTH_SCROLL_MS. Pass true to scroll even when unpinned. */
  smoothScrollToBottom: (force?: boolean) => void;
  /** True if the latest scroll event came from our own animation rather than the user. */
  isProgrammaticScroll: () => boolean;
  /** Whether to show the jump-to-latest button */
  showScrollToLatest: boolean;
  /** Setter for showScrollToLatest (used by scroll listener) */
  setShowScrollToLatest: (v: boolean) => void;
  /** Whether the user is currently pinned to the bottom */
  userPinnedBottomRef: React.MutableRefObject<boolean>;
  /** Ref to skip next scroll-to-bottom from the messages-change effect */
  skipNextScroll: React.MutableRefObject<boolean>;
}

/**
 * Encapsulates all scroll-related state, refs, callbacks, and effects
 * for the chat message container.
 */
export function useChatScroll({
  containerRef,
  messages,
  isStreaming,
  generatingVariant,
  editingMessageIndex,
}: UseChatScrollOpts): UseChatScrollReturn {
  // Internal state
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

  // Refs
  const userPinnedBottomRef = useRef(true);
  const skipNextScroll = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const lastScrollTime = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevScrollHeightRef = useRef(0);
  const streamingFollowActiveRef = useRef(false);
  const streamingFollowRafRef = useRef<number | null>(null);
  // Last scrollTop we set ourselves, so the page's scroll listener can tell our
  // animation frames apart from a real user scroll and not un-pin the view.
  const lastProgrammaticTopRef = useRef(-1);
  const smoothScrollRafRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);
  // Mirror state into refs so rAF closures see current values
  const isStreamingRef = useRef(isStreaming);
  const generatingVariantRef = useRef(generatingVariant);
  const editingMessageIndexRef = useRef(editingMessageIndex);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { generatingVariantRef.current = generatingVariant; }, [generatingVariant]);
  useEffect(() => { editingMessageIndexRef.current = editingMessageIndex; }, [editingMessageIndex]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = () => { reducedMotionRef.current = mq.matches; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setScrollTop = useCallback((el: HTMLElement, top: number) => {
    el.scrollTop = top;
    lastProgrammaticTopRef.current = el.scrollTop; // read back: the browser clamps
  }, []);

  const isProgrammaticScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return false;
    return Math.abs(el.scrollTop - lastProgrammaticTopRef.current) < 2;
  }, [containerRef]);

  // --- Streaming follow (rAF loop) ---

  const stopStreamingFollow = useCallback(() => {
    streamingFollowActiveRef.current = false;
    if (streamingFollowRafRef.current !== null) {
      cancelAnimationFrame(streamingFollowRafRef.current);
      streamingFollowRafRef.current = null;
    }
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, []);

  const startStreamingFollow = useCallback(() => {
    if (streamingFollowActiveRef.current) return;
    const step = () => {
      if (!streamingFollowActiveRef.current) return;
      const container = containerRef.current;
      if (!container) { stopStreamingFollow(); return; }
      if (
        (!isStreamingRef.current && generatingVariantRef.current === null) ||
        !userPinnedBottomRef.current ||
        editingMessageIndexRef.current !== null
      ) {
        stopStreamingFollow();
        return;
      }
      // Let an in-flight glide finish before taking over the scroll position
      if (smoothScrollRafRef.current !== null) {
        streamingFollowRafRef.current = requestAnimationFrame(step);
        return;
      }
      // Snap to the bottom each frame: the typewriter reveal already grows the content a
      // character at a time, so easing on top of it just lags the text you're reading.
      const target = container.scrollHeight - container.clientHeight;
      if (container.scrollTop !== target) setScrollTop(container, target);
      streamingFollowRafRef.current = requestAnimationFrame(step);
    };
    streamingFollowActiveRef.current = true;
    streamingFollowRafRef.current = requestAnimationFrame(step);
  }, [containerRef, stopStreamingFollow, setScrollTop]);

  const maybeStartStreamingFollow = useCallback(() => {
    if (editingMessageIndex !== null) return;
    if (!userPinnedBottomRef.current) return;
    if (!isStreamingRef.current && generatingVariantRef.current === null) return;
    startStreamingFollow();
  }, [editingMessageIndex, startStreamingFollow]);

  // --- scrollToBottom ---

  const scrollToBottom = useCallback((immediate = false) => {
    if (!containerRef.current) return;
    if (editingMessageIndex !== null) return;
    // A glide or the follow loop already owns the scroll position; a hard snap would cut it short
    if (smoothScrollRafRef.current !== null && !immediate) return;
    if (streamingFollowActiveRef.current && !immediate) return;
    if (!userPinnedBottomRef.current && !immediate) {
      // Drop a throttled scroll queued before the user scrolled away
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const timeSinceLastScroll = now - lastScrollTime.current;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    const forceAuto = !initialScrollDoneRef.current;
    if (immediate || !isStreaming) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: (immediate || forceAuto) ? 'auto' : 'smooth',
      });
      lastScrollTime.current = now;
    } else if (timeSinceLastScroll > 100) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' });
      lastScrollTime.current = now;
    } else {
      scrollTimeoutRef.current = setTimeout(() => {
        // Re-check: the user may have scrolled up while this was queued
        if (containerRef.current && userPinnedBottomRef.current && editingMessageIndexRef.current === null) {
          containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' });
          lastScrollTime.current = Date.now();
        }
        scrollTimeoutRef.current = null;
      }, 100 - timeSinceLastScroll);
    }
  }, [containerRef, isStreaming, editingMessageIndex]);

  // --- One-time initial scroll (layout phase, no flicker) ---
  useLayoutEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (!containerRef.current) return;
    if (messages.length === 0) return;
    try {
      setScrollTop(containerRef.current, containerRef.current.scrollHeight);
      initialScrollDoneRef.current = true;
    } catch {}
  }, [containerRef, messages.length, setScrollTop]);

  // --- Bottom-anchoring: compensate for height growth during streaming ---
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const prev = prevScrollHeightRef.current;
    const cur = el.scrollHeight;
    if (
      prev !== 0 &&
      cur > prev &&
      userPinnedBottomRef.current &&
      (isStreamingRef.current || generatingVariantRef.current !== null) &&
      editingMessageIndex === null
    ) {
      const growth = cur - prev;
      const beforeDist = cur - growth - el.scrollTop - el.clientHeight;
      if (beforeDist < 4) {
        setScrollTop(el, cur - el.clientHeight);
      } else {
        setScrollTop(el, el.scrollTop + growth);
      }
    }
    prevScrollHeightRef.current = cur;
  }, [containerRef, messages, editingMessageIndex, setScrollTop]);

  // --- Scroll to bottom on message change ---
  useEffect(() => {
    if (skipNextScroll.current) { skipNextScroll.current = false; return; }
    if (editingMessageIndex !== null) return;
    scrollToBottom();
  }, [messages, scrollToBottom, editingMessageIndex]);

  // --- Eased scroll to bottom (used when a non-streamed reply lands) ---
  const smoothScrollToBottom = useCallback((force = false) => {
    const el = containerRef.current;
    if (!el) return;
    if (editingMessageIndexRef.current !== null) return;
    if (!force && !userPinnedBottomRef.current) return;

    if (smoothScrollRafRef.current !== null) {
      cancelAnimationFrame(smoothScrollRafRef.current);
      smoothScrollRafRef.current = null;
    }
    userPinnedBottomRef.current = true;
    setShowScrollToLatest(false);

    if (reducedMotionRef.current) {
      setScrollTop(el, el.scrollHeight - el.clientHeight);
      return;
    }

    const from = el.scrollTop;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const node = containerRef.current;
      if (!node) { smoothScrollRafRef.current = null; return; }
      const t = Math.min(1, (now - startedAt) / SMOOTH_SCROLL_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      // Re-read the target each frame: the message is still settling into layout
      const to = node.scrollHeight - node.clientHeight;
      setScrollTop(node, from + (to - from) * eased);
      smoothScrollRafRef.current = t < 1 ? requestAnimationFrame(tick) : null;
    };
    smoothScrollRafRef.current = requestAnimationFrame(tick);
  }, [containerRef, setScrollTop]);

  // --- Scroll-to-latest button handler ---
  const handleScrollToLatestClick = useCallback(() => {
    userPinnedBottomRef.current = true;
    smoothScrollToBottom(true);
  }, [smoothScrollToBottom]);

  useEffect(() => () => {
    if (smoothScrollRafRef.current !== null) cancelAnimationFrame(smoothScrollRafRef.current);
  }, []);

  return {
    smoothScrollToBottom,
    isProgrammaticScroll,
    stopStreamingFollow,
    maybeStartStreamingFollow,
    handleScrollToLatestClick,
    showScrollToLatest,
    setShowScrollToLatest,
    userPinnedBottomRef,
    skipNextScroll,
  };
}
