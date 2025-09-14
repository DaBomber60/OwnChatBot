import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupMessage, setSetupMessage] = useState('');
  const router = useRouter();

  useEffect(() => {
    // Check if already authenticated via cookie
    const check = async () => {
      try {
        const res = await fetch('/api/auth/verify', { method: 'POST' });
        if (res.ok) {
          router.push('/');
          return;
        }
      } catch {}

      if (router.query.setup === 'complete') {
        setSetupMessage('Setup completed successfully! Please sign in with your new password.');
      }

      // Check if initial setup is needed
      const checkSetup = async () => {
        try {
          const response = await fetch('/api/auth/setup');
          const data = await response.json();
          
          if (!data.isSetup) {
            router.push('/setup');
          }
        } catch (error) {
          console.error('Setup check failed:', error);
        }
      };

      checkSetup();
    };
    check();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push('/');
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - OwnChatBot</title>
        <meta name="description" content="Access your OwnChatBot" />
      </Head>

      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6" style={{ minHeight: '100vh' }}>
        <div className="card w-full max-w-md mx-auto" style={{ minHeight: 'fit-content' }}>
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-primary">🤖 OwnChatBot</h1>
            <p className="text-secondary">Enter your access password</p>
          </div>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={loading}
                autoFocus
              />
            </div>

            {setupMessage && (
              <div className="mb-4 p-3 bg-success/10 border border-success/20 rounded-lg">
                <p className="text-success text-sm">{setupMessage}</p>
              </div>
            )}

            {error && (
              <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg">
                <p className="text-error text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              className={`btn btn-primary w-full ${loading ? 'opacity-50' : ''}`}
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="status-dot status-loading"></div>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="text-center mt-6">
            <p className="text-xs text-muted">
              Don&apos;t have access? Contact your administrator.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
