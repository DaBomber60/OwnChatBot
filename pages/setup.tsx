import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function SetupPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAlreadySetup, setIsAlreadySetup] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check if setup is already complete
    const checkSetup = async () => {
      try {
        const response = await fetch('/api/auth/setup');
        const data = await response.json();
        
        if (data.isSetup) {
          setIsAlreadySetup(true);
          router.push('/login');
        }
      } catch (error) {
        console.error('Setup check failed:', error);
      }
    };

    checkSetup();
  }, [router]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      setError('Please enter a password');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push('/login?setup=complete');
      } else {
        setError(data.error || 'Setup failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (isAlreadySetup) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6" style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="status-indicator">
            <div className="status-dot status-loading"></div>
            Redirecting to login...
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Setup - OwnChatBot</title>
        <meta name="description" content="Initial setup for OwnChatBot" />
      </Head>

      <div className="min-h-screen flex items-center justify-center p-4 sm:p-6" style={{ minHeight: '100vh' }}>
        <div className="card w-full max-w-md mx-auto" style={{ minHeight: 'fit-content' }}>
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-primary">🔧 Initial Setup</h1>
            <p className="text-secondary">Set up your access password for OwnChatBot</p>
          </div>

          <form onSubmit={handleSetup}>
            <div className="form-group">
              <label className="form-label">Access Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a secure password (min 6 chars)"
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                disabled={loading}
              />
            </div>

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
                  Setting up...
                </span>
              ) : (
                'Complete Setup'
              )}
            </button>
          </form>

          <div className="text-center mt-6">
            <p className="text-xs text-muted">
              This password will be required to access your OwnChatBot.
              <br />
              You can change it later in the settings.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
