import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import Head from 'next/head';
import { fetcher } from '../../lib/fetcher';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useNotes } from '../../hooks/chat/useNotes';
import { useSummary } from '../../hooks/chat/useSummary';
import { useChatScroll } from '../../hooks/chat/useChatScroll';
import { ChatHeader } from '../../components/chat/ChatHeader';
import { ChatInput } from '../../components/chat/ChatInput';
import { SummaryModal } from '../../components/chat/SummaryModal';
import { NotesOverlayModal, NotesSidecar } from '../../components/chat/NotesPanel';
import { DeleteConfirmModal } from '../../components/chat/DeleteConfirmModal';
import { ErrorModal } from '../../components/chat/ErrorModal';
import { VariantTempPopover } from '../../components/chat/VariantTempPopover';
import { readSSEStream, isSSEResponse, performStreamingRequest } from '../../lib/chat/streamSSE';
import { fetchChatSettings } from '../../lib/chat/chatSettings';
import { safeJson, sanitizeErrorMessage, extractUsefulError, extractErrorFromResponse } from '../../lib/chat/errorUtils';
import { sanitizeMessage } from '../../lib/messageFormat';
import type { ChatMessage, Message, MessageVersion, SessionData } from '../../types/models';

const INITIAL_PAGE_SIZE = 20; // messages for initial load
const SCROLL_PAGE_SIZE = 60; // messages to load per top-scroll fetch

// Utility to format message content with newlines, italics, bold, and monospace code
function formatMessage(content: string) {
  // Handle empty content
  if (!content) return '';
  
  // Replace horizontal dividers first (before other formatting)
  // Handle --- and ___ as horizontal dividers (either standalone or on their own line)
  const html = content
    // Replace standalone dividers on their own lines
    .replace(/^---+\s*$/gm, '<div class="message-divider"></div>')
    .replace(/^___+\s*$/gm, '<div class="message-divider"></div>')
    // Replace inline dividers surrounded by whitespace or line breaks
    .replace(/(\s|^)---+(\s|$)/g, '$1<div class="message-divider"></div>$2')
    .replace(/(\s|^)___+(\s|$)/g, '$1<div class="message-divider"></div>$2')
    // Now handle text formatting
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Normalize multiple consecutive newlines to double breaks for proper spacing
    .replace(/\n\s*\n+/g, '\n\n') // Replace multiple newlines with double newline
    .replace(/\n\n/g, '</div><div class="line-break-spacer"></div><div>') // Double breaks get spacing
    .replace(/\n/g, '</div><div>'); // Single breaks become new divs
  
  // Wrap the entire content in a div structure for better iOS compatibility
  // Sanitize via DOMPurify to prevent XSS from user/AI-injected HTML
  return sanitizeMessage(`<div>${html}</div>`);
}

