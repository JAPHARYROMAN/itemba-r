import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CsrfFetchProvider } from './CsrfFetchProvider';

const nativeFetch = window.fetch;

function renderWithFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  window.fetch = fetchMock as unknown as typeof fetch;
  render(
    <CsrfFetchProvider>
      <div />
    </CsrfFetchProvider>,
  );
  return fetchMock;
}

describe('CsrfFetchProvider', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.fetch = nativeFetch;
    document.cookie = 'itemba_csrf=; Max-Age=0; path=/';
  });

  it('adds csrf headers to unsafe backend proxy requests', async () => {
    document.cookie = 'itemba_csrf=csrf-123; path=/';
    const fetchMock = renderWithFetch(new Response(JSON.stringify({ ok: true })));

    await waitFor(() => expect(window.fetch).not.toBe(fetchMock));
    await window.fetch('/api/backend/customers', { method: 'POST' });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-123');
  });

  it('keeps empty backend proxy responses from throwing SyntaxError on json()', async () => {
    const fetchMock = renderWithFetch(new Response('', { status: 502 }));

    await waitFor(() => expect(window.fetch).not.toBe(fetchMock));
    const response = await window.fetch('/api/backend/unavailable');

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({});
  });

  it('dispatches session-expired on an unrecoverable backend 401 (raw fetch)', async () => {
    const fetchMock = renderWithFetch(new Response('', { status: 401 }));
    const onExpired = vi.fn();
    window.addEventListener('itemba:session-expired', onExpired);

    await waitFor(() => expect(window.fetch).not.toBe(fetchMock));
    await window.fetch('/api/backend/sales-orders');

    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('itemba:session-expired', onExpired);
  });

  it('does NOT dispatch session-expired for api-client-managed 401s', async () => {
    const fetchMock = renderWithFetch(new Response('', { status: 401 }));
    const onExpired = vi.fn();
    window.addEventListener('itemba:session-expired', onExpired);

    await waitFor(() => expect(window.fetch).not.toBe(fetchMock));
    await window.fetch('/api/backend/sales-orders', {
      headers: { 'x-itemba-managed-401': '1' },
    });

    expect(onExpired).not.toHaveBeenCalled();
    window.removeEventListener('itemba:session-expired', onExpired);
  });

  it('ignores 401s from non-backend (e.g. /api/auth) requests', async () => {
    const fetchMock = renderWithFetch(new Response('', { status: 401 }));
    const onExpired = vi.fn();
    window.addEventListener('itemba:session-expired', onExpired);

    await waitFor(() => expect(window.fetch).not.toBe(fetchMock));
    await window.fetch('/api/auth/login', { method: 'POST' });

    expect(onExpired).not.toHaveBeenCalled();
    window.removeEventListener('itemba:session-expired', onExpired);
  });
});
