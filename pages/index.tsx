import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { fetcher } from '../lib/fetcher';
import { formatRelativeTime, textSnippet } from '../lib/displayFormat';
import type { Session } from '../types/models';

const RECENT_COUNT = 3;

const TILES = [
  { href: '/personas', icon: '👤', title: 'Personas', desc: 'How you present yourself in conversations' },
  { href: '/characters', icon: '🎭', title: 'Characters', desc: 'AI characters with their own personalities' },
  { href: '/lorebooks', icon: '📖', title: 'Lorebooks', desc: 'World info that joins chats when relevant' },
  { href: '/import', icon: '📥', title: 'Import', desc: 'Bring in characters, personas and chats' },
  { href: '/settings', icon: '⚙️', title: 'Settings', desc: 'API keys, prompts and preferences' },
];

/** Two-letter monogram from a name, ignoring punctuation like quotes. */
function initials(name: string): string {
  const words = name.split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** Stable per-character gradient so the same character always gets the same colour. */
function avatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 65% 38%))`;
}

function RecentChatCard({ session, now }: { session: Session; now: number }) {
  const snippet = textSnippet(session.description);
  const profiles = [session.persona.profileName, session.character.profileName].filter(Boolean).join(' & ');
  const updated = new Date(session.updatedAt);
  return (
    <Link href={`/chat/${session.id}`} className="recent-card">
      <div className="recent-card-top">
        <div className="recent-avatar" style={{ background: avatarGradient(session.character.name) }} aria-hidden="true">
          {initials(session.character.name)}
        </div>
        <div className="recent-card-heading">
          <h3 className="recent-card-title">{session.character.name}</h3>
          <p className="recent-card-sub">with {session.persona.name}{profiles ? ` · ${profiles}` : ''}</p>
        </div>
      </div>
      <p className={`recent-card-desc${snippet ? '' : ' recent-card-desc--empty'}`}>
        {snippet || 'No description yet'}
      </p>
      <div className="recent-card-meta">
        <div className="recent-card-meta-stats">
          <time dateTime={updated.toISOString()} title={updated.toLocaleString()}>
            🕒 {formatRelativeTime(updated, now)}
          </time>
          <span>💬 {session.messageCount.toLocaleString()}</span>
        </div>
        <span className="recent-card-continue">Continue</span>
      </div>
    </Link>
  );
}

function RecentChatSkeleton() {
  return (
    <div className="recent-card" aria-hidden="true">
      <div className="recent-card-top">
        <div className="skeleton skeleton-avatar" />
        <div style={{ flex: 1 }}>
          <div className="skeleton skeleton-line mb-2" style={{ width: '60%' }} />
          <div className="skeleton skeleton-line" style={{ width: '40%' }} />
        </div>
      </div>
      <div className="skeleton skeleton-line" style={{ width: '95%' }} />
      <div className="skeleton skeleton-line" style={{ width: '80%' }} />
      <div className="skeleton skeleton-line" style={{ width: '35%', marginTop: 'auto' }} />
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { data: sessions, isLoading: sessionsLoading } = useSWR<Session[]>(
    `/api/sessions?limit=${RECENT_COUNT}&sort=updatedAt`,
    fetcher,
    { revalidateOnFocus: true, dedupingInterval: 0, keepPreviousData: false }
  );
  // Fetch global settings to determine if an API key exists or the reminder was dismissed
  const { data: settings, mutate: mutateSettings } = useSWR<Record<string, string> | { error?: string }>(
    '/api/settings',
    fetcher
  );

  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  // Re-render periodically so "just now" ages without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const hasAnyApiKey = useMemo(() => {
    if (!settings || 'error' in settings) return false;
    return Object.entries(settings).some(([k, v]) => k.startsWith('apiKey') && (v || '').trim().length > 0);
  }, [settings]);

  const hideFlag = settings && !('error' in settings) && (settings as Record<string, string>).hideApiKeySetup === 'true';
  const showApiKeyBanner = !!settings && !('error' in settings) && !hasAnyApiKey && !hideFlag && !dismissedThisSession;

  async function persistHideFlag() {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hideApiKeySetup: true })
      });
      mutateSettings();
    } catch {
      // Silently ignore – non-critical
    }
  }

  function closeBanner(navigateToSettings: boolean) {
    if (dontShowAgain) persistHideFlag();
    setDismissedThisSession(true);
    if (navigateToSettings) router.push('/settings');
  }

  const recent = Array.isArray(sessions) ? sessions.slice(0, RECENT_COUNT) : [];

  return (
    <>
      <Head>
        <title>OwnChatBot - AI Character Conversations</title>
        <meta name="description" content="Chat with AI characters using different personas. Create immersive conversations with custom characters and personalities." />
      </Head>

      <div className="home">
        <section className="home-hero">
          <h1 className="home-title">OwnChatBot</h1>
          <p className="home-tagline">Create engaging conversations with AI characters using personalized personas</p>
          <div className="home-hero-actions">
            <Link href="/chat" className="btn btn-primary btn-large">🚀 Start a Chat</Link>
          </div>
        </section>

        {showApiKeyBanner && (
          <section className="alert alert-warning" role="alert">
            <div className="alert-icon" aria-hidden="true">⚠️</div>
            <div className="alert-body">
              <h2 className="alert-title">Set up your AI provider</h2>
              <p>
                No API key detected, so chats can&apos;t generate replies yet. Add a key for DeepSeek, OpenAI,
                OpenRouter or a custom OpenAI-compatible endpoint in Settings.
              </p>
              <ol>
                <li>Open Settings</li>
                <li>Pick a provider (or Custom)</li>
                <li>Paste your API key (and an optional model)</li>
                <li>Save and start chatting 🚀</li>
              </ol>
              <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={dontShowAgain}
                  onChange={e => setDontShowAgain(e.target.checked)}
                />
                Don&apos;t show this again
              </label>
              <div className="alert-actions">
                <button className="btn btn-warning" onClick={() => closeBanner(true)}>Go to Settings</button>
                <button className="btn btn-secondary" onClick={() => closeBanner(false)}>Dismiss</button>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="home-section-header">
            <h2 className="home-section-title">Pick up where you left off</h2>
            {recent.length > 0 && <Link href="/chat" className="home-section-link">All chats →</Link>}
          </div>
          <div className="recent-grid">
            {sessionsLoading && !sessions ? (
              Array.from({ length: RECENT_COUNT }, (_, i) => <RecentChatSkeleton key={i} />)
            ) : recent.length > 0 ? (
              recent.map(session => <RecentChatCard key={session.id} session={session} now={now} />)
            ) : (
              <div className="recent-empty">
                <p className="text-secondary mb-4">No conversations yet. Pick a character and persona to begin.</p>
                <Link href="/chat" className="btn btn-primary">Start your first chat</Link>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="home-section-header">
            <h2 className="home-section-title">Studio</h2>
          </div>
          <nav className="home-tiles" aria-label="Studio">
            {TILES.map(tile => (
              <Link key={tile.href} href={tile.href} className="home-tile">
                <span className="home-tile-icon" aria-hidden="true">{tile.icon}</span>
                <span className="home-tile-title">{tile.title}</span>
                <span className="home-tile-desc">{tile.desc}</span>
              </Link>
            ))}
          </nav>
        </section>
      </div>
    </>
  );
}
