import { useCallback, useEffect, useRef } from 'react';
import { REVEAL_MIN_CHARS_PER_SEC, REVEAL_CATCHUP_MS } from '../../lib/chat/layout';

export interface UseStreamRevealReturn {
  /** Begin a reveal, routing revealed text to `emit`. Clears any previous buffer. */
  start: (emit: (text: string) => void) => void;
  /** Feed the full accumulated text received so far. */
  push: (fullText: string) => void;
  /** Reveal the remainder immediately and stop animating. */
  flush: () => void;
  /** Abandon the buffer without emitting. */
  reset: () => void;
}

/**
 * Decouples rendering from token arrival: tokens go into a buffer and are revealed a
 * character at a time on animation frames, so chunky provider frames read as smooth typing.
 * The rate scales with the backlog so the display never falls more than
 * REVEAL_CATCHUP_MS behind the stream.
 */
export function useStreamReveal(): UseStreamRevealReturn {
  const emitRef = useRef<((text: string) => void) | null>(null);
  const targetRef = useRef('');
  const shownRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mq.matches;
    const onChange = () => { reducedMotionRef.current = mq.matches; };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const step = useCallback((ts: number) => {
    rafRef.current = null;
    const emit = emitRef.current;
    if (!emit) return;
    const target = targetRef.current;
    const backlog = target.length - shownRef.current;
    if (backlog <= 0) return; // idle until the next push

    // Clamp dt so a backgrounded tab doesn't dump the whole buffer on return
    const dt = lastTsRef.current ? Math.min(ts - lastTsRef.current, 100) : 16;
    lastTsRef.current = ts;

    const charsPerMs = Math.max(REVEAL_MIN_CHARS_PER_SEC / 1000, backlog / REVEAL_CATCHUP_MS);
    const advance = Math.max(1, Math.round(charsPerMs * dt));
    shownRef.current = Math.min(target.length, shownRef.current + advance);
    emit(target.slice(0, shownRef.current));

    if (shownRef.current < target.length) rafRef.current = requestAnimationFrame(step);
  }, []);

  const ensureRunning = useCallback(() => {
    if (rafRef.current !== null) return;
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(step);
  }, [step]);

  const start = useCallback((emit: (text: string) => void) => {
    cancel();
    emitRef.current = emit;
    targetRef.current = '';
    shownRef.current = 0;
    lastTsRef.current = 0;
  }, [cancel]);

  const push = useCallback((fullText: string) => {
    targetRef.current = fullText;
    if (reducedMotionRef.current) {
      shownRef.current = fullText.length;
      emitRef.current?.(fullText);
      return;
    }
    ensureRunning();
  }, [ensureRunning]);

  const flush = useCallback(() => {
    cancel();
    const target = targetRef.current;
    if (shownRef.current < target.length) {
      shownRef.current = target.length;
      emitRef.current?.(target);
    }
  }, [cancel]);

  const reset = useCallback(() => {
    cancel();
    emitRef.current = null;
    targetRef.current = '';
    shownRef.current = 0;
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return { start, push, flush, reset };
}