export default function ChatSessionPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, error, mutate } = useSWR<SessionData>(id ? `/api/sessions/${id}?limit=${INITIAL_PAGE_SIZE}` : null, fetcher, { revalidateOnFocus: false });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [justFinishedStreaming, setJustFinishedStreaming] = useState(false);
  const [skipNextMessageUpdate, setSkipNextMessageUpdate] = useState(false);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [messageVariants, setMessageVariants] = useState<Map<number, MessageVersion[]>>(new Map());
  const [currentVariantIndex, setCurrentVariantIndex] = useState<Map<number, number>>(new Map());
  const [generatingVariant, setGeneratingVariant] = useState<number | null>(null);
  const [variantDisplayContent, setVariantDisplayContent] = useState<Map<number, string>>(new Map());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteMessageIndex, setDeleteMessageIndex] = useState<number | null>(null);
  // Variant temperature popover state
  const [variantTempPopover, setVariantTempPopover] = useState<{ messageId: number | null; x: number; y: number } | null>(null);
  const [variantTempValue, setVariantTempValue] = useState<number>(0.7);
  const [settingsTemperature, setSettingsTemperature] = useState<number>(0.7);
  const variantButtonPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  // API error modal
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [apiErrorMessage, setApiErrorMessage] = useState('');
  // reusing error modal for truncation warnings
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [isBurgerMenuOpen, setIsBurgerMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(112); // Initial estimate: 80px header + 32px gap
  const streamingMessageRef = useRef<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const streamingAbortController = useRef<AbortController | null>(null);
  const variantAbortController = useRef<AbortController | null>(null);
  const oldestMessageIdRef = useRef<number | null>(null); // cursor for loading older pages
  // Track last sent user input so we can restore it if streaming is aborted early
  const lastSentInputRef = useRef<string>('');
  const shouldRestoreInputRef = useRef<boolean>(false);
  // Track the last server-known message ID before sending, so we can roll back on abort
  const preStreamLastMessageIdRef = useRef<number | null>(null);
  // Track originals edited while variants exist so we don't restore stale variantDisplayContent over updated main message
  const recentlyEditedOriginalRef = useRef<Set<number>>(new Set());
  // Ensure bump-to-latest runs on initial page load too (one-time per message)
  const initialVariantBumpDoneRef = useRef<Set<number>>(new Set());
  // Track which assistant messages have resolved their initial variant selection
  const initialVariantResolvedRef = useRef<Set<number>>(new Set());
  // Gate the initial anti-flicker hide to first hydration only
  const initialHydrationDoneRef = useRef<boolean>(false);

  // --- Extracted hooks ---
  const notes = useNotes(id);
  const { showNotesModal, setShowNotesModal, notesContent, setNotesContent, originalNotesContent, setOriginalNotesContent, savingNotes, saveNotes, cancelNotesChanges, hasNotesChanges } = notes;

  // mutateWithVariantPreservation is defined later — useSummary needs a stable callback.
  // We use a ref to break the circular dependency.
  const mutateWithVariantPreservationRef = useRef<() => Promise<void>>(async () => {});
  const summary = useSummary(session, id, async () => mutateWithVariantPreservationRef.current());
  const { showSummaryModal, setShowSummaryModal, summaryContent, setSummaryContent, savingSummary, generatingSummary, updatingSummary, saveSummary, generateSummary, updateSummary, canUpdateSummary } = summary;

  const scroll = useChatScroll({ containerRef, messages, isStreaming, generatingVariant, editingMessageIndex });
  const { scrollToBottom, startStreamingFollow, stopStreamingFollow, maybeStartStreamingFollow, handleScrollToLatestClick, showScrollToLatest, setShowScrollToLatest, userPinnedBottomRef, suppressNextAutoScrollRef, skipNextScroll, forceNextSmoothRef } = scroll;
  // Debug helper for response logging
  const logMeta = (label: string, res: Response) => {
    try {
      console.log(label, {
        ok: res.ok, status: res.status, statusText: res.statusText,
        headers: { 'content-type': res.headers.get('content-type') }
      });
    } catch {}
  };

  // Show warning if the last API request was heavily truncated (<=16 messages sent)
  const maybeShowTruncationWarning = async () => {
    try {
      const sessionIdNum = Number(id);
      if (!sessionIdNum || Number.isNaN(sessionIdNum)) return;
      const res = await fetch(`/api/chat/request-log/meta/${sessionIdNum}`);
      if (!res.ok) return;
      const meta = await res.json();
      const wasTruncated = !!meta?.wasTruncated;
      const sentCount = typeof meta?.sentCount === 'number' ? meta.sentCount : undefined;
      if (wasTruncated && typeof sentCount === 'number' && sentCount <= 16) {
        const baseCount = typeof meta?.baseCount === 'number' ? meta.baseCount : undefined;
        const detail = baseCount ? ` (${sentCount} of ${baseCount})` : ` (${sentCount})`;
        setApiErrorMessage(`Context was heavily truncated${detail}. Increase Max Characters in Settings if you want more history included.`);
        setShowErrorModal(true);
      }
    } catch {}
  };

  // Show modal if the last API response hit the max_tokens limit
  const maybeShowMaxTokensCutoff = async () => {
    const hit = await checkMaxTokensHit();
    if (hit) {
      setApiErrorMessage('The response stopped early because it hit your Max Tokens limit. You can increase Max Tokens in Settings or press Continue to keep going.');
      setShowErrorModal(true);
    }
  };

  // Check if last API response ended due to hitting max tokens (finish_reason = 'length')
  const checkMaxTokensHit = async (): Promise<boolean> => {
    try {
      const sessionIdNum = Number(id);
      if (!sessionIdNum || Number.isNaN(sessionIdNum)) return false;
      const res = await fetch(`/api/chat/response-log/${sessionIdNum}`);
      if (!res.ok) return false;
      const payload = await res.json();
      const mode = payload?.mode;
      if (mode === 'json') {
        let body = payload?.body;
        if (!body && typeof payload?.bodyText === 'string') {
          try { body = JSON.parse(payload.bodyText); } catch {}
        }
        const fr = body?.choices?.[0]?.finish_reason;
        if (fr === 'length') return true;
        if (typeof payload?.bodyText === 'string' && payload.bodyText.includes('"finish_reason":"length"')) return true;
      } else if (mode === 'sse') {
        const frames: string[] = Array.isArray(payload?.frames) ? payload.frames : [];
        for (let i = frames.length - 1; i >= 0 && i >= frames.length - 50; i--) {
          const f = frames[i];
          if (!f || typeof f !== 'string') continue;
          try {
            const j = JSON.parse(f);
            const fr = j?.choices?.[0]?.finish_reason;
            if (fr === 'length') return true;
          } catch {}
        }
      }
      return false;
    } catch {
      return false;
    }
  };

  // Reset initial variant gating when navigating to a different chat
  useEffect(() => {
    initialVariantBumpDoneRef.current.clear();
    initialVariantResolvedRef.current.clear();
    initialHydrationDoneRef.current = false;
  }, [id]);

  // Fetch and prepend older messages using beforeId cursor
  const loadOlderMessages = useCallback(async () => {
    if (!id || loadingMore || !hasMore) return;
    const beforeId = oldestMessageIdRef.current;
    setLoadingMore(true);
    try {
      const url = beforeId
        ? `/api/sessions/${id}?limit=${SCROLL_PAGE_SIZE}&beforeId=${beforeId}`
        : `/api/sessions/${id}?limit=${SCROLL_PAGE_SIZE}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load older messages: ${res.status}`);
      }
      const page: SessionData = await res.json();
      const raw = page.messages || [];
      // Update cursor and hasMore
      if (raw.length > 0) {
        const newOldest = raw[0]!.id;
        const cur = oldestMessageIdRef.current;
        oldestMessageIdRef.current = cur == null ? newOldest : Math.min(cur, newOldest);
      }
      setHasMore(!!page.hasMore);
      // Process raw messages into ChatMessage[] (skip continuation placeholders and combine local within this chunk)
      const CONTINUE_MESSAGE = '[SYSTEM NOTE: Ignore this message, reply as if you are extending the last message you sent as if your reply never ended - do not make an effort to send a message on behalf of the user unless the most recent message from you did include speaking on behalf of the user. Specifically do not start messages with `{{user}}: `, you should NEVER use that format in any message.]';
      const olderProcessed: ChatMessage[] = [];
      for (let i = 0; i < raw.length; i++) {
        const m = raw[i];
        if (!m) continue;
        if (m.role === 'user' && m.content === CONTINUE_MESSAGE) continue;
        if (m.role === 'assistant' && i > 0) {
          const prev = raw[i - 1];
          if (prev && prev.role === 'user' && prev.content === CONTINUE_MESSAGE) {
            // Merge with previous assistant in this processed chunk if any
            const lastAssistantIndex = olderProcessed.findLastIndex(mm => mm.role === 'assistant');
            if (lastAssistantIndex !== -1) {
              const prevAssist = olderProcessed[lastAssistantIndex];
              if (prevAssist) {
                olderProcessed[lastAssistantIndex] = {
                  role: 'assistant',
                  content: prevAssist.content + '\n\n' + m.content,
                  messageId: prevAssist.messageId
                };
                continue;
              }
            }
          }
        }
        olderProcessed.push({ role: m.role as 'user' | 'assistant', content: m.content, messageId: m.id });
      }
      // Prepend and preserve scroll position (with de-duplication by messageId)
      const el = containerRef.current;
      const prevScrollHeight = el ? el.scrollHeight : 0;
      const prevScrollTop = el ? el.scrollTop : 0;
      setMessages(prev => {
        const existingIds = new Set<number>();
        for (const pm of prev) {
          if (pm.messageId != null) existingIds.add(pm.messageId);
        }
        const deduped = olderProcessed.filter(m => m.messageId == null || !existingIds.has(m.messageId));
        if (deduped.length === 0) return prev; // no changes
        return [...deduped, ...prev];
      });
      // After DOM updates, adjust scrollTop by growth delta to keep view stable
      requestAnimationFrame(() => {
        const el2 = containerRef.current;
        if (!el2) return;
        const newScrollHeight = el2.scrollHeight;
        const growth = newScrollHeight - prevScrollHeight;
        // Keep viewport anchored at the same visible message
        el2.scrollTop = prevScrollTop + growth;
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  }, [id, hasMore, loadingMore]);

  // Lazy-load older messages on near-top scroll, and toggle scroll-to-latest button
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const handleScroll = () => {
      // During editing, only update refs silently – avoid any setState that would trigger
      // a React re-render (which causes the browser to fight with text-selection scrolling).
      if (editingMessageIndex !== null) return;

      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const wasPinned = userPinnedBottomRef.current;
      userPinnedBottomRef.current = distanceFromBottom < 120; // threshold
      if (wasPinned && !userPinnedBottomRef.current) suppressNextAutoScrollRef.current = true;
      setShowScrollToLatest(!userPinnedBottomRef.current);
      // Near the top? Load older messages if available (but not while editing)
      if (el.scrollTop < 120 && hasMore && !loadingMore) {
        loadOlderMessages();
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll as any);
  }, [hasMore, loadingMore, loadOlderMessages, editingMessageIndex]);

  // Function to stop streaming (both chat and variant generation)
  const stopStreaming = useCallback(() => {
    if (streamingAbortController.current) {
      streamingAbortController.current.abort();
      streamingAbortController.current = null;
      setIsStreaming(false);
  stopStreamingFollow();
      setLoading(false);
      // If user aborted mid-stream on a NEW message (not continue/retry),
      // restore their input and remove the user message + partial assistant response.
      if (shouldRestoreInputRef.current && lastSentInputRef.current) {
        const savedInput = lastSentInputRef.current;
        const lastKnownId = preStreamLastMessageIdRef.current;
        // Always restore the user's message to the input box
        setInput(savedInput);
        // Remove the last user message + any partial assistant response from local state
        setMessages(prev => {
          const copy = [...prev];
          if (copy.length > 0 && copy[copy.length - 1]?.role === 'assistant') copy.pop();
          if (copy.length > 0 && copy[copy.length - 1]?.role === 'user') copy.pop();
          return copy;
        });
        // Delete server-side messages that were created after our last known point.
        // Delay to let the server's partial-save from req.on('close') complete first.
        if (lastKnownId && id) {
          setTimeout(async () => {
            try {
              // Fetch the session to find the actual server-side message IDs
              const res = await fetch(`/api/sessions/${id}?limit=10`);
              if (res.ok) {
                const data = await res.json();
                const serverMsgs = data.messages || [];
                // Find the first message added after our last known good message
                const firstNew = serverMsgs.find((m: any) => m.id > lastKnownId);
                if (firstNew) {
                  await fetch(`/api/messages/${firstNew.id}?truncate=1`, { method: 'DELETE' });
                }
              }
              skipNextScroll.current = true;
              await mutate();
            } catch {}
            preStreamLastMessageIdRef.current = null;
          }, 600);
        }
        // Skip the next message sync to avoid the server state overwriting our local rollback
        setSkipNextMessageUpdate(true);
        setJustFinishedStreaming(true);
        streamingMessageRef.current = '';
        shouldRestoreInputRef.current = false;
      }
    }
    
    if (variantAbortController.current) {
      // If we're generating a variant, immediately switch to the previous variant before aborting
      const currentlyGeneratingVariant = generatingVariant;
      if (currentlyGeneratingVariant) {
        // Get current variants for the message being generated
        const variants = messageVariants.get(currentlyGeneratingVariant) || [];
        // If last entry is a placeholder (id -1) drop it
        if (variants.length > 0) {
          const lastVar = variants[variants.length - 1];
          if (lastVar && lastVar.id === -1) {
          const restored = variants.slice(0, -1); // remove placeholder
          setMessageVariants(prev => {
            const newMap = new Map(prev);
            newMap.set(currentlyGeneratingVariant, restored);
            return newMap;
          });
          // Decide new index (previous variant count) and content
          const newVariantCount = restored.length;
          const originalMessage = messages.find(m => m.messageId === currentlyGeneratingVariant);
          const recentVariant = newVariantCount > 0 ? restored[newVariantCount - 1] : undefined;
          const displayContent = recentVariant?.content || originalMessage?.content || '';
          setVariantDisplayContent(prev => {
            const newMap = new Map(prev);
            if (displayContent) newMap.set(currentlyGeneratingVariant, displayContent);
            else newMap.delete(currentlyGeneratingVariant);
            return newMap;
          });
          setCurrentVariantIndex(prev => {
            const newMap = new Map(prev);
            // index is number of variants (each variant index is +1 offset from original)
            newMap.set(currentlyGeneratingVariant, newVariantCount);
            return newMap;
          });
          saveVariantSelection(currentlyGeneratingVariant, newVariantCount);
          }
        }
      }
      
      // Now abort the variant generation
      variantAbortController.current.abort();
      variantAbortController.current = null;
      setGeneratingVariant(null);
    }
  }, [generatingVariant, messageVariants, currentVariantIndex, messages]);

  // Commit the currently displayed variant for a message
  const commitDisplayedVariant = async (messageId: number) => {
    const variants = messageVariants.get(messageId) || [];
    const currentIndex = currentVariantIndex.get(messageId) || 0;
    
    // If we're showing the original (index 0), no need to commit
    if (currentIndex === 0) {
      return;
    }
    
    const selectedVariant = variants[currentIndex - 1];
    if (!selectedVariant) return;
    
    try {
      const response = await fetch(`/api/messages/${messageId}/variants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: selectedVariant.id })
      });
      
      if (!response.ok) {
        throw new Error('Failed to commit variant');
      }
      
      // Update the message content in the UI
      setMessages(prev => prev.map(msg => {
        if (msg.messageId === messageId) {
          return { ...msg, content: selectedVariant.content };
        }
        return msg;
      }));
      
    } catch (error) {
      console.error('Failed to commit variant:', error);
    }
  };

  // Clean up variants when user responds to a message
  const cleanupVariants = async (messageId: number) => {
    try {
      await fetch(`/api/messages/${messageId}/variants`, {
        method: 'DELETE'
      });
      
      // Clear from state immediately to update UI
      setMessageVariants(prev => {
        const newMap = new Map(prev);
        newMap.delete(messageId);
        return newMap;
      });
      setCurrentVariantIndex(prev => {
        const newMap = new Map(prev);
        newMap.delete(messageId);
        return newMap;
      });
      setVariantDisplayContent(prev => {
        const newMap = new Map(prev);
        newMap.delete(messageId);
        return newMap;
      });
      
      // Clean up localStorage for this message's variant selection
      if (id) {
        const storageKey = getVariantStorageKey(id, messageId);
        localStorage.removeItem(storageKey);
      }
    } catch (error) {
      console.error('Failed to cleanup variants:', error);
    }
  };

  // Generate a new variant for a message
  const generateVariant = async (messageId: number, opts?: { temperature?: number }) => {
    if (generatingVariant || loading || isStreaming) return;

    // Helper to revert a placeholder variant on error/abort
    const revertVariantPlaceholder = (mid: number) => {
      setMessageVariants(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(mid) || [];
        const trimmed = existing.filter(v => v.id !== -1 ? true : false).length === existing.length
          ? existing.slice(0, -1)
          : existing.filter(v => v.id !== -1);
        newMap.set(mid, trimmed);
        const newCount = trimmed.length;
        setCurrentVariantIndex(ci => { const m = new Map(ci); m.set(mid, newCount); return m; });
        const orig = messages.find(m => m.messageId === mid);
        const recent = newCount > 0 ? trimmed[newCount - 1] : undefined;
        const fallback = recent?.content || orig?.content || '';
        setVariantDisplayContent(vp => { const m = new Map(vp); if (fallback) m.set(mid, fallback); else m.delete(mid); return m; });
        saveVariantSelection(mid, newCount);
        return newMap;
      });
    };

    // Helper to replace the placeholder with a real variant record
    const replacePlaceholderWithReal = (variant: any) => {
      setMessageVariants(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(messageId) || [];
        const updated = [...existing];
        updated[updated.length - 1] = variant;
        newMap.set(messageId, updated);
        return newMap;
      });
    };
    
    setGeneratingVariant(messageId);
    
    try {
      // Get current variants to calculate the new index
      const currentVariants = messageVariants.get(messageId) || [];
      const newVariantIndex = currentVariants.length + 1;
      
      // Create a placeholder variant immediately and switch to it
      flushSync(() => {
        setMessageVariants(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(messageId) || [];
          newMap.set(messageId, [...existing, { id: -1, content: '', version: newVariantIndex, isActive: false, messageId }]);
          return newMap;
        });
        setCurrentVariantIndex(prev => { const m = new Map(prev); m.set(messageId, newVariantIndex); return m; });
        saveVariantSelection(messageId, newVariantIndex);
        setVariantDisplayContent(prev => { const m = new Map(prev); m.set(messageId, ''); return m; });
      });
      
      setTimeout(() => scrollToBottom(false), 5);

      const result = await performStreamingRequest({
        url: `/api/messages/${messageId}/variants`,
        body: { ...(opts?.temperature != null ? { temperature: opts.temperature } : {}) },
        abortControllerRef: variantAbortController,
        skipSettingsInBody: true,
        onStreamChunk: (accumulated) => {
          setVariantDisplayContent(prev => { const m = new Map(prev); m.set(messageId, accumulated); return m; });
          maybeStartStreamingFollow();
        },
        onNonStreamResult: (data) => {
          // Non-streaming: `data` is the variant record itself
          replacePlaceholderWithReal(data);
          setVariantDisplayContent(prev => { const m = new Map(prev); m.set(messageId, data.content); return m; });
        },
        onComplete: async () => {
          await maybeShowTruncationWarning();
          await maybeShowMaxTokensCutoff();
        },
        onError: (msg) => {
          setApiErrorMessage(msg);
          setShowErrorModal(true);
          revertVariantPlaceholder(messageId);
        },
        onAbort: () => {
          revertVariantPlaceholder(messageId);
          setGeneratingVariant(null);
          stopStreamingFollow();
        },
      });

      if (result.wasAborted) return;

      // For streaming: fetch the real variant record to replace the placeholder
      if (result.wasStreaming) {
        try {
          const finalResponse = await fetch(`/api/messages/${messageId}/variants/latest`);
          if (finalResponse.ok) {
            const newVariant = await finalResponse.json();
            replacePlaceholderWithReal(newVariant);
          }
        } catch {}
      }

      stopStreamingFollow();
      
    } catch (error) {
      console.error('Failed to generate variant:', error);
      setApiErrorMessage(sanitizeErrorMessage(extractUsefulError((error as any)?.message || JSON.stringify(error))));
      setShowErrorModal(true);
      revertVariantPlaceholder(messageId);
      
    } finally {
      variantAbortController.current = null;
      setTimeout(async () => {
        skipNextScroll.current = true;
        await mutate();
        setTimeout(() => setGeneratingVariant(null), 100);
      }, 100);
    }
  };

  // Long-press handlers for variant button
  const handleVariantButtonPressStart = (e: React.MouseEvent | React.TouchEvent, messageId: number) => {
    // Record position to place popover near button
    const clientX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as any).clientX;
    const clientY = 'touches' in e && e.touches[0] ? e.touches[0].clientY : (e as any).clientY;
    if (variantButtonPressTimerRef.current) {
      clearTimeout(variantButtonPressTimerRef.current);
      variantButtonPressTimerRef.current = null;
    }
    variantButtonPressTimerRef.current = setTimeout(() => {
  // Default the slider to the current settings value when opening
  setVariantTempValue(isFinite(settingsTemperature) ? settingsTemperature : 0.7);
      setVariantTempPopover({ messageId, x: clientX, y: clientY });
    }, 450); // ~0.45s long-press
  };

  const handleVariantButtonPressEnd = () => {
    if (variantButtonPressTimerRef.current) {
      clearTimeout(variantButtonPressTimerRef.current);
      variantButtonPressTimerRef.current = null;
    }
  };

  const closeVariantTempPopover = () => setVariantTempPopover(null);

  const sendVariantWithTemp = async () => {
    const mid = variantTempPopover?.messageId;
    if (!mid) return;
    closeVariantTempPopover();
    await generateVariant(mid, { temperature: variantTempValue });
  };

  // Load temperature from settings to use as default popover value
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const settings = await res.json();
          const t = settings.temperature != null ? parseFloat(settings.temperature) : NaN;
          if (mounted && !isNaN(t)) {
            // Clamp to 0..2 range
            const clamped = Math.max(0, Math.min(2, t));
            setSettingsTemperature(clamped);
          }
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  // Close temp popover on Escape
  useEffect(() => {
    if (!variantTempPopover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeVariantTempPopover();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [variantTempPopover]);

  // Get localStorage key for variant selection
  const getVariantStorageKey = (sessionId: string | string[] | number, messageId: number) => {
    const sessionIdStr = Array.isArray(sessionId) ? sessionId[0] : sessionId;
    return `variant-selection-${sessionIdStr}-${messageId}`;
  };

  // Save variant selection to localStorage (store both index and current count for smarter reloads)
  const saveVariantSelection = (messageId: number, variantIndex: number) => {
    if (!id) return;
    const key = getVariantStorageKey(id, messageId);
    const count = (messageVariants.get(messageId) || []).length;
    try {
      localStorage.setItem(key, JSON.stringify({ index: variantIndex, count }));
    } catch {
      // Fallback to plain index for environments with storage quirks
      localStorage.setItem(key, variantIndex.toString());
    }
  };

  // Load variant selection (supports legacy number or JSON { index, count })
  const loadVariantSelection = (messageId: number): { index: number | null, count: number | null } => {
    if (!id) return { index: null, count: null };
    const key = getVariantStorageKey(id, messageId);
    const stored = localStorage.getItem(key);
    if (!stored) return { index: null, count: null };
    try {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && 'index' in parsed) {
        const idx = Number((parsed as any).index);
        const cnt = (parsed as any).count != null ? Number((parsed as any).count) : null;
        return { index: isNaN(idx) ? null : idx, count: isNaN(cnt as any) ? null : (cnt as number) };
      }
    } catch {
      // Legacy plain number
      const n = parseInt(stored, 10);
      return { index: isNaN(n) ? null : n, count: null };
    }
    return { index: null, count: null };
  };

  // Compute the effective index to display given current variants length and saved selection/count
  const computeEffectiveVariantIndex = (messageId: number, variantsLength: number): number => {
    const saved = loadVariantSelection(messageId);
    const savedIndex = saved.index;
    const savedCount = saved.count;
    const latestIndex = variantsLength; // 0=original, 1..N variants; latest is N
    if (variantsLength <= 0) return 0;
    if (savedIndex === null) return latestIndex;
    if (savedIndex < 0) return 0;
    if (savedIndex > latestIndex) return latestIndex;
    if (savedCount !== null && latestIndex !== savedCount) return latestIndex; // original counts as a variant
    return savedIndex;
  };

  // Navigate between variants
  const navigateVariant = (messageId: number, direction: 'prev' | 'next') => {
    const variants = messageVariants.get(messageId) || [];
    const totalOptions = variants.length + 1; // +1 for original message
    
    // Guard against empty state
    if (totalOptions <= 1) return;
    
    const currentIndex = currentVariantIndex.get(messageId) || 0;
    let newIndex = currentIndex;
    
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : totalOptions - 1;
    } else {
      newIndex = currentIndex < totalOptions - 1 ? currentIndex + 1 : 0;
    }
    
    // Ensure the new index is valid
    newIndex = Math.max(0, Math.min(newIndex, totalOptions - 1));
    
    setCurrentVariantIndex(prev => {
      const newMap = new Map(prev);
      newMap.set(messageId, newIndex);
      return newMap;
    });
    
    // Save selection to localStorage
    saveVariantSelection(messageId, newIndex);
    
    // Update display content
    if (newIndex === 0) {
      // For original, remove any stale variant mapping so base message content is shown
      setVariantDisplayContent(prev => {
        const newMap = new Map(prev);
        newMap.delete(messageId);
        return newMap;
      });
    } else {
      // Show variant content
      const selectedVariant = variants[newIndex - 1];
      if (selectedVariant) {
        setVariantDisplayContent(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, selectedVariant.content);
          return newMap;
        });
      }
    }
    
    // Scroll to show the updated content after a brief delay (but not during edit mode)
    setTimeout(() => {
      if (editingMessageIndex === null) {
        scrollToBottom(false);
      }
    }, 50);
  };

  // Load variants for assistant messages
  const loadVariants = async (messageId: number) => {
    try {
      const response = await fetch(`/api/messages/${messageId}/variants`);
      if (response.ok) {
        const variants = await response.json();
        if (variants.length > 0) {
          setMessageVariants(prev => {
            const newMap = new Map(prev);
            newMap.set(messageId, variants);
            return newMap;
          });
          
          // Resolve selection: if no saved selection, or if user was on a variant and total count changed, pick the latest variant
          const saved = loadVariantSelection(messageId);
          const savedIndex = saved.index;
          const savedCount = saved.count;
          const latestIndex = variants.length; // 0 = original, 1..N = variants; latest is N
          let selectedIndex = 0; // default to original when no variants
          if (variants.length > 0) {
            if (savedIndex === null) {
              // No previous selection -> choose latest
              selectedIndex = latestIndex;
            } else if (savedIndex < 0) {
              selectedIndex = 0;
            } else if (savedIndex > latestIndex) {
              // Saved index beyond current range -> clamp to latest
              selectedIndex = latestIndex;
            } else if (savedCount !== null && latestIndex !== savedCount) {
              // Total variant count changed in any way -> bump to latest (original counts as a variant)
              selectedIndex = latestIndex;
            } else {
              // Exactly matches latest -> keep it
              selectedIndex = savedIndex;
            }
          }
          // Persist if we auto-bumped due to count change or had no previous selection
          if (savedIndex === null || (savedCount !== null && latestIndex !== savedCount)) {
            saveVariantSelection(messageId, selectedIndex);
          }
          
          setCurrentVariantIndex(prev => {
            const newMap = new Map(prev);
            newMap.set(messageId, selectedIndex);
            return newMap;
          });
          
          // Set display content based on selected index
          if (selectedIndex === 0) {
            // Original selected: ensure no stale mapping so base message content renders
            setVariantDisplayContent(prev => {
              const newMap = new Map(prev);
              newMap.delete(messageId);
              return newMap;
            });
          } else {
            // Show selected variant content
            const displayVariant = variants[selectedIndex - 1];
            if (displayVariant) {
              setVariantDisplayContent(prev => {
                const newMap = new Map(prev);
                newMap.set(messageId, displayVariant.content);
                return newMap;
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load variants:', error);
    }
  };

  const lastProcessedMessagesRef = useRef<ChatMessage[]>([]);
  const variantLoadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fail-safe: On initial page load, ensure we bump the latest assistant message to latest if count changed
  useEffect(() => {
    if (isStreaming || generatingVariant !== null) return;
    if (!messages.length) return;
    const doneSet = initialVariantBumpDoneRef.current;
    const resolvedSet = initialVariantResolvedRef.current;
    const assistants = messages.filter(m => m.role === 'assistant' && m.messageId);
    const lastAssistant = assistants.length ? assistants[assistants.length - 1] : null;
    const messageId = lastAssistant?.messageId!;
    if (!messageId) return;
    if (doneSet.has(messageId)) return;
    const variants = messageVariants.get(messageId);
    // If we don't yet have variants loaded, kick off a load and try again on next state change
    if (!variants) {
      // Proactively fetch variants for this message
      loadVariants(messageId);
      return; // do not mark as done yet
    }
    if (variants.length === 0) {
      // Variants loaded but empty; nothing to bump, mark as resolved
      resolvedSet.add(messageId);
  // Initial hydration complete even without variants
  initialHydrationDoneRef.current = true;
      return;
    }
    const latestIndex = variants.length;
    const effectiveIndex = computeEffectiveVariantIndex(messageId, latestIndex);
    setCurrentVariantIndex(prev => {
      const newMap = new Map(prev);
      newMap.set(messageId, effectiveIndex);
      return newMap;
    });
    if (effectiveIndex > 0 && effectiveIndex <= variants.length) {
      const displayVariant = variants[effectiveIndex - 1];
      if (displayVariant) {
        setVariantDisplayContent(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, displayVariant.content);
          return newMap;
        });
      }
    } else {
      setVariantDisplayContent(prev => {
        const newMap = new Map(prev);
        newMap.delete(messageId);
        return newMap;
      });
    }
    // Persist if effective differs from saved or no saved selection
    const saved = loadVariantSelection(messageId);
    if (saved.index === null || saved.index !== effectiveIndex) {
      saveVariantSelection(messageId, effectiveIndex);
    }
    doneSet.add(messageId);
    // Small delay before marking as resolved to ensure content updates are complete
    setTimeout(() => {
      resolvedSet.add(messageId);
  // Mark initial hydration done after first resolution completes
  initialHydrationDoneRef.current = true;
    }, 50);
  }, [messages, messageVariants, isStreaming, generatingVariant]);
  
  // Load persisted messages (but not during streaming or right after streaming)
  useEffect(() => {
    if (!session || isStreaming || justFinishedStreaming || generatingVariant !== null) return;
    // Capture hasMore and oldest cursor from current page
    if (typeof session.hasMore !== 'undefined') setHasMore(!!session.hasMore);
    if (session.messages && session.messages.length > 0) {
      const firstId = session.messages[0]!.id;
      const cur = oldestMessageIdRef.current;
      oldestMessageIdRef.current = cur == null ? firstId : Math.min(cur, firstId);
    }
    
    // Skip this update if we're explicitly told to (e.g., right after streaming)
    if (skipNextMessageUpdate) {
      setSkipNextMessageUpdate(false);
      return;
    }
    
    const allMessages = session.messages.map(m => ({ 
      role: m.role as 'user' | 'assistant', 
      content: m.content, 
      messageId: m.id 
    }));
    
    // Filter out continue system messages and combine responses visually
    const processedMessages: ChatMessage[] = [];
    const CONTINUE_MESSAGE = '[SYSTEM NOTE: Ignore this message, reply as if you are extending the last message you sent as if your reply never ended - do not make an effort to send a message on behalf of the user unless the most recent message from you did include speaking on behalf of the user. Specifically do not start messages with `{{user}}: `, you should NEVER use that format in any message.]';
    
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      if (!msg) continue;
      
      // If this is a continue system message, skip it
      if (msg.role === 'user' && msg.content === CONTINUE_MESSAGE) {
        continue;
      }
      
      // If this is an assistant message that follows a continue system message
      if (msg.role === 'assistant' && i > 0) {
        const prevMsg = allMessages[i - 1];
        if (prevMsg && prevMsg.role === 'user' && prevMsg.content === CONTINUE_MESSAGE) {
          // Find the previous assistant message and combine them visually
          const lastAssistantIndex = processedMessages.findLastIndex(m => m.role === 'assistant');
          if (lastAssistantIndex !== -1) {
            const prevAssistant = processedMessages[lastAssistantIndex];
            if (prevAssistant) {
              processedMessages[lastAssistantIndex] = {
                role: 'assistant',
                content: prevAssistant.content + '\n\n' + msg.content,
                messageId: prevAssistant.messageId
              };
              continue;
            }
          }
        }
      }
      
      // Add normal messages
      processedMessages.push(msg as ChatMessage);
    }
    
    // Compare with last processed messages to avoid unnecessary updates
    const lastProcessed = lastProcessedMessagesRef.current;
    const hasChanges = processedMessages.length !== lastProcessed.length ||
      processedMessages.some((msg, index) => {
        const lastMsg = lastProcessed[index];
        return !lastMsg || 
               lastMsg.role !== msg.role || 
               lastMsg.content !== msg.content || 
               lastMsg.messageId !== msg.messageId;
      });
    
    if (hasChanges) {
      lastProcessedMessagesRef.current = processedMessages;
      // Merge the latest page into existing messages if we've already prepended older ones
      setMessages(prev => {
        // If prev is empty or shorter, just take processed
        if (prev.length === 0 || prev.length <= processedMessages.length) {
          // Basic dedupe for safety when replacing
          const seen = new Set<number>();
          const out: ChatMessage[] = [];
          for (const m of processedMessages) {
            const id = m.messageId;
            if (id != null) {
              if (seen.has(id)) continue;
              seen.add(id);
            }
            out.push(m);
          }
          return out;
        }
        // Try to align the page as a suffix of prev by messageId (fallback to content when no id)
        const firstPageId = processedMessages[0]?.messageId;
        let startIdx = -1;
        if (firstPageId != null) {
          startIdx = prev.findIndex(p => p.messageId === firstPageId);
        }
        if (startIdx === -1) {
          // Fallback: try to match by role+content sequence
          const window = prev.length - processedMessages.length;
          if (window >= 0) {
            let matches = true;
            for (let i = 0; i < processedMessages.length; i++) {
              const a = prev[window + i];
              const b = processedMessages[i];
              if (!a || !b || a.role !== b.role || a.content !== b.content) { matches = false; break; }
            }
            if (matches) {
              // Keep the older head and replace the tail window with processed
              return [...prev.slice(0, window), ...processedMessages];
            }
          }
          // If we can't align, prefer processed to avoid duplication
          // Deduplicate fallback
          const seen = new Set<number>();
          const out: ChatMessage[] = [];
          for (const m of processedMessages) {
            const id = m.messageId;
            if (id != null) {
              if (seen.has(id)) continue;
              seen.add(id);
            }
            out.push(m);
          }
          return out;
        }
        // Ensure the page fits entirely starting at startIdx
        if (startIdx + processedMessages.length <= prev.length) {
          // Verify sequence alignment by id when present
          let ok = true;
          for (let i = 0; i < processedMessages.length; i++) {
            const a = prev[startIdx + i];
            const b = processedMessages[i];
            if (!a || !b) { ok = false; break; }
            if (b.messageId != null && a.messageId != null) {
              if (a.messageId !== b.messageId) { ok = false; break; }
            } else if (a.role !== b.role || a.content !== b.content) {
              ok = false; break;
            }
          }
          if (ok) {
            const head = prev.slice(0, startIdx);
            return [...head, ...processedMessages];
          }
        }
        // Fallback to processed with dedupe
        const seen = new Set<number>();
        const out: ChatMessage[] = [];
        for (const m of processedMessages) {
          const id = m.messageId;
          if (id != null) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          out.push(m);
        }
        return out;
      });
    }
    
    // Only load variants for the latest assistant message
    const lastAssistantMsg = (() => {
      for (let i = processedMessages.length - 1; i >= 0; i--) {
        const m = processedMessages[i];
        if (m && m.role === 'assistant' && m.messageId) return m;
      }
      return null;
    })();
    const lastAssistantId = lastAssistantMsg?.messageId;
    if (lastAssistantId && !messageVariants.has(lastAssistantId)) {
      loadVariants(lastAssistantId);
    }

    // Prune variants for any non-latest messages to enforce: only most recent can have variants
    if (lastAssistantId) {
      // Remove stale variant state for other messages
      setMessageVariants(prev => {
        let changed = false;
        const keep = new Map<number, MessageVersion[]>();
        prev.forEach((val, key) => {
          if (key === lastAssistantId) {
            keep.set(key, val);
          } else {
            changed = true;
          }
        });
        return changed ? keep : prev;
      });
      setCurrentVariantIndex(prev => {
        let changed = false;
        const keep = new Map<number, number>();
        prev.forEach((val, key) => {
          if (key === lastAssistantId) {
            keep.set(key, val);
          } else {
            changed = true;
          }
        });
        return changed ? keep : prev;
      });
      setVariantDisplayContent(prev => {
        let changed = false;
        const keep = new Map<number, string>();
        prev.forEach((val, key) => {
          if (key === lastAssistantId) {
            keep.set(key, val);
          } else {
            changed = true;
          }
        });
        return changed ? keep : prev;
      });
      // Also clear any stored selections for older messages
      try {
        const keys: number[] = [];
        messageVariants.forEach((_v, k) => { if (k !== lastAssistantId) keys.push(k); });
        keys.forEach(k => {
          if (id) {
            const key = getVariantStorageKey(id, k);
            localStorage.removeItem(key);
          }
        });
      } catch {}
    }
    
    // Mark assistant messages without variants as resolved immediately
    const resolvedSet = initialVariantResolvedRef.current;
    processedMessages.forEach(m => {
      if (m.role === 'assistant' && m.messageId && !messageVariants.has(m.messageId)) {
        resolvedSet.add(m.messageId);
      }
    });
    
  }, [session, isStreaming, justFinishedStreaming, generatingVariant, skipNextMessageUpdate]);
  // Load devMode from database
  useEffect(() => {
    const loadDevMode = async () => {
      try {
        const settingsRes = await fetch('/api/settings');
        const settings = await settingsRes.json();
        const dm = settings.devMode === 'true';
        setDevMode(dm);
      } catch (error) {
        console.error('Failed to load devMode from settings:', error);
        setDevMode(false);
      }
    };
    loadDevMode();
  }, []);

  // Load session data when id changes
  useEffect(() => {
    // Skip this update if we're streaming, just finished streaming, or generating variants
    if (isStreaming || justFinishedStreaming || generatingVariant !== null) {
      console.log('Skipping session update due to streaming state');
      return;
    }
    
    // Skip this update if we're explicitly told to (e.g., right after streaming)
    if (skipNextMessageUpdate) {
      console.log('Skipping session update due to skipNextMessageUpdate flag');
      setSkipNextMessageUpdate(false);
      return;
    }
    
    console.log('Session useEffect triggered, editingMessageIndex:', editingMessageIndex);
    if (session?.messages) {
      // Only update messages if we're not currently editing a message
      // This prevents overriding local edits when session refreshes
      if (editingMessageIndex === null) {
        console.log('Updating messages from session data');
        setMessages(session.messages.map(m => ({ 
          role: m.role as 'user' | 'assistant', 
          content: m.content,
          messageId: m.id
        })));
      } else {
        console.log('Skipping message update due to active editing');
      }
      
      // Load variants only for the last assistant message from server data - but only if not in streaming state or editing
      if (!isStreaming && !justFinishedStreaming && generatingVariant === null && editingMessageIndex === null) {
        const lastAssistant = (() => {
          for (let i = session.messages.length - 1; i >= 0; i--) {
            const msg = session.messages[i];
            if (msg && msg.role === 'assistant') return msg;
          }
          return null;
        })();
        if (lastAssistant && Array.isArray(lastAssistant.versions) && lastAssistant.versions.length > 0) {
          const msg = lastAssistant;
          const variants = (msg.versions || []).filter(v => !v.isActive);
          if (variants.length > 0) {
            console.log('Loading variants for latest assistant message', msg.id, 'variants:', variants.length);

            setMessageVariants(prev => {
              const newMap = new Map<number, MessageVersion[]>();
              newMap.set(msg.id, variants);
              return newMap;
            });

            // Mark this message as resolved since we're processing its variants
            const resolvedSet = initialVariantResolvedRef.current;
            setTimeout(() => {
              resolvedSet.add(msg.id);
              // Completing initial resolution marks hydration done
              initialHydrationDoneRef.current = true;
            }, 50);

            // Initialize current variant index - check localStorage first
            setCurrentVariantIndex(prev => {
              const newMap = new Map<number, number>();
              const saved = loadVariantSelection(msg.id);
              const savedIndex = saved.index;
              const savedCount = saved.count;
              const latestIndex = variants.length; // 0 = original, 1..N = variants; latest is N
              let selectedIndex = 0;
              if (latestIndex > 0) {
                if (savedIndex === null) selectedIndex = latestIndex; else if (savedIndex < 0) selectedIndex = 0; else if (savedIndex > latestIndex) selectedIndex = latestIndex; else if (savedCount !== null && latestIndex !== savedCount) selectedIndex = latestIndex; else selectedIndex = savedIndex;
              } else {
                selectedIndex = 0;
              }
              newMap.set(msg.id, selectedIndex);
              if (savedIndex === null || (savedCount !== null && latestIndex !== savedCount)) saveVariantSelection(msg.id, selectedIndex);
              return newMap;
            });

            // Initialize variant display content based on the current index
            setVariantDisplayContent(prev => {
              const newMap = new Map<number, string>();
              const curSaved = loadVariantSelection(msg.id);
              const savedIndex = curSaved.index;
              const savedCount = curSaved.count;
              const latestIndex = variants.length;
              let displayIndex = 0;
              if (latestIndex > 0) {
                if (savedIndex === null) displayIndex = latestIndex; else if (savedIndex < 0) displayIndex = 0; else if (savedIndex > latestIndex) displayIndex = latestIndex; else if (savedCount !== null && latestIndex !== savedCount) displayIndex = latestIndex; else displayIndex = savedIndex;
              }
              if (displayIndex > 0 && displayIndex <= variants.length) {
                const selectedVariant = variants[displayIndex - 1];
                if (selectedVariant) newMap.set(msg.id, selectedVariant.content);
              } else {
                newMap.delete(msg.id);
              }
              return newMap;
            });
          }
        } else {
          // No variants on latest assistant -> clear any stale maps
          setMessageVariants(prev => (prev.size ? new Map() : prev));
          setCurrentVariantIndex(prev => (prev.size ? new Map() : prev));
          setVariantDisplayContent(prev => (prev.size ? new Map() : prev));
          // With no variants, consider hydration complete
          initialHydrationDoneRef.current = true;
        }
      }
    }
    
    if (session?.summary) {
      setSummaryContent(session.summary);
    }
  }, [session, editingMessageIndex, isStreaming, justFinishedStreaming, generatingVariant, skipNextMessageUpdate]);

  // Add body class for chat page styling
  useEffect(() => {
    document.body.classList.add('chat-page-active');
    return () => {
      document.body.classList.remove('chat-page-active');
    };
  }, []);

  // Detect screen width for responsive modal behavior
  useEffect(() => {
    const checkScreenWidth = () => {
      setIsWideScreen(window.innerWidth >= 1500);
  setIsNarrowScreen(window.innerWidth < 800);
    };
    
    // Check initially
    checkScreenWidth();
    
    // Add event listener for window resize
    window.addEventListener('resize', checkScreenWidth);
    
    // Cleanup
    return () => window.removeEventListener('resize', checkScreenWidth);
  }, []);

  // Track header height for dynamic chat container positioning
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        // Force a reflow to ensure we get accurate measurements
        void headerRef.current.offsetHeight;
        
        const height = headerRef.current.offsetHeight;
        // Add the mb-8 gap (32px) that provides natural spacing between header and chat container
        // Use consistent height calculation that matches the post-interaction position
        const adjustedHeight = height + 32;
        setHeaderHeight(adjustedHeight);
        // Set CSS custom property for use in sidecar modal
        document.documentElement.style.setProperty('--dynamic-header-height', `${adjustedHeight}px`);
      }
    };

    // Update immediately on mount
    updateHeaderHeight();
    
    // Use requestAnimationFrame to ensure DOM is fully rendered
    const rafId = requestAnimationFrame(() => {
      updateHeaderHeight();
      // Additional update after a brief delay to catch any delayed renders
      setTimeout(updateHeaderHeight, 50);
    });
    
    // Update on window resize
    window.addEventListener('resize', updateHeaderHeight);
    
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateHeaderHeight);
      // Clean up CSS custom property
      document.documentElement.style.removeProperty('--dynamic-header-height');
    };
  }, [isBurgerMenuOpen]);

  // Additional effect to recalculate height after session data loads
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      if (headerRef.current) {
        // Force a reflow to ensure we get accurate measurements
        void headerRef.current.offsetHeight;
        
        const height = headerRef.current.offsetHeight;
        const adjustedHeight = height + 32;
        setHeaderHeight(adjustedHeight);
        document.documentElement.style.setProperty('--dynamic-header-height', `${adjustedHeight}px`);
      }
    };

    // Update after session loads to ensure proper calculation with all content rendered
    // Skip recalculation while the user is editing a message to avoid scroll jumps
    if (session && editingMessageIndex === null) {
      updateHeaderHeight();
      
      // Additional updates to catch any delayed content rendering
      const timeouts = [
        setTimeout(updateHeaderHeight, 0),
        setTimeout(updateHeaderHeight, 100),
        setTimeout(updateHeaderHeight, 200)
      ];
      
      return () => {
        timeouts.forEach(clearTimeout);
      };
    }
  }, [session, editingMessageIndex]);

  // Close burger menu on outside click
  useClickOutside(isBurgerMenuOpen, () => setIsBurgerMenuOpen(false), {
    containerRef: headerRef,
    eventType: 'mousedown',
    escapeToClose: false,
  });

  // Consolidated Escape key handler for burger menu + all modals
  useEffect(() => {
    const anyOpen = isBurgerMenuOpen || showNotesModal || showSummaryModal || showDeleteModal || showErrorModal;
    if (!anyOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Priority: burger menu first
      if (isBurgerMenuOpen) { setIsBurgerMenuOpen(false); return; }
      // Only close notes overlay on narrow screens (sidecar stays open)
      if (showNotesModal && !isWideScreen) { setShowNotesModal(false); return; }
      if (showSummaryModal) { setShowSummaryModal(false); return; }
      if (showErrorModal) { setShowErrorModal(false); return; }
      if (showDeleteModal) { setShowDeleteModal(false); setDeleteMessageIndex(null); return; }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isBurgerMenuOpen, showNotesModal, showSummaryModal, showDeleteModal, showErrorModal, isWideScreen]);

  // Auto-resize textarea function
  const autoResizeTextarea = useCallback(() => {
    if (!textareaRef.current) return;
    
    const textarea = textareaRef.current;
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
  // Set height to scrollHeight, constrained by min/max (min 80px, max 240px)
  const newHeight = Math.max(80, Math.min(textarea.scrollHeight, 240));
  textarea.style.height = `${newHeight}px`;
  }, []);

  // Commit any displayed variants before sending
  const commitVariantsBeforeSend = async () => {
    if (!session) return;
    const assistantMessages = session.messages.filter(m => m.role === 'assistant');
    // First commit the currently displayed variant (if any) for each assistant message
    for (const msg of assistantMessages) {
      if (messageVariants.has(msg.id)) {
        await commitDisplayedVariant(msg.id);
      }
    }
    // Then cleanup variants so the user cannot switch after sending a new message
    for (const msg of assistantMessages) {
      if (messageVariants.has(msg.id)) {
        await cleanupVariants(msg.id);
      }
    }
  };

  // Clean up variants for all assistant messages after committing
  const cleanupVariantsAfterCommit = async () => {
    if (!session) return;
    const assistantMessages = session.messages.filter(m => m.role === 'assistant');
    for (const msg of assistantMessages) {
      if (messageVariants.has(msg.id)) {
        await cleanupVariants(msg.id);
      }
    }
  };

  // Auto-resize edit textarea function
  const autoResizeEditTextarea = useCallback(() => {
    if (!editTextareaRef.current) return;
    
    const textarea = editTextareaRef.current;
    const container = containerRef.current;
    
    // Save current scroll position to prevent jumping
    const currentScrollTop = container ? container.scrollTop : 0;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
  // Dynamic sizing: min matches CSS (100px); max is 65% of viewport or 500px whichever is smaller, but at least 400px
  const viewportMax = typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.65) : 500;
  const dynamicMax = Math.max(400, Math.min(500, viewportMax));
  const minH = 100;
  const newHeight = Math.max(minH, Math.min(textarea.scrollHeight, dynamicMax));
  textarea.style.maxHeight = dynamicMax + 'px';
  textarea.style.height = `${newHeight}px`;
    
    // Restore scroll position to prevent the textarea from jumping around
    if (container) {
      container.scrollTop = currentScrollTop;
    }
  }, []);

  // Start editing a message
  const startEditingMessage = (index: number) => {
    if (loading || isStreaming || !messages[index]) return; // Don't allow editing during loading
    
    const message = messages[index];
    const messageId = message.messageId;
    
    // For assistant messages with variants, edit the currently displayed content
    let contentToEdit = message.content;
    if (messageId && variantDisplayContent.has(messageId)) {
      contentToEdit = variantDisplayContent.get(messageId)!;
    }
    
    // Preserve current scroll position
    const container = containerRef.current;
    const currentScrollTop = container ? container.scrollTop : 0;
    
    // Pre-calculate the height needed for the content to prevent visual jump
    const calculateTextareaHeight = (text: string) => {
      // Create a temporary textarea to measure the required height
      const tempTextarea = document.createElement('textarea');
      tempTextarea.style.position = 'absolute';
      tempTextarea.style.visibility = 'hidden';
      tempTextarea.style.width = '100%';
      tempTextarea.style.padding = '12px'; // Same as CSS --space-3
      tempTextarea.style.fontSize = '16px'; // Same as CSS --font-size-base
      tempTextarea.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
      tempTextarea.style.lineHeight = '1.5';
      tempTextarea.style.border = '1px solid transparent';
      tempTextarea.style.boxSizing = 'border-box';
      tempTextarea.style.resize = 'none';
      tempTextarea.value = text;
      
      document.body.appendChild(tempTextarea);
  const viewportMax = typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.65) : 500;
  const dynamicMax = Math.max(400, Math.min(500, viewportMax));
  const height = Math.max(100, Math.min(tempTextarea.scrollHeight, dynamicMax));
      document.body.removeChild(tempTextarea);
      
      return height;
    };
    
    const preCalculatedHeight = calculateTextareaHeight(contentToEdit);
    
    setEditingMessageIndex(index);
    setEditingContent(contentToEdit);
    
    // Set the height immediately when the textarea becomes available
    setTimeout(() => {
      if (editTextareaRef.current) {
        // Set the calculated height before it becomes visible to prevent jump
        editTextareaRef.current.style.height = `${preCalculatedHeight}px`;
        
        // Restore scroll position before focusing to prevent auto-scroll
        if (container) {
          container.scrollTop = currentScrollTop;
        }
        
        editTextareaRef.current.focus();
        
        // Restore scroll position again after focus
        setTimeout(() => {
          if (container) {
            container.scrollTop = currentScrollTop;
          }
        }, 10);
      }
    }, 10); // Much shorter delay since we pre-calculated the height
  };

  // Save edited message
  const saveEditedMessage = async () => {
    if (editingMessageIndex === null || !session) return;
    
    const messageToEdit = messages[editingMessageIndex];
    if (!messageToEdit) return;
    
    const trimmedContent = editingContent.trim();
    if (!trimmedContent) {
      // Don't allow empty messages
      return;
    }

    const messageId = messageToEdit.messageId;
    const isAssistantMessage = messageToEdit.role === 'assistant';
    
    // Preserve scroll position before editing
    const container = containerRef.current;
    const savedScrollTop = container ? container.scrollTop : 0;
    
    // Skip all scrolling during and after editing
    skipNextScroll.current = true;
    
    // Also prevent scrolling after state updates
    const preventScrollForDuration = () => {
      skipNextScroll.current = true;
      setTimeout(() => {
        skipNextScroll.current = true;
      }, 100);
      setTimeout(() => {
        skipNextScroll.current = true;
      }, 200);
      setTimeout(() => {
        skipNextScroll.current = true;
      }, 500);
    };
    
    preventScrollForDuration();
    
    // Check if we're editing a variant vs the original message
    const currentIndex = messageId ? currentVariantIndex.get(messageId) : undefined;
    const isEditingVariant = isAssistantMessage && messageId && currentIndex !== undefined && currentIndex > 0;
    
    if (isEditingVariant) {
      // We're editing a variant - update the specific variant
      const variants = messageVariants.get(messageId!) || [];
      const variantToEdit = variants[currentIndex - 1]; // -1 because index 0 is original message
      
      if (variantToEdit) {
        try {
          // Update the variant in the database
          const response = await fetch(`/api/messages/${messageId}/variants`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              variantId: variantToEdit.id,
              content: trimmedContent 
            })
          });
          
          if (!response.ok) {
            throw new Error('Failed to save variant');
          }
          
          // Update the variant in local state
          setMessageVariants(prev => {
            const newMap = new Map(prev);
            const existingVariants = newMap.get(messageId!) || [];
            const updatedVariants = [...existingVariants];
            updatedVariants[currentIndex - 1] = { ...variantToEdit, content: trimmedContent };
            newMap.set(messageId!, updatedVariants);
            return newMap;
          });
          
          // Update the variant display content
          setVariantDisplayContent(prev => {
            const newMap = new Map(prev);
            newMap.set(messageId!, trimmedContent);
            return newMap;
          });
          
          // Refresh variants from server to ensure consistency
          // This ensures that when we navigate between variants, we have the latest content
          setTimeout(async () => {
            try {
              const variantsResponse = await fetch(`/api/messages/${messageId}/variants`);
              if (variantsResponse.ok) {
                const refreshedVariants = await variantsResponse.json();
                setMessageVariants(prev => {
                  const newMap = new Map(prev);
                  newMap.set(messageId!, refreshedVariants);
                  return newMap;
                });
              }
            } catch (refreshError) {
              console.error('Failed to refresh variants after edit:', refreshError);
            }
          }, 100);
          
          console.log('Variant edit saved successfully');
          
        } catch (error) {
          console.error('Failed to save edited variant:', error);
          alert('Failed to save variant changes. Please try again.');
          return;
        }
      }
    } else {
      // We're editing the original message - use existing logic
      
      // Update local state immediately
      const updatedMessages = [...messages];
      updatedMessages[editingMessageIndex] = { ...messageToEdit, content: trimmedContent };
      setMessages(updatedMessages);
      
      // For assistant messages with variants, update the variant display content if we're showing original
      if (isAssistantMessage && messageId && variantDisplayContent.has(messageId) && currentIndex === 0) {
        // For original keep no mapping to avoid stale overrides on refresh
        setVariantDisplayContent(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
      }
      
      // Update in database
      try {
        if (messageId) {
          // Use the dedicated message edit API for individual message updates
          const response = await fetch(`/api/messages/${messageId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: trimmedContent })
          });
          
          if (!response.ok) {
            throw new Error('Failed to save message');
          }
          
          console.log('Message edit saved successfully, preserving local state and variants');
          
          // Refresh session data to ensure UI is in sync with server, while preserving variants
          // Mark this original as recently edited so we skip restoring any stale variantDisplayContent snapshot
          if (messageId && messageToEdit.role === 'assistant') {
            recentlyEditedOriginalRef.current.add(messageId);
            // If we are on original (index 0) and there is a variant display mapping, align it explicitly
            const idx = currentVariantIndex.get(messageId);
            if (idx === 0) {
              setVariantDisplayContent(prev => {
                const map = new Map(prev);
                // Remove mapping for original so base message content is authoritative
                map.delete(messageId);
                return map;
              });
            }
          }
          await mutateWithVariantPreservation();
        } else {
          // Fallback to updating the entire session if messageId is not available
          const response = await fetch(`/api/sessions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: updatedMessages })
          });
          
          if (!response.ok) {
            throw new Error('Failed to save message');
          }
          
          console.log('Message edit saved via session update, preserving local state');
          
          // Refresh session data to ensure UI is in sync with server, while preserving variants  
          await mutateWithVariantPreservation();
        }
      } catch (error) {
        console.error('Failed to save edited message:', error);
        // Skip scrolling when reverting changes
        skipNextScroll.current = true;
        // Revert the local changes if API call failed
        const revertedMessages = [...messages];
        revertedMessages[editingMessageIndex] = messageToEdit; // Revert to original
        setMessages(revertedMessages);
        
        // Revert variant display content if it was updated
        if (isAssistantMessage && messageId && variantDisplayContent.has(messageId)) {
          setVariantDisplayContent(prev => {
            const newMap = new Map(prev);
            // Restore the previous content (we need to get it from the original message or variant)
            const originalContent = messageToEdit.content;
            newMap.set(messageId, originalContent);
            return newMap;
          });
        }
        
        // Show error to user (you could use a toast notification here)
        alert('Failed to save changes. Please try again.');
        return;
      }
    }
    
    // Prevent scrolling after editing completes
    preventScrollForDuration();
    
    setEditingMessageIndex(null);
    setEditingContent('');
    
    // Restore scroll position after editing completes
    setTimeout(() => {
      if (containerRef.current && savedScrollTop !== undefined) {
        containerRef.current.scrollTop = savedScrollTop;
      }
    }, 50);
  };

  // Cancel editing
  const cancelEditingMessage = () => {
    // Preserve scroll position when canceling edit
    const container = containerRef.current;
    const savedScrollTop = container ? container.scrollTop : 0;
    
    setEditingMessageIndex(null);
    setEditingContent('');
    
    // Restore scroll position after canceling
    setTimeout(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = savedScrollTop;
      }
    }, 10);
  };

  // Continue the conversation - prompt AI to continue without user input
  const continueConversation = async () => {
    if (loading || isStreaming || !session) return;
    
    // Commit any displayed variants before continuing
    const assistantMessages = session.messages.filter(m => m.role === 'assistant');
    for (const msg of assistantMessages) {
      if (messageVariants.has(msg.id)) {
        await commitDisplayedVariant(msg.id);
      }
    }
    for (const msg of assistantMessages) {
      if (messageVariants.has(msg.id)) {
        await cleanupVariants(msg.id);
      }
    }
    
    setLoading(true);
    setIsStreaming(true);
    let originalContent = '';
    setMessages(prev => {
      const lastIdx = prev.findLastIndex(m => m.role === 'assistant');
      if (lastIdx !== -1 && prev[lastIdx]) {
        originalContent = prev[lastIdx]!.content;
        return prev;
      }
      return [...prev, { role: 'assistant', content: '' }];
    });
    streamingMessageRef.current = '';

    const result = await performStreamingRequest({
      url: '/api/chat',
      body: {
        sessionId: Number(id),
        userMessage: '[SYSTEM NOTE: Ignore this message, reply as if you are extending the last message you sent as if your reply never ended - do not make an effort to send a message on behalf of the user unless the most recent message from you did include speaking on behalf of the user. Specifically do not start messages with `{{user}}: `, you should NEVER use that format in any message.]',
      },
      abortControllerRef: streamingAbortController,
      onStreamChunk: (accumulated) => {
        streamingMessageRef.current = accumulated;
        setMessages(prev => {
          const copy = [...prev];
          const lastIdx = copy.findLastIndex(m => m.role === 'assistant');
          if (lastIdx !== -1 && copy[lastIdx]) {
            copy[lastIdx]!.content = accumulated ? originalContent + '\n\n' + accumulated : originalContent;
          }
          return copy;
        });
        maybeStartStreamingFollow();
      },
      onNonStreamResult: (data) => {
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          setMessages(prev => {
            const lastIdx = prev.findLastIndex(m => m.role === 'assistant');
            if (lastIdx !== -1 && prev[lastIdx]) {
              const updated = [...prev];
              updated[lastIdx] = { role: 'assistant', content: prev[lastIdx]!.content + '\n\n' + content };
              return updated;
            }
            return [...prev, { role: 'assistant', content }];
          });
        } else if (data?.error) {
          setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(data.error))));
          setShowErrorModal(true);
        }
      },
      onError: (msg) => { setApiErrorMessage(msg); setShowErrorModal(true); },
      onAbort: () => {
        setLoading(false);
        setIsStreaming(false);
        setJustFinishedStreaming(true);
        streamingMessageRef.current = '';
        stopStreamingFollow();
      },
    });

    if (result.wasAborted) return; // onAbort already cleaned up

    stopStreamingFollow();
    setLoading(false);
    setIsStreaming(false);
    setJustFinishedStreaming(true);
    setSkipNextMessageUpdate(true);
    streamingMessageRef.current = '';
    
    setTimeout(() => { if (editingMessageIndex === null) scrollToBottom(false); }, 100);
    setTimeout(async () => {
      skipNextScroll.current = true;
      await mutateWithVariantPreservation();
      setJustFinishedStreaming(false);
    }, 500);
  };

  // Build a helpful note for the error modal with request size and recommended max characters
  const buildRequestSizeNote = async (): Promise<string> => {
    try {
      const sessionIdNum = Number(id);
      if (!sessionIdNum || Number.isNaN(sessionIdNum)) return '';
      const resp = await fetch(`/api/chat/request-log/${sessionIdNum}`);
      if (!resp.ok) return '';
      const payload = await resp.json();
      const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
      const totalChars = msgs.reduce((sum: number, m: any) => sum + (m?.content ? String(m.content).length : 0), 0);
      if (!Number.isFinite(totalChars) || totalChars <= 0) return '';
      const roundedUp = Math.ceil(totalChars / 10000) * 10000;
      const recommended = Math.min(320000, roundedUp * 5);
      return `Request size: ${totalChars.toLocaleString()} characters.\nRecommendation: set Max Characters to ${recommended.toLocaleString()} and try again.`;
    } catch {
      return '';
    }
  };

  // Delete message and all subsequent messages
  const deleteMessage = async (index: number) => {
    if (loading || isStreaming || !session) return;
    
    // Show custom delete confirmation modal
    setDeleteMessageIndex(index);
    setShowDeleteModal(true);
  };
  
  // Confirm and execute the message deletion
  const confirmDeleteMessage = async () => {
    if (deleteMessageIndex === null || loading || isStreaming || !session) return;
    
    const index = deleteMessageIndex;
    const target = messages[index];
    const msgId = target?.messageId;
    // Close modal and reset state
    setShowDeleteModal(false);
    setDeleteMessageIndex(null);

    // If we don't have an id, revalidate to avoid corrupting state
    if (!msgId) {
      await mutateWithVariantPreservation();
      return;
    }

    // Optimistic UI: remove from index onward
    const prevMessages = messages;
    const updatedMessages = messages.slice(0, index);
    setMessages(updatedMessages);

    try {
      // Server-side truncate from this message onward
      const response = await fetch(`/api/messages/${msgId}?truncate=1`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete messages');
      await mutateWithVariantPreservation();
    } catch (error) {
      console.error('Failed to delete messages:', error);
      setMessages(prevMessages);
      alert('Failed to delete messages. Please try again.');
      return;
    }
  };
  
  // Cancel message deletion
  const cancelDeleteMessage = () => {
    setShowDeleteModal(false);
    setDeleteMessageIndex(null);
  };

  // Helper function to preserve variants when refreshing session data
  const mutateWithVariantPreservation = async () => {
    // Preserve current variant state before refreshing session
    const preservedVariants = new Map(messageVariants);
    const preservedVariantDisplay = new Map(variantDisplayContent);
    const preservedCurrentVariant = new Map(currentVariantIndex);
    
    console.log('Preserving variants before mutate:', preservedVariants.size, 'display:', preservedVariantDisplay.size);
    
    // Refresh session data
    await mutate();
    
    // The session useEffect will run and load variants from server data
    // We need to merge server variants with our preserved local state
    
    // Use setTimeout to ensure state updates happen after session useEffect has run
    setTimeout(() => {
      console.log('Merging preserved variants with server data');
      
      // Restore display content for messages that have variants
      setVariantDisplayContent(prev => {
        const newMap = new Map(prev);
        
        // For each preserved display content, restore it if we still have variants for that message
        const edited = recentlyEditedOriginalRef.current;
        preservedVariantDisplay.forEach((content, messageId) => {
          if (!preservedVariants.has(messageId)) return;
          // Skip restoring preserved original mapping if user just edited original (let fresh session message content show)
          if (edited.has(messageId)) return;
          // If persisted selection for this message is index 0, don't restore mapping (prevents flash of stale variant)
          const stored = loadVariantSelection(messageId);
          if (stored.index === 0) return;
          newMap.set(messageId, content);
        });
        // Clear edited originals marker after one restoration cycle
        if (edited.size) edited.clear();
        
        return newMap;
      });
      
      // Restore current variant indices
      setCurrentVariantIndex(prev => {
        const newMap = new Map(prev);
        
        // For each preserved variant index, restore it if we still have variants for that message
        preservedCurrentVariant.forEach((index, messageId) => {
          if (preservedVariants.has(messageId)) {
            newMap.set(messageId, index);
          }
        });
        
        return newMap;
      });
    }, 20); // Slightly longer delay to ensure session useEffect completes
  };
  // Wire up the ref so useSummary (called before this function is defined) can call it
  mutateWithVariantPreservationRef.current = mutateWithVariantPreservation;



  const handleSend = async (retryMessage?: string) => {
    // If retryMessage is provided, use it; otherwise use input
    const messageContent = retryMessage || input.trim();
    
    if (!messageContent || !session) return;
    
    // Commit any displayed variants before sending
    await commitVariantsBeforeSend();
    
    const formattedInput = messageContent.replace(/\r?\n/g, '\n');
    
    // Only add the user message to the conversation if we're not retrying
    if (!retryMessage) {
      const userMsg: ChatMessage = { role: 'user', content: formattedInput };
      // Capture the last server-known message ID before adding new messages
      const lastKnown = messages.filter(m => m.messageId).pop();
      preStreamLastMessageIdRef.current = lastKnown?.messageId ?? null;
      setMessages(prev => [...prev, userMsg]);
      setInput('');
  // Remember this input so we can restore if streaming gets aborted
  lastSentInputRef.current = formattedInput;
  shouldRestoreInputRef.current = true;
      // Reset textarea height after clearing input
      if (textareaRef.current) {
  textareaRef.current.style.height = '80px';
      }
    }
    
    setLoading(true);
    setIsStreaming(true);
    streamingMessageRef.current = '';
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    const showError = (msg: string) => { setApiErrorMessage(msg); setShowErrorModal(true); };

    const result = await performStreamingRequest({
      url: '/api/chat',
      body: {
        sessionId: Number(id),
        userMessage: formattedInput,
        retry: !!retryMessage,
      },
      abortControllerRef: streamingAbortController,
      onStreamChunk: (accumulated) => {
        streamingMessageRef.current = accumulated;
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last && last.role === 'assistant') last.content = accumulated;
          return copy;
        });
        maybeStartStreamingFollow();
      },
      onNonStreamResult: (data) => {
        const content = data?.choices?.[0]?.message?.content || data?.content;
        if (content) {
          setMessages(prev => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') { last.content = content; return copy; }
            return [...prev, { role: 'assistant', content }];
          });
        } else if (data?.error) {
          showError(sanitizeErrorMessage(extractUsefulError(data.error?.message || JSON.stringify(data.error))));
        }
      },
      onError: async (msg) => {
        const note = await buildRequestSizeNote();
        showError(note ? `${msg}\n\n${note}` : msg);
      },
      onAbort: () => { setLoading(false); setIsStreaming(false); },
    });

    if (result.wasAborted) { stopStreamingFollow(); return; }

    // Zero-content safety check (stream finished but no content arrived)
    if (result.wasStreaming && streamingMessageRef.current.length === 0) {
      console.warn('[Send] Stream finished with zero assistant content. Will trigger a mutate to refresh.');
    }

    // Post-request: truncation & max-token warnings
    await maybeShowTruncationWarning();
    setTimeout(async () => {
      const hitLimit = await checkMaxTokensHit();
      if (hitLimit) {
        const suffix = typeof result.settings.maxTokens === 'number' ? ` (${result.settings.maxTokens})` : '';
        const note = `Response stopped early: reached Max Tokens${suffix}. Increase Max Tokens in Settings or use Continue to resume.`;
        showError(note);
      }
    }, 1200);

    stopStreamingFollow();
    setLoading(false);
    setIsStreaming(false);
    setJustFinishedStreaming(true);
    setSkipNextMessageUpdate(true);
    streamingMessageRef.current = '';
    shouldRestoreInputRef.current = false;
    preStreamLastMessageIdRef.current = null;
    
    setTimeout(() => { if (editingMessageIndex === null) scrollToBottom(false); }, 100);
    
    // Delay database reload based on streaming/retry state
    const mutateDelay = result.wasStreaming ? (retryMessage ? 1500 : 1000) : (retryMessage ? 500 : 0);
    if (mutateDelay > 0) {
      setTimeout(async () => {
        skipNextScroll.current = true;
        await mutateWithVariantPreservation();
        setJustFinishedStreaming(false);
      }, mutateDelay);
    } else {
      await mutateWithVariantPreservation();
      setJustFinishedStreaming(false);
    }
  };
  // debug: download current messages to a text file
  const handleDownloadLog = () => {
    const text = messages.map(m => `${m.role}: ${m.content}`).join(`\n\n`);
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-debug-${id || 'session'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  // download the stored API request payload as JSON
  const handleDownloadRequest = async () => {
    if (!id) {
      console.error('No session ID available for request download');
      alert('No session ID available');
      return;
    }
    
    try {
      console.log(`Attempting to fetch request log for session ${id}`);
      const res = await fetch(`/api/chat/request-log/${id}`);
      
      if (!res.ok) {
        console.error(`Request failed with status ${res.status}`);
        const errorText = await res.text();
        console.error('Error response:', errorText);
        alert(`Failed to download request log: ${res.status} ${errorText}`);
        return;
      }
      
      const payload = await res.json();
      console.log('Request payload retrieved:', payload);
      
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-request-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('Request log downloaded successfully');
    } catch (error) {
      console.error('Error downloading request log:', error);
      alert(`Error downloading request log: ${error}`);
    }
  };

  // download the stored API response payload as JSON
  const handleDownloadResponse = async () => {
    if (!id) {
      console.error('No session ID available for response download');
      alert('No session ID available');
      return;
    }
    try {
      const res = await fetch(`/api/chat/response-log/${id}`);
      if (!res.ok) {
        const text = await res.text();
        alert(`Failed to download response log: ${res.status} ${text}`);
        return;
      }
      const payload = await res.json();
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-response-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading response log:', error);
      alert(`Error downloading response log: ${error}`);
    }
  };

  if (error) return (
    <div className="container text-center">
      <div className="card">
        <h2 className="text-error">Error loading session</h2>
        <p className="text-secondary">Please try again or go back to the home page.</p>
        <button className="btn btn-primary" onClick={() => router.push('/')}>
          Go Home
        </button>
      </div>
    </div>
  );
  
  if (!session) return (
    <div className="container text-center">
      <div className="card">
        <div className="status-indicator">
          <div className="status-dot status-loading"></div>
          Loading conversation...
        </div>
      </div>
    </div>
  );

  return (
    <div className="container-narrow chat-page">
      <Head>
        <title>{session.persona.name} chats with {session.character.name}</title>
        <meta name="description" content={`Chat conversation between ${session.persona.name} and ${session.character.name}`} />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <ChatHeader
        session={session}
        isBurgerMenuOpen={isBurgerMenuOpen}
        setIsBurgerMenuOpen={setIsBurgerMenuOpen}
        devMode={devMode}
        notesContent={notesContent}
        headerRef={headerRef}
        onOpenNotes={() => { setShowNotesModal(true); setOriginalNotesContent(notesContent); }}
        onOpenSummary={() => setShowSummaryModal(true)}
        onDownloadLog={handleDownloadLog}
        onDownloadRequest={handleDownloadRequest}
        onDownloadResponse={handleDownloadResponse}
      />

      {/* Chat Messages */}
      <div 
        className="chat-container-fullscreen" 
        style={{ top: `${headerHeight}px` }}
      >
        <div ref={containerRef} className="chat-messages">
          {messages.map((m, i) => {
            const isUser = m.role === 'user';
            const showSender = i === 0 || (messages[i - 1] && messages[i - 1]?.role !== m.role);
            const isEditing = editingMessageIndex === i;
            const messageId = m.messageId;
            const isLastAssistantMessage = !isUser && i === messages.length - 1;
            const hasVariants = messageId && messageVariants.has(messageId) && messageVariants.get(messageId)!.length > 0;
            const shouldShowVariants = hasVariants && isLastAssistantMessage; // Only show variants for the last assistant message
            const variants = messageId ? messageVariants.get(messageId) : undefined;
            // Compute an effective index at render time if needed (aggressive alignment)
            const stateIndex = messageId ? currentVariantIndex.get(messageId) : undefined;
            const effectiveIndex = (() => {
              if (!messageId || !variants) return undefined;
              // Prefer state, else compute from saved
              if (typeof stateIndex === 'number') return stateIndex;
              return computeEffectiveVariantIndex(messageId, variants.length);
            })();
            // Resolve display content using mapping or variants based on effective index
            const displayContent = (() => {
              if (messageId && variantDisplayContent.has(messageId)) {
                return variantDisplayContent.get(messageId)!;
              }
              if (messageId && variants && typeof effectiveIndex === 'number' && effectiveIndex > 0 && effectiveIndex <= variants.length) {
                const v = variants[effectiveIndex - 1];
                if (v) return v.content;
              }
              return m.content;
            })();
            // Variant counter (mirrors new file logic)
            const variantCounter = (() => {
              if (!messageId || !shouldShowVariants || !variants) return null;
              const safeCurrentIndex = (typeof effectiveIndex === 'number' ? effectiveIndex : 0);
              const safeVariantsLength = variants?.length ?? 0;
              const totalCount = safeVariantsLength + 1;
              if (generatingVariant === messageId) return '...';
              if (safeCurrentIndex < 0) return `1 / ${totalCount}`;
              if (safeCurrentIndex > safeVariantsLength) return `${safeVariantsLength + 1} / ${totalCount}`;
              return `${safeCurrentIndex + 1} / ${totalCount}`;
            })();
            
            // Determine if this assistant message should use initial anti-flicker hide
            const isVariantResolved = !isUser && messageId ? initialVariantResolvedRef.current.has(messageId) : true;
            const shouldApplyInitialHide = !isUser && isLastAssistantMessage && !initialHydrationDoneRef.current && !isVariantResolved;
            const variantLoadingClass = shouldApplyInitialHide
              ? 'initial-variant-loading'
              : (!isUser && isLastAssistantMessage && !initialHydrationDoneRef.current && isVariantResolved)
                ? 'initial-variant-resolved'
                : '';
            
            return (
              <div key={i} className={`chat-message ${isUser ? 'user' : 'assistant'} ${isEditing ? 'editing' : ''} ${variantLoadingClass}`.trim()}>
                {showSender && (
                  <div className={`chat-sender ${isUser ? 'user' : 'assistant'}`}>
                    {isUser ? session.persona.name : session.character.name}
                  </div>
                )}
                
                {isEditing ? (
                  <div className="message-edit-container">
                    <textarea
                      ref={editTextareaRef}
                      className="form-textarea message-edit-input"
                      value={editingContent}
                      onChange={e => {
                        setEditingContent(e.target.value);
                        // Auto-resize with scroll position preservation
                        requestAnimationFrame(() => {
                          const container = containerRef.current;
                          if (container) {
                            const scrollTop = container.scrollTop;
                            autoResizeEditTextarea();
                            container.scrollTop = scrollTop;
                          }
                        });
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.ctrlKey) {
                          e.preventDefault();
                          saveEditedMessage();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEditingMessage();
                        }
                      }}
                    />
                    <div className="message-edit-actions">
                      <button 
                        className="btn btn-primary btn-small" 
                        onClick={saveEditedMessage}
                        title="Save changes (Ctrl+Enter)"
                      >
                        ✓ Save
                      </button>
                      <button 
                        className="btn btn-secondary btn-small" 
                        onClick={cancelEditingMessage}
                        title="Cancel editing (Esc)"
                      >
                        ✗ Cancel
                      </button>
                    </div>
                    <div className="text-xs text-muted mt-1">
                      Press Ctrl+Enter to save, Esc to cancel
                    </div>
                  </div>
                ) : (
                  <>
                    <div 
                      className="message-content" 
                      dangerouslySetInnerHTML={{ __html: formatMessage(
                        isUser && displayContent.includes(': ') ? 
                          displayContent.replace(new RegExp(`^${session.persona.name}: `), '') : 
                          displayContent
                      ) }} 
                    />
                    <div className="chat-message-actions">
                      {isUser && !isEditing && (
                        <button className="delete-btn" onClick={() => deleteMessage(i)} title="Delete message">🗑️</button>
                      )}
                      {/* Retry last user message */}
                      {isUser && i === messages.length - 1 && !isEditing && (
                        <button className="retry-btn" onClick={() => handleSend(m.content)} title="Retry send">🔄</button>
                      )}
                      {!isEditing && (
                        <button className="edit-btn" onClick={() => startEditingMessage(i)} title="Edit message">✏️</button>
                      )}
                      {!isUser && i === messages.length - 1 && messageId && !isEditing && (
                        <button
                          className="variant-btn"
                          onClick={() => generateVariant(messageId)}
                          onMouseDown={(ev) => handleVariantButtonPressStart(ev, messageId)}
                          onMouseUp={handleVariantButtonPressEnd}
                          onMouseLeave={handleVariantButtonPressEnd}
                          onTouchStart={(ev) => handleVariantButtonPressStart(ev, messageId)}
                          onTouchEnd={handleVariantButtonPressEnd}
                          title="Generate variant"
                        >🧬</button>
                      )}
                      {!isUser && i === messages.length - 1 && !isEditing && (
                        <button className="continue-btn" onClick={continueConversation} title="Continue conversation">➡️</button>
                      )}
                      {(!isUser && messageId && shouldShowVariants && variants && variants.length > 0 && generatingVariant !== messageId && !isEditing) ? (
                        <>
                          <span className="variant-separator" />
                          <div className="variant-inline-controls" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button className="variant-nav-btn" onClick={() => navigateVariant(messageId, 'prev')} title="Previous variant">←</button>
                            <span className="variant-counter">{variantCounter}</span>
                            <button className="variant-nav-btn" onClick={() => navigateVariant(messageId, 'next')} title="Next variant">→</button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
  <ChatInput
    input={input} setInput={setInput}
    loading={loading} isStreaming={isStreaming} generatingVariant={generatingVariant}
    isNarrowScreen={isNarrowScreen} editingMessageIndex={editingMessageIndex}
    showScrollToLatest={showScrollToLatest} textareaRef={textareaRef}
    autoResizeTextarea={autoResizeTextarea}
    onSend={() => handleSend()} onStop={stopStreaming} onScrollToLatest={handleScrollToLatestClick}
  />
      </div>

      {showSummaryModal && (
        <SummaryModal
          summaryContent={summaryContent} setSummaryContent={setSummaryContent}
          generateSummary={generateSummary} updateSummary={updateSummary} saveSummary={saveSummary}
          canUpdateSummary={canUpdateSummary}
          generatingSummary={generatingSummary} updatingSummary={updatingSummary} savingSummary={savingSummary}
          session={session} onClose={() => setShowSummaryModal(false)}
        />
      )}

      {showNotesModal && (
        <>
          <NotesOverlayModal
            notesContent={notesContent} setNotesContent={setNotesContent}
            savingNotes={savingNotes} saveNotes={saveNotes}
            cancelNotesChanges={cancelNotesChanges} hasNotesChanges={hasNotesChanges}
            isWideScreen={isWideScreen} onClose={() => setShowNotesModal(false)}
          />
          <NotesSidecar
            notesContent={notesContent} setNotesContent={setNotesContent}
            savingNotes={savingNotes} saveNotes={saveNotes}
            cancelNotesChanges={cancelNotesChanges} hasNotesChanges={hasNotesChanges}
            isWideScreen={isWideScreen} onClose={() => setShowNotesModal(false)}
          />
        </>
      )}

      {showDeleteModal && deleteMessageIndex !== null && (
        <DeleteConfirmModal
          messages={messages}
          deleteMessageIndex={deleteMessageIndex}
          onConfirm={confirmDeleteMessage}
          onCancel={cancelDeleteMessage}
        />
      )}

      {showErrorModal && (
        <ErrorModal
          apiErrorMessage={apiErrorMessage}
          onDownloadRequest={handleDownloadRequest}
          onDownloadResponse={handleDownloadResponse}
          onClose={() => setShowErrorModal(false)}
        />
      )}

      {variantTempPopover && variantTempPopover.messageId && (
        <VariantTempPopover
          x={variantTempPopover.x}
          y={variantTempPopover.y}
          tempValue={variantTempValue}
          setTempValue={setVariantTempValue}
          onGenerate={sendVariantWithTemp}
          onClose={closeVariantTempPopover}
        />
      )}
    </div>
  );
}