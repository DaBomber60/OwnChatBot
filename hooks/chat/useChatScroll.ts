import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ChatMessage } from '../../types/models';

export interface UseChatScrollOpts {
  containerRef: React.RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  isStreaming: boolean;
  generatingVariant: number | null;
  editingMessageIndex: number | null;
}

export interface UseChatScrollReturn {
  /** Scroll to the bottom of the chat container */
  scrollToBottom: (immediate?: boolean) => void;
  /** Start rAF-based streaming follow loop */
  startStreamingFollow: () => void;
  /** Stop rAF-based streaming follow loop */
  stopStreamingFollow: () => void;
  /** Conditionally start streaming follow if pinned and streaming */
  maybeStartStreamingFollow: () => void;
  /** Handler for the "jump-to-latest" button */
  handleScrollToLatestClick: () => void;
  /** Whether to show the jump-to-latest button */
  showScrollToLatest: boolean;
  /** Setter for showScrollToLatest (used by scroll listener) */
  setShowScrollToLatest: (v: boolean) => void;
  /** Whether the user is currently pinned to the bottom */
  userPinnedBottomRef: React.MutableRefObject<boolean>;
  /** Ref to suppress one auto-scroll cycle */
  suppressNextAutoScrollRef: React.MutableRefObject<boolean>;
  /** Ref to skip next scroll-to-bottom from the messages-change effect */
  skipNextScroll: React.MutableRefObject<boolean>;
  /** Ref to force smooth scroll on next call */
  forceNextSmoothRef: React.MutableRefObject<boolean>;
  /** Ref tracking previous scroll height for bottom-anchoring */
  prevScrollHeightRef: React.MutableRefObject<number>;
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
  const suppressNextAutoScrollRef = useRef(false);
  const skipNextScroll = useRef(false);
  const forceNextSmoothRef = useRef(false);
  const initialScrollDoneRef = useRef(false);
  const lastScrollTime = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const prevScrollHeightRef = useRef(0);
  const streamingFollowActiveRef = useRef(false);
  const streamingFollowRafRef = useRef<number | null>(null);
  // Mirror state into refs so rAF closures see current values
  const isStreamingRef = useRef(isStreaming);
  const generatingVariantRef = useRef(generatingVariant);
  const editingMessageIndexRef = useRef(editingMessageIndex);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { generatingVariantRef.current = generatingVariant; }, [generatingVariant]);
  useEffect(() => { editingMessageIndexRef.current = editingMessageIndex; }, [editingMessageIndex]);

  // --- Streaming follow (rAF loop) ---

  const stopStreamingFollow = useCallback(() => {
    streamingFollowActiveRef.current = false;
    if (streamingFollowRafRef.current !== null) {
      cancelAnimationFrame(streamingFollowRafRef.current);
      streamingFollowRafRef.current = null;
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
      const target = container.scrollHeight - container.clientHeight;
      container.scrollTop = target;
      streamingFollowRafRef.current = requestAnimationFrame(step);
    };
    streamingFollowActiveRef.current = true;
    streamingFollowRafRef.current = requestAnimationFrame(step);
  }, [containerRef, stopStreamingFollow]);

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
    if (!userPinnedBottomRef.current && !immediate) return;

    const now = Date.now();
    const timeSinceLastScroll = now - lastScrollTime.current;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    const forceAuto = !initialScrollDoneRef.current;
    const wantSmooth = !immediate && !isStreaming && (forceNextSmoothRef.current || !forceAuto);
    if (immediate || !isStreaming || forceNextSmoothRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: (immediate || forceAuto) ? 'auto' : wantSmooth ? 'smooth' : 'auto',
      });
      if (forceNextSmoothRef.current) forceNextSmoothRef.current = false;
      lastScrollTime.current = now;
    } else if (timeSinceLastScroll > 100) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'auto' });
      lastScrollTime.current = now;
    } else {
      scrollTimeoutRef.current = setTimeout(() => {
        if (containerRef.current) {
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
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      initialScrollDoneRef.current = true;
    } catch {}
  }, [containerRef, messages.length]);

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
        el.scrollTop = cur - el.clientHeight;
      } else {
        el.scrollTop = el.scrollTop + growth;
      }
    }
    prevScrollHeightRef.current = cur;
  }, [containerRef, messages, editingMessageIndex]);

  // --- Scroll to bottom on message change ---
  useEffect(() => {
    if (skipNextScroll.current) { skipNextScroll.current = false; return; }
    if (editingMessageIndex !== null) return;
    scrollToBottom();
  }, [messages, scrollToBottom, editingMessageIndex]);

  // --- Scroll-to-latest button handler ---
  const handleScrollToLatestClick = useCallback(() => {
    userPinnedBottomRef.current = true;
    suppressNextAutoScrollRef.current = false;
    forceNextSmoothRef.current = true;
    scrollToBottom(false);
  }, [scrollToBottom]);

  return {
    scrollToBottom,
    startStreamingFollow,
    stopStreamingFollow,
    maybeStartStreamingFollow,
    handleScrollToLatestClick,
    showScrollToLatest,
    setShowScrollToLatest,
    userPinnedBottomRef,
    suppressNextAutoScrollRef,
    skipNextScroll,
    forceNextSmoothRef,
    prevScrollHeightRef,
  };
}
