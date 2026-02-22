import React from 'react';
import { useRouter } from 'next/router';

interface ChatHeaderProps {
  session: { persona: { name: string }; character: { name: string } };
  isBurgerMenuOpen: boolean;
  setIsBurgerMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  devMode: boolean;
  notesContent: string;
  headerRef: React.Ref<HTMLElement>;
  onOpenNotes: () => void;
  onOpenSummary: () => void;
  onDownloadLog: () => void;
  onDownloadRequest: () => void;
  onDownloadResponse: () => void;
}

export function ChatHeader({
  session, isBurgerMenuOpen, setIsBurgerMenuOpen, devMode,
  headerRef, onOpenNotes, onOpenSummary,
  onDownloadLog, onDownloadRequest, onDownloadResponse,
}: ChatHeaderProps) {
  const router = useRouter();

  return (
    <header className="chat-header" ref={headerRef}>
      <div className="chat-header-compact">
        <button
          className="btn btn-secondary burger-menu-btn"
          onClick={() => setIsBurgerMenuOpen(prev => !prev)}
          aria-label="Toggle nav menu"
        >
          {isBurgerMenuOpen ? '✖️' : '☰'}
        </button>

        <div className="chat-title-section">
          <h1 className="chat-title mb-2">
            <span className="persona-name">{session.persona.name}</span>
            <span className="title-separator">&amp;</span>
            <span className="character-name">{session.character.name}</span>
          </h1>
        </div>

        <div className="burger-menu-spacer" aria-hidden="true"></div>
      </div>

      {isBurgerMenuOpen && (
        <div className="burger-menu-content">
          <div className="burger-menu-section">
            <div className="burger-menu-label">Navigation</div>
            <div className="burger-menu-buttons">
              <button className="btn btn-secondary btn-menu-item" onClick={() => { router.push('/chat'); setIsBurgerMenuOpen(false); }}>
                💬 Chats
              </button>
              <button className="btn btn-secondary btn-menu-item" onClick={() => { router.push('/'); setIsBurgerMenuOpen(false); }}>
                🏠 Home
              </button>
            </div>
          </div>

          <div className="burger-menu-section">
            <div className="burger-menu-label">Actions</div>
            <div className="burger-menu-buttons">
              <button className="btn btn-secondary btn-menu-item" onClick={() => { onOpenNotes(); setIsBurgerMenuOpen(false); }}>
                📝 Notes
              </button>
              <button className="btn btn-secondary btn-menu-item" onClick={() => { onOpenSummary(); setIsBurgerMenuOpen(false); }}>
                📄 Summary
              </button>
            </div>
          </div>

          {devMode && (
            <div className="burger-menu-section">
              <div className="burger-menu-label">Debug</div>
              <div className="burger-menu-buttons">
                <button className="btn btn-secondary btn-small btn-menu-item" onClick={() => { onDownloadLog(); setIsBurgerMenuOpen(false); }}>
                  📁 Log
                </button>
                <button className="btn btn-secondary btn-small btn-menu-item" onClick={() => { onDownloadRequest(); setIsBurgerMenuOpen(false); }}>
                  🔧 Request
                </button>
                <button className="btn btn-secondary btn-small btn-menu-item" onClick={() => { onDownloadResponse(); setIsBurgerMenuOpen(false); }}>
                  🧾 Response
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
