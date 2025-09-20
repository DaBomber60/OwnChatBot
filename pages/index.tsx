import Head from 'next/head';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { useState, useMemo } from 'react';

// Session data shape
type Session = { 
  id: number; 
  persona: { name: string; profileName?: string }; 
  character: { name: string; profileName?: string }; 
  updatedAt: string; 
  messageCount: number 
};

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function Home() {
  const router = useRouter();
  const { data: sessions } = useSWR<Session[] | { error?: string }>(
    '/api/sessions',
    fetcher
  );
  // Fetch global settings to determine if an API key exists or the reminder was dismissed
  const { data: settings, mutate: mutateSettings } = useSWR<Record<string, string> | { error?: string }>(
    '/api/settings',
    fetcher
  );

  // Local UI state for modal dismissal and checkbox
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  const hasAnyApiKey = useMemo(() => {
    if (!settings || 'error' in settings) return false;
    return Object.entries(settings).some(([k, v]) => k.startsWith('apiKey') && (v || '').trim().length > 0);
  }, [settings]);

  const hideFlag = settings && !('error' in settings) && (settings as Record<string,string>).hideApiKeySetup === 'true';
  const showApiKeyModal = !!settings && !('error' in settings) && !hasAnyApiKey && !hideFlag && !dismissedThisSession;

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

  function closeModal(navigateToSettings: boolean) {
    if (dontShowAgain) persistHideFlag();
    setDismissedThisSession(true);
    if (navigateToSettings) router.push('/settings');
  }
  const recent = Array.isArray(sessions)
    ? [...sessions]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 3)
    : [];

  return (
    <>
      <Head>
        <title>OwnChatBot - AI Character Conversations</title>
        <meta name="description" content="Chat with AI characters using different personas. Create immersive conversations with custom characters and personalities." />
      </Head>

      <div className="container">
        {/* Inline first-time API key guidance (above Conversations card) */}
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-6">OwnChatBot</h1>
          <p className="text-secondary text-lg">
            Create engaging conversations with AI characters using personalized personas
          </p>
        </header>

        {/* Recent Chats */}
        {recent.length > 0 && (
          <section className="mb-6">
            <h2 className="text-2xl font-semibold mb-6">Recent Conversations</h2>
            <div className="grid grid-auto-fit gap-6">
              {recent.map(session => (
                <div 
                  key={session.id} 
                  className="card card-compact cursor-pointer text-center"
                  onClick={() => router.push(`/chat/${session.id}`)}
                >
                  <div className="card-header">
                    <h3 className="card-title text-base">
                      {session.persona.name} & {session.character.name}
                    </h3>
                    {(session.persona.profileName || session.character.profileName) ? (
                      <p className="text-xs text-muted mb-0">
                        {session.persona.profileName && session.character.profileName 
                          ? `${session.persona.profileName} & ${session.character.profileName}`
                          : session.persona.profileName || session.character.profileName
                        }
                      </p>
                    ) : (
                      <div className="mb-1" style={{ height: '15px' }}></div>
                    )}
                    <p className="card-description mb-4">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted mb-0">
                      💬 {session.messageCount} message{session.messageCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-primary font-medium">
                    Continue Chat
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Main Actions */}
        <section className="mb-8">
          <div className="grid gap-6">
            {showApiKeyModal && (
              <div className="card border border-warning/30 bg-warning/10">
                <div className="card-header">
                  <h2 className="card-title">🔑 Set Up Your AI Provider</h2>
                  <p className="card-description">No API key detected – configure one to enable AI responses.</p>
                </div>
                <div className="space-y-4 text-sm leading-relaxed">
                  <p>
                    Head over to <strong>Settings</strong> to add an API key for your preferred provider (DeepSeek, OpenAI, OpenRouter, Anthropic, or a custom-compatible endpoint). Without a key, chats can&apos;t generate responses.
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-muted">
                    <li>Open Settings</li>
                    <li>Select a provider (or Custom)</li>
                    <li>Paste your API key (and optional model override)</li>
                    <li>Save and start chatting 🚀</li>
                  </ol>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={dontShowAgain}
                      onChange={e => setDontShowAgain(e.target.checked)}
                    />
                    <span>Don&apos;t show this again</span>
                  </label>
                </div>
                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <button
                    className="btn btn-primary flex-1"
                    onClick={() => closeModal(true)}
                  >
                    Go to Settings
                  </button>
                  <button
                    className="btn btn-secondary flex-1"
                    onClick={() => closeModal(false)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {/* Start New Chat - Hero Action */}
            <div 
              className="card text-center cursor-pointer"
              onClick={() => router.push('/chat')}
            >
              <h3 className="text-2xl font-semibold mb-4">🚀 Conversations</h3>
              <p className="text-secondary text-sm mb-6">
                Begin a fresh chat with any character and persona combination, or revisit existing chats.
              </p>
              <div className="text-primary font-medium">
                Start Chatting
              </div>
            </div>

            {/* Management Actions */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div 
                className="card text-center cursor-pointer"
                onClick={() => router.push('/personas')}
              >
                <h4 className="text-lg font-semibold mb-4">👤 Personas</h4>
                <p className="text-secondary text-sm mb-6">
                  Manage how you present yourself in conversations
                </p>
                <div className="text-primary font-medium">
                  Manage Personas
                </div>
              </div>

              <div 
                className="card text-center cursor-pointer"
                onClick={() => router.push('/characters')}
              >
                <h4 className="text-lg font-semibold mb-4">🎭 Characters</h4>
                <p className="text-secondary text-sm mb-6">
                  Create and edit AI characters with unique personalities
                </p>
                <div className="text-primary font-medium">
                  Manage Characters
                </div>
              </div>

              <div 
                className="card text-center cursor-pointer"
                onClick={() => router.push('/import')}
              >
                <h4 className="text-lg font-semibold mb-4">📥 Import</h4>
                <p className="text-secondary text-sm mb-6">
                  Import characters, personas, and chats from external tools
                </p>
                <div className="text-primary font-medium">
                  Import Data
                </div>
              </div>

              <div 
                className="card text-center cursor-pointer"
                onClick={() => router.push('/settings')}
              >
                <h4 className="text-lg font-semibold mb-4">⚙️ Settings</h4>
                <p className="text-secondary text-sm mb-6">
                  Configure API keys, prompts, and preferences
                </p>
                <div className="text-primary font-medium">
                  Open Settings
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quick Stats */}
  {Array.isArray(sessions) && sessions.length > 0 && (
          <section className="text-center">
            <div className="inline-flex items-center gap-4 text-sm text-muted">
              <span className="flex items-center gap-2">
                <div className="status-dot status-online"></div>
                {Array.isArray(sessions) ? sessions.length : 0} total conversations
              </span>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
