'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AuthProvider, useAuthContext } from '@/contexts/auth-context';
import { CsrfFetchProvider } from '@/components/security/CsrfFetchProvider';
import { SESSION_EXPIRED_EVENT } from '@/lib/api-client';

function FuelGate({ children }: { children: React.ReactNode }) {
  const { user, loading, authOffline } = useAuthContext();
  const router = useRouter();
  const expiring = useRef(false);

  useEffect(() => {
    const markExpired = () => {
      expiring.current = true;
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, markExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, markExpired);
  }, []);

  useEffect(() => {
    if (!loading && !user && !authOffline && !expiring.current) {
      const from = window.location.pathname + window.location.search;
      if (window.location.pathname !== '/fuel-reporting/login') {
        router.replace(`/fuel-reporting/login?from=${encodeURIComponent(from)}`);
      }
    }
  }, [loading, user, authOffline, router]);

  if (!user)
    return (
      <div className="fp-access" role="status">
        <h1>{authOffline ? 'Unable to connect' : 'Opening Fuel Reporting'}</h1>
        <p>
          {authOffline
            ? 'Check your connection and retry to open your station records.'
            : 'Checking your station access…'}
        </p>
        {authOffline && (
          <button type="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </div>
    );
  return <CsrfFetchProvider>{children}</CsrfFetchProvider>;
}

export function FuelAccess({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider loginPath="/fuel-reporting/login">
      <FuelGate>{children}</FuelGate>
    </AuthProvider>
  );
}
