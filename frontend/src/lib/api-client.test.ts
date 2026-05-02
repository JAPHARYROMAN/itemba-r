import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  backendGet,
  backendList,
  backendPage,
  backendPost,
  buildQuery,
  normalizePaginated,
  unwrapApiPayload,
} from './api-client';

function jsonResponse(payload: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('api-client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.cookie = 'itemba_csrf=; Max-Age=0; path=/';
  });

  it('builds query strings without nullish or empty values', () => {
    expect(
      buildQuery({
        page: 2,
        search: 'fuel',
        active: true,
        empty: '',
        missing: null,
        skipped: undefined,
      }),
    ).toBe('?page=2&search=fuel&active=true');
  });

  it('unwraps standard API envelopes', () => {
    expect(
      unwrapApiPayload<{ id: string }>({
        success: true,
        timestamp: '2026-05-02T00:00:00.000Z',
        data: { id: 'a1' },
      }),
    ).toEqual({ id: 'a1' });
  });

  it('normalizes array payloads into paginated shape', () => {
    expect(normalizePaginated([{ id: 1 }, { id: 2 }])).toEqual({
      data: [{ id: 1 }, { id: 2 }],
      total: 2,
      page: 1,
      limit: 2,
      totalPages: 1,
    });
  });

  it('reads backend lists and pages through the safe proxy client', async () => {
    const payload = {
      success: true,
      data: {
        data: [{ id: 'a' }],
        total: 1,
        page: 2,
        limit: 20,
        totalPages: 3,
      },
    };
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload))
      .mockResolvedValueOnce(jsonResponse(payload));

    await expect(backendList<{ id: string }>('/customers')).resolves.toEqual([{ id: 'a' }]);
    await expect(backendPage<{ id: string }>('/customers')).resolves.toMatchObject({
      data: [{ id: 'a' }],
      total: 1,
      page: 2,
      limit: 20,
      totalPages: 3,
    });
  });

  it('adds CSRF headers for unsafe backend proxy requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, data: { ok: true } }));
    document.cookie = 'itemba_csrf=csrf-123; path=/';

    await expect(backendPost<{ ok: boolean }>('/expenses', { amount: 10 })).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/backend/expenses',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ amount: 10 }),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-csrf-token': 'csrf-123',
        }),
      }),
    );
  });

  it('throws ApiError with backend validation messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ message: ['name is required', 'amount must be positive'] }, { status: 400 }),
    );

    await expect(backendPost('/expenses', {})).rejects.toMatchObject<ApiError>({
      name: 'ApiError',
      status: 400,
      message: 'name is required, amount must be positive',
    });
  });

  it('throws ApiError instead of SyntaxError for empty failed responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));

    await expect(backendGet('/customers')).rejects.toMatchObject<ApiError>({
      name: 'ApiError',
      status: 502,
      message: 'Request failed: 502',
    });
  });
});
