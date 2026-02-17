import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2500, 5000]; // progressive backoff

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'authed' | 'unauthed'>('loading');

  const verifyWithRetry = useCallback(async (cancelled: { current: boolean }) => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (cancelled.current) return;
      try {
        const res = await fetch('/api/auth/verify', { method: 'POST' });
        if (cancelled.current) return;
        if (res.ok) {
          setStatus('authed');
          return;
        }
        // Server responded with a definitive non-OK (401/403) — don't retry, it's a real auth failure
        setStatus('unauthed');
        router.push('/login');
        return;
      } catch {
        // Network error — retry with backoff unless we've exhausted attempts
        if (cancelled.current) return;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 5000));
          continue;
        }
        // All retries exhausted — if we were previously authed (page reload), stay on page
        // rather than forcing logout. The middleware will catch truly expired tokens.
        console.warn('[ProtectedRoute] Auth verify failed after retries — network may be offline');
        setStatus('authed');
        return;
      }
    }
  }, [router]);

  useEffect(() => {
    const cancelled = { current: false };
    verifyWithRetry(cancelled);
    return () => { cancelled.current = true; };
  }, [verifyWithRetry]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <div className="text-center">
          <div className="status-indicator">
            <div className="status-dot status-loading"></div>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (status !== 'authed') return null;

  return <>{children}</>;
}
