import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import ProtectedRoute from '../components/ProtectedRoute';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  
  // Register service worker (no offline caching; placeholder only)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {/* silent */});
      }
    } else {
      // In dev, ensure any previously registered SW is removed to avoid HMR interference
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
      }
    }
  }, []);
  
  // Pages that don't require authentication
  const publicPages = ['/login', '/setup'];
  const isPublicPage = publicPages.includes(router.pathname);

  if (isPublicPage) {
    return <Component {...pageProps} />;
  }

  return (
    <ProtectedRoute>
      <div className="container">
        <Component {...pageProps} />
      </div>
    </ProtectedRoute>
  );
}