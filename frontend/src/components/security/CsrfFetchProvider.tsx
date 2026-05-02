'use client';

import { useEffect } from 'react';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  const encoded = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encoded));

  return match ? decodeURIComponent(match.slice(encoded.length)) : null;
}

function shouldAttachCsrf(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return false;

  return isBackendProxyRequest(input);
}

function isBackendProxyRequest(input: RequestInfo | URL): boolean {
  const rawUrl = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
  const url = new URL(rawUrl, window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/backend/');
}

function withEmptyBodySafeJson(response: Response): Response {
  Object.defineProperty(response, 'json', {
    configurable: true,
    value: async () => {
      const text = await response.clone().text();
      if (!text.trim()) return {};
      return JSON.parse(text);
    },
  });
  return response;
}

export function CsrfFetchProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!shouldAttachCsrf(input, init)) {
        const response = await originalFetch(input, init);
        return isBackendProxyRequest(input) ? withEmptyBodySafeJson(response) : response;
      }

      const csrfToken = readCookie('itemba_csrf');
      let nextInit = init;
      if (!csrfToken) {
        const response = await originalFetch(input, init);
        return withEmptyBodySafeJson(response);
      }

      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      headers.set('x-csrf-token', csrfToken);
      nextInit = { ...init, headers };
      return withEmptyBodySafeJson(await originalFetch(input, nextInit));
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return <>{children}</>;
}
