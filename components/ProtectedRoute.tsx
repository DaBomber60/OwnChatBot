import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'authed' | 'unauthed'>('loading');

  useEffect(() => {
    let cancelled = false;
    const verify = async () => {
      try {
        const res = await fetch('/api/auth/verify', { method: 'POST' });
        if (!cancelled) {
          if (res.ok) {
            setStatus('authed');
          } else {
            setStatus('unauthed');
            router.push('/login');
          }
        }
      } catch {
        if (!cancelled) {
          setStatus('unauthed');
          router.push('/login');
        }
      }
    };
    verify();
    return () => { cancelled = true; };
  }, [router]);

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
