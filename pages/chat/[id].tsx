import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import Head from 'next/head';

// message shape for UI only
type ChatMessage = { role: 'user' | 'assistant'; content: string; messageId?: number; };
type Message = { id: number; role: string; content: string; versions?: MessageVersion[] };
type MessageVersion = { id: number; content: string; version: number; isActive: boolean };
type SessionData = {
  id: number;
  personaId: number;
  characterId: number;
  summary?: string;
  lastSummary?: number;
  persona: { id: number; name: string; profileName?: string };
  character: { id: number; name: string; profileName?: string };
  messages: Message[];
  hasMore?: boolean; // present when using pagination
};

const fetcher = (url: string) => fetch(url).then(res => res.json());
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
  return `<div>${html}</div>`;
}

export default function ChatSessionPage() {
  const router = useRouter();
  const { id } = router.query;
  const { data: session, error, mutate } = useSWR<SessionData>(id ? `/api/sessions/${id}?limit=${INITIAL_PAGE_SIZE}` : null, fetcher);
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
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryContent, setSummaryContent] = useState('');
  const [savingSummary, setSavingSummary] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [updatingSummary, setUpdatingSummary] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [notesContent, setNotesContent] = useState('');
  const [originalNotesContent, setOriginalNotesContent] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
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
  const [showScrollToLatest, setShowScrollToLatest] = useState(false); // show jump-to-bottom button
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(112); // Initial estimate: 80px header + 32px gap
  const streamingMessageRef = useRef<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const lastScrollTime = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const skipNextScroll = useRef<boolean>(false);
  const streamingAbortController = useRef<AbortController | null>(null);
  const variantAbortController = useRef<AbortController | null>(null);
  const userPinnedBottomRef = useRef(true);
  const suppressNextAutoScrollRef = useRef(false);
  const oldestMessageIdRef = useRef<number | null>(null); // cursor for loading older pages
  // Track last sent user input so we can restore it if streaming is aborted early
  const lastSentInputRef = useRef<string>('');
  const shouldRestoreInputRef = useRef<boolean>(false);
  // Track whether we've performed the one-time initial bottom scroll (to avoid visible top->bottom animation)
  const initialScrollDoneRef = useRef<boolean>(false);
  // Smooth follow scrolling (ported from _bak)
  const streamingFollowActiveRef = useRef<boolean>(false);
  const streamingFollowRafRef = useRef<number | null>(null);
  const isStreamingRef = useRef<boolean>(isStreaming);
  const generatingVariantRef = useRef<number | null>(generatingVariant);
  const forceNextSmoothRef = useRef<boolean>(false);
  // Track previous scrollHeight to preserve visual bottom anchoring during streaming
  const prevScrollHeightRef = useRef<number>(0);
  // Track originals edited while variants exist so we don't restore stale variantDisplayContent over updated main message
  const recentlyEditedOriginalRef = useRef<Set<number>>(new Set());
  // Ensure bump-to-latest runs on initial page load too (one-time per message)
  const initialVariantBumpDoneRef = useRef<Set<number>>(new Set());
  // Track which assistant messages have resolved their initial variant selection
  const initialVariantResolvedRef = useRef<Set<number>>(new Set());
  // Gate the initial anti-flicker hide to first hydration only
  const initialHydrationDoneRef = useRef<boolean>(false);
  // Debug helpers for response logging and resilient JSON parsing
  const logMeta = (label: string, res: Response) => {
    try {
      console.log(label, {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: {
          'content-type': res.headers.get('content-type'),
          'cache-control': res.headers.get('cache-control'),
          'x-accel-buffering': res.headers.get('x-accel-buffering')
        }
      });
    } catch {}
  };
  const safeJson = async (res: Response) => {
    try {
      return await res.json();
    } catch (e) {
      try {
        const text = await res.clone().text();
        return { __rawText: text } as any;
      } catch {
        return { __parseError: true } as any;
      }
    }
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

  // Mask potentially sensitive tokens (e.g., API keys) in error messages
  const sanitizeErrorMessage = (msg: string) => {
    if (!msg) return '';
    try {
      // Mask values that look like: "api key: XXXXX"
      return msg.replace(/(api\s*key\s*:\s*)(\S+)/gi, (_, p1, key) => {
        const keep = 4;
        const masked = key.length > keep ? key.replace(new RegExp(`.(?=.{${keep}}$)`, 'g'), '*') : '****';
        return `${p1}${masked}`;
      });
    } catch {
      return msg;
    }
  };

  // Extract a human-meaningful message from raw SSE/text errors
  const extractUsefulError = (raw: string) => {
    if (!raw) return '';
    let msg = raw.trim();
    // Strip leading tag like [Stream]
    msg = msg.replace(/^\[[^\]]+\]\s*/,'');
    // Normalize common generic errors
    if (/input\s*stream/i.test(msg)) {
      return 'The AI stream was interrupted. Partial response was saved if available.';
    }
    // Prefer the part starting at "Authentication Fails"
    const auth = msg.match(/Authentication Fails[\s\S]*$/i);
    if (auth) return auth[0].trim();
    // Otherwise, drop up to the last colon
    const idx = msg.lastIndexOf(':');
    if (idx !== -1 && idx + 1 < msg.length) {
      return msg.slice(idx + 1).trim();
    }
    return msg;
  };

  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { generatingVariantRef.current = generatingVariant; }, [generatingVariant]);

  // Reset initial variant gating when navigating to a different chat
  useEffect(() => {
    initialVariantBumpDoneRef.current.clear();
    initialVariantResolvedRef.current.clear();
    initialHydrationDoneRef.current = false;
  }, [id]);

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
      if ((!isStreamingRef.current && generatingVariantRef.current === null) || !userPinnedBottomRef.current || editingMessageIndex !== null) {
        stopStreamingFollow();
        return;
      }
      const target = container.scrollHeight - container.clientHeight;
  // Directly anchor to bottom (no easing) to avoid visual bounce where bottom shifts then snaps back
  container.scrollTop = target;
      streamingFollowRafRef.current = requestAnimationFrame(step);
    };
    streamingFollowActiveRef.current = true;
    streamingFollowRafRef.current = requestAnimationFrame(step);
  }, [editingMessageIndex, stopStreamingFollow]);

  const maybeStartStreamingFollow = useCallback(() => {
    if (editingMessageIndex !== null) return;
    if (!userPinnedBottomRef.current) return;
    if (!isStreamingRef.current && generatingVariantRef.current === null) return;
    startStreamingFollow();
  }, [editingMessageIndex, startStreamingFollow]);

  // (scroll effect added after loadOlderMessages)

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
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const wasPinned = userPinnedBottomRef.current;
      userPinnedBottomRef.current = distanceFromBottom < 120; // threshold
      if (wasPinned && !userPinnedBottomRef.current) suppressNextAutoScrollRef.current = true;
      setShowScrollToLatest(!userPinnedBottomRef.current);
      // Near the top? Load older messages if available
      if (el.scrollTop < 120 && hasMore && !loadingMore) {
        loadOlderMessages();
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll as any);
  }, [hasMore, loadingMore, loadOlderMessages]);

  // Function to stop streaming (both chat and variant generation)
  const stopStreaming = useCallback(() => {
    if (streamingAbortController.current) {
      streamingAbortController.current.abort();
      streamingAbortController.current = null;
      setIsStreaming(false);
  stopStreamingFollow();
      setLoading(false);
      // If user aborted mid-stream and we flagged restoration, only restore if we received NO assistant content
      if (shouldRestoreInputRef.current && lastSentInputRef.current) {
        // Determine if any assistant content was produced
        let hasAssistantContent = false;
        if (streamingMessageRef.current && streamingMessageRef.current.trim().length > 0) {
          hasAssistantContent = true;
        } else {
          // Check last message in state (may have accumulated content already)
            const last = messages[messages.length - 1];
            if (last && last.role === 'assistant' && last.content && last.content.trim().length > 0) {
              hasAssistantContent = true;
            }
        }
        if (!hasAssistantContent) {
          setInput(prev => prev ? prev : lastSentInputRef.current);
        }
        // Clear flag either way to avoid repeated restores
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
    
    setGeneratingVariant(messageId);
    
    try {
      // Get current settings for streaming
      const settingsRes = await fetch('/api/settings');
      const settings = await settingsRes.json();
      const streamSetting = settings.stream === 'true';
      
      // Get current variants to calculate the new index
      const currentVariants = messageVariants.get(messageId) || [];
      const newVariantIndex = currentVariants.length + 1; // +1 for the new variant we're about to add
      
      // Create a placeholder variant immediately and switch to it
      const placeholderVariant = {
        id: -1, // Temporary ID
        content: '',
        version: newVariantIndex,
        isActive: false,
        messageId: messageId
      };
      
      // Batch all state updates together for immediate UI response
      // This ensures that no old content is shown when switching to the new variant
      flushSync(() => {
        setMessageVariants(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(messageId) || [];
          newMap.set(messageId, [...existing, placeholderVariant]);
          return newMap;
        });
        
        setCurrentVariantIndex(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, newVariantIndex);
          return newMap;
        });
        
        // Save the new variant selection to localStorage
        saveVariantSelection(messageId, newVariantIndex);
        
        setVariantDisplayContent(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, ''); // Immediately show blank content
          return newMap;
        });
      });
      
      // Scroll immediately after DOM update
      setTimeout(() => scrollToBottom(false), 5);
      
      // Now start generating the variant
      let abortController: AbortController | undefined;
      if (streamSetting) {
        abortController = new AbortController();
        variantAbortController.current = abortController;
      }
      
      const response = await fetch(`/api/messages/${messageId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: streamSetting, ...(opts?.temperature != null ? { temperature: opts.temperature } : {}) }),
        ...(streamSetting && abortController ? { signal: abortController.signal } : {})
      });
      // Immediate error handling for non-OK responses
      if (!response.ok) {
        const errData = await safeJson(response as any);
        const raw = (errData?.__rawText || errData?.error?.message || errData?.error || response.statusText || 'Unknown error') as string;
        setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
        setShowErrorModal(true);
        // Remove the placeholder and reset selection/index + restore display content
        setMessageVariants(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(messageId) || [];
          const trimmed = existing.slice(0, -1);
          newMap.set(messageId, trimmed);
          const newVariantCount = trimmed.length;
          setCurrentVariantIndex(prevIndex => {
            const indexMap = new Map(prevIndex);
            indexMap.set(messageId, newVariantCount);
            return indexMap;
          });
          const originalMessage = messages.find(m => m.messageId === messageId);
          const recentVariant = newVariantCount > 0 ? trimmed[newVariantCount - 1] : undefined;
          const content = recentVariant?.content || originalMessage?.content || '';
          setVariantDisplayContent(vPrev => {
            const map = new Map(vPrev);
            if (content) map.set(messageId, content); else map.delete(messageId);
            return map;
          });
          saveVariantSelection(messageId, newVariantCount);
          return newMap;
        });
        variantAbortController.current = null;
        stopStreamingFollow();
        setGeneratingVariant(null);
        return;
      }

      // Treat as streaming only if content-type is SSE
      const vCT = response.headers.get('content-type') || '';
      const vIsSSE = vCT.includes('text/event-stream');

      if (streamSetting && response.body && vIsSSE) {
        // Streaming response
        let streamingContent = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        
        try {
          while (!done) {
            const { value, done: doneReading } = await reader.read();
            if (doneReading) {
              done = true;
              break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split(/\r?\n/).filter(l => l.startsWith('data: '));
            
            for (const line of lines) {
              const payload = line.replace(/^data: /, '').trim();
              
              if (payload === '[DONE]') {
                done = true;
                break;
              }
              
              try {
                const parsed = JSON.parse(payload);
                const content = parsed.content || '';
                
                if (content) {
                  streamingContent += content;
                  // Update display content in real-time
                  setVariantDisplayContent(prev => {
                    const newMap = new Map(prev);
                    newMap.set(messageId, streamingContent);
                    return newMap;
                  });
                  // Trigger smooth follow during streaming
                  maybeStartStreamingFollow();
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
          
          // After streaming is complete, get the final variant data from the response
          // We need to make another request to get the actual variant record
          const finalResponse = await fetch(`/api/messages/${messageId}/variants/latest`);
          if (!finalResponse.ok) {
            const errData = await safeJson(finalResponse as any);
            const raw = (errData?.__rawText || errData?.error?.message || errData?.error || finalResponse.statusText || 'Unknown error') as string;
            setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
            setShowErrorModal(true);
            // Drop placeholder & revert selection/content similar to abort case
            setMessageVariants(prev => {
              const newMap = new Map(prev);
              const existing = newMap.get(messageId) || [];
              if (existing.length) {
                const trimmed = existing.slice(0, -1);
                newMap.set(messageId, trimmed);
                const newVariantCount = trimmed.length;
                setCurrentVariantIndex(ciPrev => {
                  const map = new Map(ciPrev);
                  map.set(messageId, newVariantCount);
                  return map;
                });
                const originalMessage = messages.find(m => m.messageId === messageId);
                const recentVariant = newVariantCount > 0 ? trimmed[newVariantCount - 1] : undefined;
                const content = recentVariant?.content || originalMessage?.content || '';
                setVariantDisplayContent(vPrev => {
                  const map = new Map(vPrev);
                  if (content) map.set(messageId, content); else map.delete(messageId);
                  return map;
                });
                saveVariantSelection(messageId, newVariantCount);
              }
              return newMap;
            });
            setGeneratingVariant(null);
            return;
          }
          const newVariant = await finalResponse.json();
          
          // Update state with the real variant, but preserve the streamed content
          setMessageVariants(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(messageId) || [];
            // Replace the placeholder with the real variant
            const updated = [...existing];
            updated[updated.length - 1] = newVariant;
            newMap.set(messageId, updated);
            return newMap;
          });
          
          // Don't update variantDisplayContent here since it already has the streamed content
          // This prevents any UI jumps after streaming completes
          // After variant completes, surface truncation and max-tokens notices like main chat
          await maybeShowTruncationWarning();
          await maybeShowMaxTokensCutoff();
          
        } catch (err: any) {
          if (err.name === 'AbortError') {
            // User cancelled variant generation: drop placeholder & revert immediately
            setMessageVariants(prev => {
              const newMap = new Map(prev);
              const existing = newMap.get(messageId) || [];
              if (existing.length) {
                const last = existing[existing.length - 1];
                if (last && last.id === -1) {
                // remove placeholder
                const trimmed = existing.slice(0, -1);
                newMap.set(messageId, trimmed);
                // Update index & display content
                const newVariantCount = trimmed.length;
                setCurrentVariantIndex(ciPrev => {
                  const map = new Map(ciPrev);
                  map.set(messageId, newVariantCount);
                  return map;
                });
                const originalMessage = messages.find(m => m.messageId === messageId);
                const recentVariant = newVariantCount > 0 ? trimmed[newVariantCount - 1] : undefined;
                const content = recentVariant?.content || originalMessage?.content || '';
                setVariantDisplayContent(vPrev => {
                  const map = new Map(vPrev);
                  if (content) map.set(messageId, content); else map.delete(messageId);
                  return map;
                });
                saveVariantSelection(messageId, newVariantCount);
                }
              }
              return newMap;
            });
            // Ensure generating state cleared
            setGeneratingVariant(null);
            stopStreamingFollow();
            return; // do not proceed further
          } else {
            // Other error - handle normally
            throw err;
          }
        } finally {
          variantAbortController.current = null;
          stopStreamingFollow();
        }
        
      } else {
        // Non-streaming response
  const newVariant = await response.json();
        
        // Update state with new variant
        setMessageVariants(prev => {
          const newMap = new Map(prev);
          const existing = newMap.get(messageId) || [];
          // Replace the placeholder with the real variant
          const updated = [...existing];
          updated[updated.length - 1] = newVariant;
          newMap.set(messageId, updated);
          return newMap;
        });
        
        // Update display content
        setVariantDisplayContent(prev => {
          const newMap = new Map(prev);
          newMap.set(messageId, newVariant.content);
          return newMap;
        });

  // After variant completes (non-stream), surface truncation and max-tokens notices
  await maybeShowTruncationWarning();
  await maybeShowMaxTokensCutoff();
      }
      
    } catch (error) {
      console.error('Failed to generate variant:', error);
      setApiErrorMessage(sanitizeErrorMessage(extractUsefulError((error as any)?.message || JSON.stringify(error))));
      setShowErrorModal(true);
      
      // Remove the placeholder variant on error, reset index, and restore display content
      setMessageVariants(prev => {
        const newMap = new Map(prev);
        const existing = newMap.get(messageId) || [];
        const trimmed = existing.slice(0, -1);
        newMap.set(messageId, trimmed);
        const newVariantCount = trimmed.length;
        setCurrentVariantIndex(prevIndex => {
          const indexMap = new Map(prevIndex);
          indexMap.set(messageId, newVariantCount);
          return indexMap;
        });
        const originalMessage = messages.find(m => m.messageId === messageId);
        const recentVariant = newVariantCount > 0 ? trimmed[newVariantCount - 1] : undefined;
        const content = recentVariant?.content || originalMessage?.content || '';
        setVariantDisplayContent(vPrev => {
          const map = new Map(vPrev);
          if (content) map.set(messageId, content); else map.delete(messageId);
          return map;
        });
        saveVariantSelection(messageId, newVariantCount);
        return newMap;
      });
      
    } finally {
      // Don't clear generating state yet - this prevents variant counter from showing wrong values
      variantAbortController.current = null;
      
      // Simple approach: just refresh the data without complex preservation
      // The variant counter will remain hidden during this process
      setTimeout(async () => {
        skipNextScroll.current = true;
        await mutate(); // Direct mutate instead of complex preservation logic
        
        // Clear generating state after refresh completes to show the counter again
        setTimeout(() => {
          setGeneratingVariant(null);
        }, 100); // Longer delay to ensure all state is updated
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

  // Load devMode setting
  useEffect(() => {
    const stored = localStorage.getItem('devMode');
    if (stored === 'true') {
      setDevMode(true);
    }
  }, []);

  // Initialize summary content when session data loads
  useEffect(() => {
    if (session?.summary) {
      setSummaryContent(session.summary);
    }
  }, [session?.summary]);

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
      
      // Load variants only for the last assistant message from server data - but only if not in streaming state
      if (!isStreaming && !justFinishedStreaming && generatingVariant === null) {
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
    
    // Load notes when session loads
    if (session?.id) {
      loadNotes();
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
    if (session) {
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
  }, [session]);

  // Close burger menu on outside click and handle escape key
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isBurgerMenuOpen && headerRef.current && !headerRef.current.contains(event.target as Node)) {
        setIsBurgerMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isBurgerMenuOpen) {
          setIsBurgerMenuOpen(false);
          return;
        }
        // Only close modals when they're in overlay mode (narrow screens)
        // Don't close sidecar modals (wide screens) as they're less intrusive
        if (showNotesModal && !isWideScreen) {
          setShowNotesModal(false);
        } else if (showSummaryModal) {
          // Summary modal is always overlay, so always close on Escape
          setShowSummaryModal(false);
        }
      }
    };

    if (isBurgerMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    // Add event listener when any modal is open or burger menu is open
  if (isBurgerMenuOpen || showNotesModal || showSummaryModal || showDeleteModal || showErrorModal) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBurgerMenuOpen, showNotesModal, showSummaryModal, showDeleteModal, showErrorModal, isWideScreen]);

  // Handle Escape key to close modals (only overlay modals, not sidecar)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Only close modals when they're in overlay mode (narrow screens)
        // Don't close sidecar modals (wide screens) as they're less intrusive
        if (showNotesModal && !isWideScreen) {
          setShowNotesModal(false);
        } else if (showSummaryModal) {
          // Summary modal is always overlay, so always close on Escape
          setShowSummaryModal(false);
        } else if (showErrorModal) {
          setShowErrorModal(false);
        } else if (showDeleteModal) {
          // Delete modal is always overlay, so always close on Escape
          setShowDeleteModal(false);
          setDeleteMessageIndex(null);
        }
      }
    };

    // Add event listener when any modal is open
  if (showNotesModal || showSummaryModal || showDeleteModal || showErrorModal) {
      document.addEventListener('keydown', handleKeyDown);
    }

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showNotesModal, showSummaryModal, showDeleteModal, showErrorModal, isWideScreen]);

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

  // Summary functions
  const saveSummary = async () => {
    if (!id) return;
    
    setSavingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summaryContent })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save summary');
      }
      
      // Update session data while preserving variants
      await mutateWithVariantPreservation();
      setShowSummaryModal(false);
    } catch (error) {
      console.error('Failed to save summary:', error);
      alert('Failed to save summary. Please try again.');
    } finally {
      setSavingSummary(false);
    }
  };

  const generateSummary = async () => {
    if (!id) return;
    
    setGeneratingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${id}/generate-summary`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate summary');
      }
      
      const data = await response.json();
      setSummaryContent(data.summary);
      
      // Update session data while preserving variants
      await mutateWithVariantPreservation();
    } catch (error) {
      console.error('Failed to generate summary:', error);
      alert('Failed to generate summary. Please try again.');
    } finally {
      setGeneratingSummary(false);
    }
  };

  const updateSummary = async () => {
    if (!id) return;
    
    setUpdatingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${id}/update-summary`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update summary');
      }
      
      const data = await response.json();
      setSummaryContent(data.summary);
      
      // Update session data while preserving variants
      await mutateWithVariantPreservation();
    } catch (error) {
      console.error('Failed to update summary:', error);
      alert(`Failed to update summary: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUpdatingSummary(false);
    }
  };

  // Check if update summary should be enabled
  const canUpdateSummary = () => {
    if (!session || !session.summary) return false;
    
    const lastSummaryId = session.lastSummary;
    
    if (!lastSummaryId) return false;
    
    // Check if there are new messages after lastSummary
    const hasNewMessages = session.messages.some(msg => msg.id > lastSummaryId);
    return hasNewMessages;
  };

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

  // Load devMode setting
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

  // Initialize summary content
  useEffect(() => {
    if (session?.summary) {
      setSummaryContent(session.summary);
    }
  }, [session?.summary]);

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

  // Handle summary save
  const handleSaveSummary = async () => {
    if (!session || savingSummary) return;
    
    setSavingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: summaryContent })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save summary');
      }
      
      // Refresh session data to get updated summary while preserving variants
      await mutateWithVariantPreservation();
      setShowSummaryModal(false);
    } catch (error) {
      console.error('Failed to save summary:', error);
      alert('Failed to save summary. Please try again.');
    } finally {
      setSavingSummary(false);
    }
  };

  // Handle summary generation
  const handleGenerateSummary = async () => {
    if (!session || generatingSummary) return;
    
    setGeneratingSummary(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/generate-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate summary');
      }
      
      const data = await response.json();
      
      // Update the summary content in the UI
      setSummaryContent(data.summary);
      
      // Refresh session data to get updated summary while preserving variants
      await mutateWithVariantPreservation();
      
    } catch (error) {
      console.error('Failed to generate summary:', error);
      alert('Failed to generate summary. Please try again.');
    } finally {
      setGeneratingSummary(false);
    }
  };

  // Redo the most recent assistant message
  const redoLastAssistantMessage = async () => {
    if (loading || isStreaming || !session) return;
    
    // Find the last assistant message
    const lastAssistantIndex = messages.findLastIndex(m => m.role === 'assistant');
    if (lastAssistantIndex === -1) return;
    
    // Find the user message that prompted this assistant response
    const userMessageIndex = lastAssistantIndex - 1;
    if (userMessageIndex < 0) return;
    
    const userMessageObj = messages[userMessageIndex];
    if (!userMessageObj || userMessageObj.role !== 'user') return;
    
    const userMessage = userMessageObj.content;
    // Delete the last assistant message server-side (no truncate)
    const lastAssistantMsg = messages[lastAssistantIndex];
    const lastAssistantId = lastAssistantMsg?.messageId;
    const prevMessages = messages;
    const messagesWithoutLastResponse = messages.slice(0, lastAssistantIndex);
    if (!lastAssistantId) {
      await mutateWithVariantPreservation();
      alert('Unable to redo: missing message id. Refreshed conversation.');
      return;
    }
    setMessages(messagesWithoutLastResponse);
    try {
      const delRes = await fetch(`/api/messages/${lastAssistantId}`, { method: 'DELETE' });
      if (!delRes.ok) throw new Error('Failed to delete last assistant message');
    } catch (error) {
      console.error('Failed to delete last assistant message:', error);
      setMessages(prevMessages);
      alert('Failed to regenerate response. Please try again.');
      return;
    }
    
    setLoading(true);

    // Get settings from database
    const settingsRes = await fetch('/api/settings');
    const settings = await settingsRes.json();
    
    const streamSetting = settings.stream === 'true';
    const defaultPromptId = settings.defaultPromptId ? Number(settings.defaultPromptId) : undefined;
  const tempSetting = settings.temperature ? parseFloat(settings.temperature) : 0.7;
  const maxTokensSetting = settings.maxTokens ? Math.max(256, Math.min(8192, parseInt(settings.maxTokens))) : 4096;
    
    setIsStreaming(streamSetting);
    
    // Generate new response using the API without userMessage (to avoid duplicating)
  const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        sessionId: Number(id), 
        stream: streamSetting, 
        userPromptId: defaultPromptId,
        temperature: tempSetting,
        maxTokens: maxTokensSetting
        // Note: No userMessage here since we just want to generate response to existing messages
      })
    });

    // Show error immediately if request failed and not streaming
    if (!res.ok && (!streamSetting || !res.body)) {
  const errData = await safeJson(res as any);
  const raw = (errData?.__rawText || errData?.error?.message || errData?.error || res.statusText || 'Unknown error') as string;
  setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
      setShowErrorModal(true);
      setLoading(false);
      setIsStreaming(false);
      return;
    }

  const ct1 = res.headers.get('content-type') || '';
  const isSSE1 = ct1.includes('text/event-stream');
  if (streamSetting && res.body && isSSE1) {
      // Streaming response
      streamingMessageRef.current = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        if (doneReading) {
          done = true;
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split(/\r?\n/).filter(l => l.startsWith('data: '));
        
        for (const line of lines) {
          const payload = line.replace(/^data: /, '').trim();
          
          if (payload === '[DONE]') {
            done = true;
            break;
          }
          
          try {
            const parsed = JSON.parse(payload);
            const content = parsed.content || '';
            
            if (content) {
              streamingMessageRef.current += content;
              setMessages(prev => {
                const copy = [...prev];
                const lastMessage = copy[copy.length - 1];
                if (lastMessage && lastMessage.role === 'assistant') {
                  lastMessage.content = streamingMessageRef.current;
                }
                return copy;
              });
    maybeStartStreamingFollow();
            }
          } catch (error) {
            console.error('Failed to parse response chunk:', error);
          }
        }
      }
  stopStreamingFollow();
    } else {
  // Non-streaming response
      try {
        const data = await res.json();
        if (data.choices && data.choices[0]?.message?.content) {
          const assistantMsg: ChatMessage = { 
            role: 'assistant', 
            content: data.choices[0].message.content 
          };
          setMessages(prev => [...prev, assistantMsg]);
        } else if (data.error) {
          console.error('API Error:', data.error);
          setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(data.error))));
          setShowErrorModal(true);
        }
      } catch (error) {
        console.error('Failed to parse response:', error);
        setApiErrorMessage('Failed to get response from AI');
        setShowErrorModal(true);
      }
    }
    
    setLoading(false);
    setIsStreaming(false);
    setJustFinishedStreaming(true);
    setSkipNextMessageUpdate(true);
    streamingMessageRef.current = '';
    
    // Final smooth scroll after streaming completes
    setTimeout(() => scrollToBottom(false), 100);
    
    // Reload database state
    setTimeout(async () => {
      skipNextScroll.current = true;
      await mutateWithVariantPreservation();
      setJustFinishedStreaming(false);
    }, 500);
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
    
    // Clean up variants for all assistant messages after committing
    for (const msg of assistantMessages) {
      if (messageVariants.has(msg.id)) {
        await cleanupVariants(msg.id);
      }
    }
    
    setLoading(true);

    // Get settings from database
    const settingsRes = await fetch('/api/settings');
    const settings = await settingsRes.json();
    
    const streamSetting = settings.stream === 'true';
    const defaultPromptId = settings.defaultPromptId ? Number(settings.defaultPromptId) : undefined;
  const tempSetting = settings.temperature ? parseFloat(settings.temperature) : 0.7;
  const maxTokensSetting = settings.maxTokens ? Math.max(256, Math.min(8192, parseInt(settings.maxTokens))) : 4096;
    
    setIsStreaming(streamSetting);

    let abortController: AbortController | undefined;
    if (streamSetting) {
      abortController = new AbortController();
      streamingAbortController.current = abortController;
    }
    
    // Generate new response using a continue prompt
  const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        sessionId: Number(id), 
        userMessage: '[SYSTEM NOTE: Ignore this message, reply as if you are extending the last message you sent as if your reply never ended - do not make an effort to send a message on behalf of the user unless the most recent message from you did include speaking on behalf of the user. Specifically do not start messages with `{{user}}: `, you should NEVER use that format in any message.]', // Special system prompt
        stream: streamSetting, 
        userPromptId: defaultPromptId,
        temperature: tempSetting,
        maxTokens: maxTokensSetting
      }),
      ...(streamSetting && abortController ? { signal: abortController.signal } : {})
    });

    // If the response is unauthorized or not ok in general and not streaming, surface error
    if (!res.ok && (!streamSetting || !res.body)) {
      const errData = await safeJson(res as any);
  const raw = (errData?.__rawText || errData?.error?.message || errData?.error || res.statusText || 'Unknown error') as string;
      setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
      setShowErrorModal(true);
      setLoading(false);
      setIsStreaming(false);
      return;
    }

    // If the response is unauthorized or not ok in general and not streaming, surface error
    if (!res.ok && (!streamSetting || !res.body)) {
      const errData = await safeJson(res as any);
  const raw = (errData?.__rawText || errData?.error?.message || errData?.error || res.statusText || 'Unknown error') as string;
      setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
      setShowErrorModal(true);
      setLoading(false);
      setIsStreaming(false);
      return;
    }

  const ct2 = res.headers.get('content-type') || '';
  const isSSE2 = ct2.includes('text/event-stream');
  if (streamSetting && res.body && isSSE2) {
      // Streaming response - append to the last assistant message instead of creating a new one
      streamingMessageRef.current = '';
      
      // Capture the original content before streaming starts
      let originalContent = '';
      setMessages(prev => {
        const lastAssistantIndex = prev.findLastIndex(m => m.role === 'assistant');
        if (lastAssistantIndex !== -1) {
          const lastMessage = prev[lastAssistantIndex];
          if (lastMessage) {
            // Capture the original content
            originalContent = lastMessage.content;
            return prev;
          }
        }
        // Fallback: add new message if no previous assistant message found
        return [...prev, { role: 'assistant', content: '' }];
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      
      try {
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          if (doneReading) {
            done = true;
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split(/\r?\n/).filter(l => l.startsWith('data: '));
          
          for (const line of lines) {
            const payload = line.replace(/^data: /, '').trim();
            
            if (payload === '[DONE]') {
              done = true;
              break;
            }
            
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.content || '';
              
              if (content) {
                streamingMessageRef.current += content;
                setMessages(prev => {
                  const copy = [...prev];
                  const lastAssistantIndex = copy.findLastIndex(m => m.role === 'assistant');
                  if (lastAssistantIndex !== -1) {
                    const lastMessage = copy[lastAssistantIndex];
                    if (lastMessage) {
                      // Use the captured original content and append the streaming content
                      if (streamingMessageRef.current) {
                        lastMessage.content = originalContent + '\n\n' + streamingMessageRef.current;
                      } else {
                        lastMessage.content = originalContent;
                      }
                    }
                  }
                  return copy;
                });
                maybeStartStreamingFollow();
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Continue conversation was stopped by user
          console.log('Continue conversation stopped by user');
          setLoading(false);
          setIsStreaming(false);
          setJustFinishedStreaming(true);
          streamingMessageRef.current = '';
          stopStreamingFollow();
          
          // Exit early, skip database refresh to preserve the partial content in UI
          return;
        } else {
          // Other error
          console.error('Continue conversation streaming error:', err);
          setLoading(false);
          setIsStreaming(false);
          // If we already streamed some content, suppress scary modal
          if (streamingMessageRef.current && streamingMessageRef.current.length > 0) {
            // Let the partial remain in UI; a later mutate will reconcile
            console.warn('Stream ended early after partial content; skipping error modal');
          } else {
            setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(err?.message || 'Streaming error')));
            setShowErrorModal(true);
          }
        }
      } finally {
        streamingAbortController.current = null;
        stopStreamingFollow();
      }
    } else {
      // Non-streaming response - append to the last assistant message
      try {
        const data = await res.json();
        if (data.choices && data.choices[0]?.message?.content) {
          const continuationContent = data.choices[0].message.content;
          setMessages(prev => {
            const lastAssistantIndex = prev.findLastIndex(m => m.role === 'assistant');
            if (lastAssistantIndex !== -1) {
              const lastMessage = prev[lastAssistantIndex];
              if (lastMessage) {
                const updatedMessages = [...prev];
                updatedMessages[lastAssistantIndex] = {
                  role: 'assistant',
                  content: lastMessage.content + '\n\n' + continuationContent
                };
                return updatedMessages;
              }
            }
            // Fallback: add new message if no previous assistant message found
            return [...prev, { role: 'assistant', content: continuationContent }];
          });
        } else if (data.error) {
          console.error('API Error:', data.error);
          setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(data.error))));
          setShowErrorModal(true);
        }
      } catch (error) {
        console.error('Failed to parse response:', error);
        setApiErrorMessage('Failed to get response from AI');
        setShowErrorModal(true);
      }
    }
    
    setLoading(false);
    setIsStreaming(false);
    setJustFinishedStreaming(true);
    setSkipNextMessageUpdate(true);
    streamingMessageRef.current = '';
    
    // Final smooth scroll after streaming completes (but not during edit mode)
    setTimeout(() => {
      if (editingMessageIndex === null) {
        scrollToBottom(false);
      }
    }, 100);
    
    // Reload database state
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

  // Redo the last assistant response
  const redoLastResponse = async () => {
    if (loading || isStreaming || !session) return;
    
    // Find the last assistant message
    const lastAssistantIndex = messages.findLastIndex(m => m.role === 'assistant');
    if (lastAssistantIndex === -1) return;
    
    // Find the user message that prompted this assistant response
    const userMessageIndex = lastAssistantIndex - 1;
    if (userMessageIndex < 0) return;
    
    const userMessageObj = messages[userMessageIndex];
    if (!userMessageObj || userMessageObj.role !== 'user') return;
    
    const userMessage = userMessageObj.content;
    // Delete the last assistant message server-side (no truncate)
    const lastAssistantMsg = messages[lastAssistantIndex];
    const lastAssistantId = lastAssistantMsg?.messageId;
    const prevMessages = messages;
    const messagesWithoutLastResponse = messages.slice(0, lastAssistantIndex);
    if (!lastAssistantId) {
      await mutateWithVariantPreservation();
      alert('Unable to redo: missing message id. Refreshed conversation.');
      return;
    }
    setMessages(messagesWithoutLastResponse);
    try {
      const delRes = await fetch(`/api/messages/${lastAssistantId}`, { method: 'DELETE' });
      if (!delRes.ok) throw new Error('Failed to delete last assistant message');
    } catch (error) {
      console.error('Failed to delete last assistant message:', error);
      setMessages(prevMessages);
      alert('Failed to regenerate response. Please try again.');
      return;
    }
    
    setLoading(true);

    // Get settings from database
    const settingsRes = await fetch('/api/settings');
    const settings = await settingsRes.json();
    
    const streamSetting = settings.stream === 'true';
    const defaultPromptId = settings.defaultPromptId ? Number(settings.defaultPromptId) : undefined;
  const tempSetting = settings.temperature ? parseFloat(settings.temperature) : 0.7;
  const maxTokensSetting = settings.maxTokens ? Math.max(256, Math.min(8192, parseInt(settings.maxTokens))) : 4096;
    
    setIsStreaming(streamSetting);
    
    let abortController: AbortController | undefined;
    if (streamSetting) {
      abortController = new AbortController();
      streamingAbortController.current = abortController;
    }

    // Generate new response
  const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        sessionId: Number(id), 
        userMessage: userMessage, 
        stream: streamSetting, 
        userPromptId: defaultPromptId,
        temperature: tempSetting,
        maxTokens: maxTokensSetting
      }),
      ...(streamSetting && abortController ? { signal: abortController.signal } : {})
    });

    if (!res.ok && (!streamSetting || !res.body)) {
      const errData = await safeJson(res as any);
  const raw = (errData?.__rawText || errData?.error?.message || errData?.error || res.statusText || 'Unknown error') as string;
      setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
      setShowErrorModal(true);
      setLoading(false);
      setIsStreaming(false);
      return;
    }

  const ct3 = res.headers.get('content-type') || '';
  const isSSE3 = ct3.includes('text/event-stream');
  if (streamSetting && res.body && isSSE3) {
      // Streaming response
      streamingMessageRef.current = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      
      try {
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          if (doneReading) {
            done = true;
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split(/\r?\n/).filter(l => l.startsWith('data: '));
          
          for (const line of lines) {
            const payload = line.replace(/^data: /, '').trim();
            
            if (payload === '[DONE]') {
              done = true;
              break;
            }
            
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.content || '';
              
              if (content) {
                streamingMessageRef.current += content;
                setMessages(prev => {
                  const copy = [...prev];
                  const lastMessage = copy[copy.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    lastMessage.content = streamingMessageRef.current;
                  }
                  return copy;
                });
      maybeStartStreamingFollow();
              }
            } catch (err: any) {
              if (err.name === 'AbortError') {
                // Streaming was stopped by user
                setLoading(false);
                setIsStreaming(false);
              } else {
                // Other error
                setLoading(false);
                setIsStreaming(false);
                setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(err?.message || 'Streaming error')));
                setShowErrorModal(true);
              }
            } finally {
              streamingAbortController.current = null;
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Streaming was stopped by user
          setLoading(false);
          setIsStreaming(false);
        } else {
          // Other error
          setLoading(false);
          setIsStreaming(false);
          if (streamingMessageRef.current && streamingMessageRef.current.length > 0) {
            console.warn('Redo stream ended early after partial content; no modal');
          } else {
            setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(err?.message || 'Streaming error')));
            setShowErrorModal(true);
          }
        }
      } finally {
        streamingAbortController.current = null;
    stopStreamingFollow();
      }
    } else {
      // Non-streaming response
      try {
        const data = await res.json();
        if (data.choices && data.choices[0]?.message?.content) {
          const assistantMsg: ChatMessage = { 
            role: 'assistant', 
            content: data.choices[0].message.content 
          };
          setMessages(prev => [...prev, assistantMsg]);
        } else if (data.error) {
          console.error('API Error:', data.error);
          setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(data.error))));
          setShowErrorModal(true);
        }
      } catch (error) {
        console.error('Failed to parse response:', error);
        setApiErrorMessage('Failed to get response from AI');
        setShowErrorModal(true);
      }
    }
    
    setLoading(false);
    setIsStreaming(false);
    setJustFinishedStreaming(true);
    streamingMessageRef.current = '';
    setTimeout(() => {
      if (editingMessageIndex === null) {
        scrollToBottom(false);
      }
    }, 100);
    if (streamSetting) {
      setTimeout(async () => {
        skipNextScroll.current = true;
        await mutate();
        setJustFinishedStreaming(false);
      }, 1000);
    } else {
      await mutate();
      setJustFinishedStreaming(false);
    }
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
    const settingsRes = await fetch('/api/settings');
    const settings = await settingsRes.json();
    const streamSetting = settings.stream === 'true';
    const defaultPromptId = settings.defaultPromptId ? Number(settings.defaultPromptId) : undefined;
  const tempSetting = settings.temperature ? parseFloat(settings.temperature) : 0.7;
  const maxTokensSetting = settings.maxTokens ? Math.max(256, Math.min(8192, parseInt(settings.maxTokens))) : 4096;
    setIsStreaming(streamSetting);

    let abortController: AbortController | undefined;
    if (streamSetting) {
      abortController = new AbortController();
      streamingAbortController.current = abortController;
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        sessionId: Number(id), 
        userMessage: formattedInput, 
        stream: streamSetting, 
        userPromptId: defaultPromptId,
        temperature: tempSetting,
        maxTokens: maxTokensSetting,
        retry: !!retryMessage // Pass retry flag when retrying
      }),
      ...(streamSetting && abortController ? { signal: abortController.signal } : {})
    });
    logMeta('[Send] Response meta', res as any);
  // Early non-stream failure handling with helpful note
    if (!res.ok) {
      const ct = res.headers.get('content-type') || '';
      const isSSE = ct.includes('text/event-stream');
      if (!streamSetting || !res.body || !isSSE) {
        const errData = await safeJson(res as any);
        const raw = (errData?.__rawText || errData?.error?.message || errData?.error || res.statusText || 'Unknown error') as string;
        const note = await buildRequestSizeNote();
        const baseMsg = sanitizeErrorMessage(extractUsefulError(String(raw)));
        setApiErrorMessage(note ? `${baseMsg}\n\n${note}` : baseMsg);
        setShowErrorModal(true);
        setLoading(false);
        setIsStreaming(false);
        return;
      }
    }

      // If success path: check truncation meta and decide whether to warn
      try {
        const sessionIdNum = Number(id);
        if (sessionIdNum && !Number.isNaN(sessionIdNum)) {
          const metaRes = await fetch(`/api/chat/request-log/meta/${sessionIdNum}`);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            const sentCount = Number(meta?.sentCount) || 0;
            const baseCount = Number(meta?.baseCount) || 0;
            const wasTruncated = !!meta?.wasTruncated;
            if (wasTruncated && sentCount <= 16) {
              const msg = `Context trimmed: sending ${sentCount} message${sentCount === 1 ? '' : 's'} (from ${baseCount}). Consider increasing Max Characters in Settings to preserve more history.`;
              setApiErrorMessage(msg);
              setShowErrorModal(true);
            }
          }
        }
      } catch {}

      // Also let the user know if the last response hit the Max Tokens limit (finish_reason = 'length').
      // Delay a bit to allow server to persist final response frames/body.
      setTimeout(async () => {
        const hitLimit = await checkMaxTokensHit();
        if (hitLimit) {
          const suffix = typeof (maxTokensSetting as any) === 'number' ? ` (${maxTokensSetting})` : '';
          const note = `Response stopped early: reached Max Tokens${suffix}. Increase Max Tokens in Settings or use Continue to resume.`;
          // If a modal is already open, append; else open a new one.
          if (showErrorModal && apiErrorMessage) {
            setApiErrorMessage(prev => `${prev}\n\n${note}`);
          } else {
            setApiErrorMessage(note);
            setShowErrorModal(true);
          }
        }
      }, 1200);
  const ct4 = res.headers.get('content-type') || '';
  const isSSE4 = ct4.includes('text/event-stream');
  if (streamSetting && res.body && isSSE4) {
      // add empty assistant placeholder
      streamingMessageRef.current = '';
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let chunkCount = 0;
      let byteCount = 0;
      
      try {
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          if (doneReading) {
            done = true;
            break;
          }
          
          const chunk = decoder.decode(value, { stream: true });
          chunkCount++;
          byteCount += value?.byteLength || 0;
          const lines = chunk.split(/\r?\n/).filter(l => l.startsWith('data: '));
          
          for (const line of lines) {
            const payload = line.replace(/^data: /, '').trim();
            
            if (payload === '[DONE]') {
              done = true;
              break;
            }
            
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.content || '';
              
              if (content) {
                streamingMessageRef.current += content;
                setMessages(prev => {
                  const copy = [...prev];
                  const lastMessage = copy[copy.length - 1];
                  if (lastMessage && lastMessage.role === 'assistant') {
                    lastMessage.content = streamingMessageRef.current;
                  }
                  return copy;
                });
    maybeStartStreamingFollow();
              } else if (payload !== '') {
                console.warn('[Send] Unexpected SSE payload (no content key):', payload.slice(0, 200));
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Streaming was stopped by user
          setLoading(false);
          setIsStreaming(false);
        } else {
          // Other error: show modal only if nothing streamed yet
          setLoading(false);
          setIsStreaming(false);
          if (streamingMessageRef.current && streamingMessageRef.current.length > 0) {
            console.warn('Send stream ended early after partial content; no modal');
          } else {
            setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(err?.message || 'Streaming error')));
            setShowErrorModal(true);
          }
        }
      } finally {
        streamingAbortController.current = null;
  console.log('[Send] Stream ended. chunks=', chunkCount, 'bytes=', byteCount, 'len=', streamingMessageRef.current.length);
  if (streamingMessageRef.current.length === 0) {
    console.warn('[Send] Stream finished with zero assistant content. Will trigger a mutate to refresh.');
    // If stream ended with zero content and response was not ok, surface error
    try {
      if (!res.ok) {
        const errData = await safeJson(res as any);
  const raw = (errData?.__rawText || errData?.error?.message || errData?.error || res.statusText || 'Unknown error') as string;
        setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(String(raw))));
        setShowErrorModal(true);
      }
    } catch {}
  }
  stopStreamingFollow();
      }
    } else {
      // non-stream: parse the response and add assistant message
      try {
        const data = await safeJson(res as any);
        console.log('[Send] Non-stream JSON received keys:', Object.keys(data || {}));
        if (data.choices && data.choices[0]?.message?.content) {
          const assistantMsg: ChatMessage = { 
            role: 'assistant', 
            content: data.choices[0].message.content 
          };
          setMessages(prev => [...prev, assistantMsg]);
        } else if ((data as any).content) {
          const assistantMsg: ChatMessage = { role: 'assistant', content: (data as any).content };
          setMessages(prev => [...prev, assistantMsg]);
        } else if ((data as any).error) {
          const err = (data as any).error;
          console.error('API Error:', err);
          // Show error modal
          setApiErrorMessage(sanitizeErrorMessage(extractUsefulError(err?.message || JSON.stringify(err))));
          setShowErrorModal(true);
        } else if ((data as any).__rawText) {
          console.warn('[Send] Non-JSON response body:', (data as any).__rawText.slice(0, 200));
        }
      } catch (error) {
        console.error('Failed to parse response:', error);
        setApiErrorMessage('Failed to get response from AI');
        setShowErrorModal(true);
      }
    }
    setLoading(false);
    setIsStreaming(false);
    setJustFinishedStreaming(true);
    setSkipNextMessageUpdate(true);
    streamingMessageRef.current = '';
  // Completed normally; no need to restore original input anymore
  shouldRestoreInputRef.current = false;
    
    // Final smooth scroll after streaming completes (but not during edit mode)
    setTimeout(() => {
      if (editingMessageIndex === null) {
        scrollToBottom(false);
      }
    }, 100);
    
    // For streaming: delay the database reload to avoid scroll stutter
    // For non-streaming: immediate reload
    // For retry: longer delay to avoid UI jump
    if (streamSetting) {
      setTimeout(async () => {
        skipNextScroll.current = true;
        await mutateWithVariantPreservation();
        setJustFinishedStreaming(false);
      }, retryMessage ? 1500 : 1000); // Longer delay for retry to let UI settle
    } else {
      // For non-streaming retry, also add a small delay
      if (retryMessage) {
        setTimeout(async () => {
          skipNextScroll.current = true;
          await mutateWithVariantPreservation();
          setJustFinishedStreaming(false);
        }, 500);
      } else {
        await mutateWithVariantPreservation();
        setJustFinishedStreaming(false);
      }
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

  // Load notes for the current session
  const loadNotes = async () => {
    if (!id) return;
    
    try {
      const response = await fetch(`/api/sessions/${id}/notes`);
      if (response.ok) {
        const data = await response.json();
        const notes = data.notes || '';
        setNotesContent(notes);
        setOriginalNotesContent(notes);
      } else if (response.status !== 404) {
        // 404 is expected if no notes exist yet
        console.error('Failed to load notes:', response.status);
      }
    } catch (error) {
      console.error('Failed to load notes:', error);
    }
  };

  // Save notes for the current session
  const saveNotes = async () => {
    if (!id) return;
    
    setSavingNotes(true);
    try {
      const response = await fetch(`/api/sessions/${id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesContent })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save notes');
      }
      
      // Update original content to current content after successful save
      // Don't close the modal - let user continue editing
      setOriginalNotesContent(notesContent);
    } catch (error) {
      console.error('Failed to save notes:', error);
      alert('Failed to save notes. Please try again.');
    } finally {
      setSavingNotes(false);
    }
  };

  // Cancel notes changes and revert to original content
  const cancelNotesChanges = () => {
    setNotesContent(originalNotesContent);
  };

  // Check if notes have been modified
  const hasNotesChanges = () => {
    return notesContent !== originalNotesContent;
  };

  // Smart scroll function that throttles during streaming
  const scrollToBottom = useCallback((immediate = false) => {
    if (!containerRef.current) return;
    if (editingMessageIndex !== null) return;
    if (!userPinnedBottomRef.current && !immediate) return; // respect manual upward scroll

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
        behavior: (immediate || forceAuto) ? 'auto' : (wantSmooth ? 'smooth' : 'auto')
      });
      if (forceNextSmoothRef.current) forceNextSmoothRef.current = false;
      lastScrollTime.current = now;
    } else if (timeSinceLastScroll > 100) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'auto'
      });
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
  }, [isStreaming, editingMessageIndex]);

  // Perform one-time initial scroll synchronously after messages first load (layout effect to avoid flicker)
  useLayoutEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (!containerRef.current) return;
    if (messages.length === 0) return;
    // Direct jump (no smooth) pre-paint
    try {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
      initialScrollDoneRef.current = true;
    } catch {}
  }, [messages.length]);

  // Maintain bottom anchoring by compensating for incremental height growth during streaming
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
      // Increase scrollTop by growth delta to keep bottom visually fixed
      const growth = cur - prev;
      const beforeDist = cur - growth - el.scrollTop - el.clientHeight;
      if (beforeDist < 4) {
        // Was at (or near) bottom before growth, so hard anchor
        el.scrollTop = cur - el.clientHeight;
      } else {
        // Adjust proportionally (rare path if not exactly at bottom but still flagged pinned)
        el.scrollTop = el.scrollTop + growth;
      }
    }
    prevScrollHeightRef.current = cur;
  }, [messages]);

  // Explicit handler for the jump-to-latest button (mirrors _bak implementation intent)
  const handleScrollToLatestClick = () => {
    // Mark user as pinned again so future auto-scrolls resume
    userPinnedBottomRef.current = true;
    suppressNextAutoScrollRef.current = false;
  forceNextSmoothRef.current = true;
  scrollToBottom(false);
  };
  
  // scroll to bottom whenever messages change
  useEffect(() => {
    if (skipNextScroll.current) {
      skipNextScroll.current = false;
      return;
    }
    
    // Don't auto-scroll when editing a message to prevent the textarea from jumping around
    if (editingMessageIndex !== null) {
      return;
    }
    
    scrollToBottom();
  }, [messages, scrollToBottom, editingMessageIndex]);
  
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
      
      {/* Header */}
      <header className="chat-header" ref={headerRef}>
        <div className="chat-header-compact">
          {/* Burger Menu Button */}
          <button 
            className="btn btn-secondary burger-menu-btn" 
            onClick={() => setIsBurgerMenuOpen(prev => !prev)}
            aria-label="Toggle nav menu"
          >
            {isBurgerMenuOpen ? '✖️' : '☰'}
          </button>
          
          {/* Chat Title */}
          <div className="chat-title-section">
            <h1 className="chat-title mb-2">
              <span className="persona-name">{session.persona.name}</span>
              <span className="title-separator">&</span>
              <span className="character-name">{session.character.name}</span>
            </h1>
          </div>
          
          {/* Invisible spacer to balance the burger button */}
          <div className="burger-menu-spacer" aria-hidden="true"></div>
        </div>
        
        {/* Burger Menu Content */}
        {isBurgerMenuOpen && (
          <div className="burger-menu-content">
            <div className="burger-menu-section">
              <div className="burger-menu-label">Navigation</div>
              <div className="burger-menu-buttons">
                <button 
                  className="btn btn-secondary btn-menu-item" 
                  onClick={() => {
                    router.push('/chat');
                    setIsBurgerMenuOpen(false);
                  }}
                >
                  💬 Chats
                </button>
                
                <button 
                  className="btn btn-secondary btn-menu-item" 
                  onClick={() => {
                    router.push('/');
                    setIsBurgerMenuOpen(false);
                  }}
                >
                  🏠 Home
                </button>
              </div>
            </div>
            
            <div className="burger-menu-section">
              <div className="burger-menu-label">Actions</div>
              <div className="burger-menu-buttons">
                <button 
                  className="btn btn-secondary btn-menu-item" 
                  onClick={() => {
                    setShowNotesModal(true);
                    setOriginalNotesContent(notesContent);
                    setIsBurgerMenuOpen(false);
                  }}
                >
                  📝 Notes
                </button>
                
                <button 
                  className="btn btn-secondary btn-menu-item" 
                  onClick={() => {
                    setShowSummaryModal(true);
                    setIsBurgerMenuOpen(false);
                  }}
                >
                  📄 Summary
                </button>
              </div>
            </div>
            
            {devMode && (
              <div className="burger-menu-section">
                <div className="burger-menu-label">Debug</div>
                <div className="burger-menu-buttons">
                  <button 
                    className="btn btn-secondary btn-small btn-menu-item" 
                    onClick={() => {
                      handleDownloadLog();
                      setIsBurgerMenuOpen(false);
                    }}
                  >
                    📁 Log
                  </button>
                  <button 
                    className="btn btn-secondary btn-small btn-menu-item" 
                    onClick={() => {
                      handleDownloadRequest();
                      setIsBurgerMenuOpen(false);
                    }}
                  >
                    🔧 Request
                  </button>
                  <button 
                    className="btn btn-secondary btn-small btn-menu-item" 
                    onClick={() => {
                      handleDownloadResponse();
                      setIsBurgerMenuOpen(false);
                    }}
                  >
                    🧾 Response
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

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
                      onFocus={(e) => {
                        // Prevent browser from scrolling to focus
                        e.preventDefault();
                        const container = containerRef.current;
                        if (container) {
                          const scrollTop = container.scrollTop;
                          // Restore scroll position after focus
                          requestAnimationFrame(() => {
                            container.scrollTop = scrollTop;
                          });
                        }
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
  {/* Chat Input (hidden on narrow screens while editing to maximize space) */}
  {!(isNarrowScreen && editingMessageIndex !== null) && (
  <div className="chat-input-container">
          <div className="flex gap-3">
            <textarea
              ref={textareaRef}
              className="form-textarea chat-input flex-1"
              value={input}
              onChange={e => { setInput(e.target.value); requestAnimationFrame(() => autoResizeTextarea()); }}
              placeholder="Type your message..."
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              disabled={loading}
              style={{ minHeight: '80px' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
              <button
                className="btn btn-secondary btn-small"
                style={{
                  width: '48px',
                  padding: '4px 0',
                  lineHeight: 1,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '2px',
                  visibility: showScrollToLatest ? 'visible' : 'hidden',
                  pointerEvents: showScrollToLatest ? 'auto' : 'none'
                }}
                onClick={showScrollToLatest ? handleScrollToLatestClick : undefined}
                aria-label="Scroll to latest messages"
                title="Scroll to latest"
                disabled={!showScrollToLatest}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {isStreaming || generatingVariant !== null ? (
                <button className="btn btn-danger chat-send-button" onClick={stopStreaming} title="Stop">🟥</button>
              ) : (
                <button className="btn btn-primary chat-send-button" onClick={() => handleSend()} disabled={loading || !input.trim()}>
                  {loading ? '⏳' : '📤'}
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-muted composer-hint">Press Enter to send, Shift+Enter for new line</div>
  </div>
  )}
      </div>

      {/* Summary Modal */}
      {showSummaryModal ? (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title">Chat Summary</h2>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Summary Content</label>
                <textarea
                  className="form-textarea"
                  value={summaryContent}
                  onChange={(e) => setSummaryContent(e.target.value)}
                  placeholder="Enter a summary of this chat session..."
                  rows={8}
                  style={{ minHeight: '200px' }}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <div className="flex gap-3 flex-wrap mb-3">
                <button
                  className="btn btn-secondary"
                  onClick={generateSummary}
                  disabled={generatingSummary}
                  title={generatingSummary ? "Generating summary..." : "Generate AI summary of the conversation"}
                >
                  {generatingSummary ? '⏳ Generating...' : '🤖 Generate Summary'}
                </button>
                <button
                  className={`btn btn-secondary ${!canUpdateSummary() ? 'btn-disabled-muted' : ''}`}
                  onClick={updateSummary}
                  disabled={updatingSummary || !canUpdateSummary()}
                  title={
                    !session?.summary
                      ? "Generate a summary first before updating"
                      : !session?.lastSummary 
                        ? "No summary update point set. Use 'Generate Summary' first."
                        : !canUpdateSummary() 
                          ? "No new messages to update summary with" 
                          : updatingSummary 
                            ? "Updating summary..." 
                            : "Update summary with new messages since last update"
                  }
                >
                  {updatingSummary ? '⏳ Updating...' : '🔄 Update Summary'}
                </button>
              </div>
              
              <div className="flex gap-3 flex-wrap">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowSummaryModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={saveSummary}
                  disabled={savingSummary}
                >
                  {savingSummary ? 'Saving...' : 'Save Summary'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Notes Modal - Overlay version for narrow screens */}
      {showNotesModal && !isWideScreen ? (
        <div className="modal-overlay notes-modal-overlay">
          <div className={`modal-content notes-modal`}>
            <div className="modal-header">
              <h2 className="modal-title">Chat Notes</h2>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Personal Notes</label>
                <textarea
                  className="form-textarea"
                  value={notesContent}
                  onChange={(e) => setNotesContent(e.target.value)}
                  placeholder="Write your personal notes here... These are private and never sent to the AI."
                  rows={12}
                  style={{ minHeight: '300px' }}
                />
                <div className="text-xs text-muted mt-1">
                  💡 Use this space to keep track of important details, ideas, or context as you chat.
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <div className="flex gap-3 flex-wrap mb-3">
                {hasNotesChanges() ? (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={cancelNotesChanges}
                    >
                      Cancel Changes
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={saveNotes}
                      disabled={savingNotes}
                    >
                      {savingNotes ? 'Saving...' : 'Save Changes'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowNotesModal(false)}
                    >
                      Close
                    </button>
                    <button
                      className="btn btn-secondary btn-disabled-muted"
                      disabled
                    >
                      No Changes
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Notes Modal - Sidecar version for wide screens */}
      {showNotesModal && isWideScreen ? (
        <div className="notes-modal-sidecar">
          <div className="modal-header">
            <h2 className="modal-title">Chat Notes</h2>
          </div>
          
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Personal Notes</label>
              <textarea
                className="form-textarea"
                value={notesContent}
                onChange={(e) => setNotesContent(e.target.value)}
                placeholder="Write your personal notes here... These are private and never sent to the AI."
              />
              <div className="text-xs text-muted mt-1">
                💡 Use this space to keep track of important details, ideas, or context as you chat.
              </div>
            </div>
          </div>
          
          <div className="modal-footer">
            <div className="flex gap-3 flex-wrap mb-3">
              {hasNotesChanges() ? (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={cancelNotesChanges}
                  >
                    Cancel Changes
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={saveNotes}
                    disabled={savingNotes}
                  >
                    {savingNotes ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowNotesModal(false)}
                  >
                    Close
                  </button>
                  <button
                    className="btn btn-secondary btn-disabled-muted"
                    disabled
                  >
                    No Changes
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && deleteMessageIndex !== null ? (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2 className="modal-title">🗑️ Delete Message</h2>
            </div>
            
            <div className="modal-body">
              {(() => {
                const messageCount = messages.length - deleteMessageIndex;
                return (
                  <div className="text-center">
                    <p className="mb-4">
                      {messageCount === 1 
                        ? 'Are you sure you want to delete this message?' 
                        : `Are you sure you want to delete this message and ${messageCount - 1} subsequent message(s)?`
                      }
                    </p>
                    <div className="text-sm text-muted mb-4">
                      <strong>⚠️ This action cannot be undone.</strong>
                    </div>
                    {messageCount > 1 && (
                      <div className="warning-box">
                        💡 Deleting this message will also remove all messages that come after it in the conversation.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            
            <div className="modal-footer">
              <div className="flex gap-3 justify-center">
                <button
                  className="btn btn-secondary"
                  onClick={cancelDeleteMessage}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={confirmDeleteMessage}
                >
                  Delete {messages.length - deleteMessageIndex === 1 ? 'Message' : 'Messages'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* API Error Modal */}
      {showErrorModal ? (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h2 className="modal-title">⚠️ API Error</h2>
            </div>

            <div className="modal-body">
              <p className="mb-4">The API encountered an error.</p>
              <div className="card card-compact" style={{ background: 'var(--bg-tertiary)' }}>
                <code style={{ whiteSpace: 'pre-wrap' }}>{apiErrorMessage}</code>
              </div>
            </div>

            <div className="modal-footer">
              <div className="flex gap-3 justify-center">
                <button className="btn btn-secondary" onClick={handleDownloadRequest}>
                  Download Last Request
                </button>
                <button className="btn btn-secondary" onClick={handleDownloadResponse}>
                  Download Last Response
                </button>
                <button className="btn btn-primary" onClick={() => setShowErrorModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Variant Temperature Popover (small floating modal) */}
      {variantTempPopover && variantTempPopover.messageId ? (
        <div
          className="popover-overlay"
          onClick={closeVariantTempPopover}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'transparent'
          }}
        >
          <div
            className="popover-content"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: Math.max(12, Math.min(window.innerWidth - 300, variantTempPopover.x - 140)),
              top: Math.max(12, variantTempPopover.y - 140),
              width: 280,
              padding: '14px 16px',
              borderRadius: '12px',
              background: 'rgba(20,20,28,0.9)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              color: 'var(--text-primary, #fff)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)'
            }}
          >
            {/* Arrow pointer removed per request */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 650, letterSpacing: 0.2 }}>🧬 Variant temperature</div>
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)'
                }}
              >{variantTempValue.toFixed(1)}</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>This applies to this variant only.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, opacity: 0.8, width: 24, textAlign: 'right' }}>0.0</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={variantTempValue}
                onChange={(e) => setVariantTempValue(parseFloat(e.target.value))}
                style={{ flex: 1, height: 28, accentColor: 'var(--primary, #7c5cff)' as any }}
              />
              <span style={{ fontSize: 12, opacity: 0.8, width: 24 }}>2.0</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-small" onClick={closeVariantTempPopover}>Cancel</button>
              <button className="btn btn-primary btn-small" onClick={sendVariantWithTemp}>Generate</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}