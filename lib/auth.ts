import jwt from 'jsonwebtoken';

// NOTE: Client utilities kept minimal; real auth enforced server-side via middleware/route checks.
// We do not expose JWT secret here; verification happens server-side. This file can offer a helper
// to trigger logout by calling the /api/auth/logout endpoint (to be added) if needed.

export function logout(): void {
  if (typeof window === 'undefined') return;
  // Call logout endpoint to clear cookie then redirect
  fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
    window.location.href = '/login';
  });
}

// Deprecated legacy functions (left as no-ops / always false until removed)
export function checkAuth(): boolean {
  return false; // Client no longer the source of truth; pages should rely on server validation.
}

export function verifyToken(_token: string): boolean {
  return true; // Stub retained for backward compatibility where imported; not used now.
}
