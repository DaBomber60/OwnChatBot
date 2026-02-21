import React from 'react';

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  loading: boolean;
  isStreaming: boolean;
  generatingVariant: number | null;
  isNarrowScreen: boolean;
  editingMessageIndex: number | null;
  showScrollToLatest: boolean;
  textareaRef: React.Ref<HTMLTextAreaElement>;
  autoResizeTextarea: () => void;
  onSend: () => void;
  onStop: () => void;
  onScrollToLatest: () => void;
}

export function ChatInput({
  input, setInput, loading, isStreaming, generatingVariant,
  isNarrowScreen, editingMessageIndex, showScrollToLatest,
  textareaRef, autoResizeTextarea, onSend, onStop, onScrollToLatest,
}: ChatInputProps) {
  // Hidden on narrow screens while editing
  if (isNarrowScreen && editingMessageIndex !== null) return null;

  return (
    <div className="chat-input-container">
      <div className="flex gap-3">
        <textarea
          ref={textareaRef}
          className="form-textarea chat-input flex-1"
          value={input}
          onChange={(e) => { setInput(e.target.value); requestAnimationFrame(() => autoResizeTextarea()); }}
          placeholder="Type your message..."
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
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
              pointerEvents: showScrollToLatest ? 'auto' : 'none',
            }}
            onClick={showScrollToLatest ? onScrollToLatest : undefined}
            aria-label="Scroll to latest messages"
            title="Scroll to latest"
            disabled={!showScrollToLatest}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {isStreaming || generatingVariant !== null ? (
            <button className="btn btn-danger chat-send-button" onClick={onStop} title="Stop">🟥</button>
          ) : (
            <button className="btn btn-primary chat-send-button" onClick={onSend} disabled={loading || !input.trim()}>
              {loading ? '⏳' : '📤'}
            </button>
          )}
        </div>
      </div>
      <div className="text-xs text-muted composer-hint">Press Enter to send, Shift+Enter for new line</div>
    </div>
  );
}
