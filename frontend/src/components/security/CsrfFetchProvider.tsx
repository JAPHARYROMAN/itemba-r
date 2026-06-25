'use client';

import { useEffect } from 'react';
import { MANAGED_401_HEADER, SESSION_EXPIRED_EVENT } from '@/lib/api-client';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | null {
  const encoded = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encoded));

  return match ? decodeURIComponent(match.slice(encoded.length)) : null;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  return new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
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
      const backend = isBackendProxyRequest(input);

      let response: Response;
      if (shouldAttachCsrf(input, init)) {
        const csrfToken = readCookie('itemba_csrf');
        if (csrfToken) {
          const headers = requestHeaders(input, init);
          headers.set('x-csrf-token', csrfToken);
          response = await originalFetch(input, { ...init, headers });
        } else {
          response = await originalFetch(input, init);
        }
      } else {
        response = await originalFetch(input, init);
      }

      if (!backend) return response;

      // An unrecoverable backend 401 (the proxy already tried to refresh) ->
      // bounce to login even for pages that use raw fetch, so they no longer
      // surface a stale "Unauthorized". Requests api-client makes carry
      // MANAGED_401_HEADER and run their own refresh + retry + dispatch, so we
      // must not preempt their recovery here.
      if (response.status === 401 && !requestHeaders(input, init).has(MANAGED_401_HEADER)) {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      }
      return withEmptyBodySafeJson(response);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return <>{children}</>;
}
