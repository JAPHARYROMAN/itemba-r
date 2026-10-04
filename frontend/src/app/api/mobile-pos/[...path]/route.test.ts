// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';

vi.mock('@/lib/backend-url', () => ({ getBackendInternalUrl: () => 'http://backend.test/api/v1' }));
vi.mock('@/lib/server/refresh-coordinator', () => ({ coordinatedRefresh: vi.fn() }));
vi.mock('@/lib/server/mobile-pos-refresh', () => ({ refreshMobilePosSession: vi.fn() }));
import { refreshMobilePosSession } from '@/lib/server/mobile-pos-refresh';

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });
const request = (
  path: string,
  method = 'GET',
  cookies = '',
  headers: Record<string, string> = {},
) =>
  new NextRequest(`https://pos.test/api/mobile-pos/${path}`, {
    method,
    headers: { origin: 'https://pos.test', cookie: cookies, ...headers },
    ...(method !== 'GET' ? { body: '{}' } : {}),
  });
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('Restricted mobile POS proxy', () => {
  it('cannot tunnel direct stock or sales posting even with valid office cookies', async () => {
    for (const path of [
      'sales-orders',
      'inventory-movements',
      'auth/refresh',
      'mobile-pos-lite/sales',
    ]) {
      const response = await POST(
        request(path, 'POST', 'itemba_access=office; itemba_pos_csrf=csrf', {
          'x-csrf-token': 'csrf',
        }),
        ctx(path),
      );
      expect(response.status).toBe(403);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps PIN credentials in separate HttpOnly cookies and removes tokens from the phone response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      json({
        data: { accessToken: 'private-access', refreshToken: 'private-refresh', role: 'CASHIER' },
      }),
    );
    const response = await POST(
      request('mobile-pos-auth/login', 'POST', '', { 'x-itemba-pos': '1' }),
      ctx('mobile-pos-auth/login'),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { role: 'CASHIER' } });
    const cookies = response.headers.get('set-cookie')!;
    expect(cookies).toContain('itemba_pos_access=private-access');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).not.toContain('itemba_access=');
  });
  it('blocks cross-origin enrollment and protects captured draft submission with CSRF', async () => {
    const publicResponse = await POST(
      request('mobile-pos-auth/setup', 'POST', '', {
        origin: 'https://other.test',
        'x-itemba-pos': '1',
      }),
      ctx('mobile-pos-auth/setup'),
    );
    expect(publicResponse.status).toBe(403);
    const privateResponse = await POST(
      request('pos-drafts', 'POST', 'itemba_pos_access=staff; itemba_pos_csrf=csrf'),
      ctx('pos-drafts'),
    );
    expect(privateResponse.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the staff session when ordinary office cookies are also present', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ data: [] }));
    await GET(
      request('pos-drafts', 'GET', 'itemba_access=office; itemba_pos_access=staff'),
      ctx('pos-drafts'),
    );
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer staff');
  });
  it('refreshes a rejected staff session once with its bound device proof and does not retry a posting outcome', async () => {
    const proof = 'a'.repeat(64);
    vi.mocked(refreshMobilePosSession).mockResolvedValue({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ message: 'Expired' }, 401))
      .mockResolvedValueOnce(json({ message: 'Changed draft' }, 409));
    const response = await POST(
      request(
        'pos-drafts',
        'POST',
        'itemba_pos_access=expired; itemba_pos_refresh=refresh; itemba_pos_csrf=csrf',
        { 'x-csrf-token': 'csrf', 'x-mobile-pos-device': proof },
      ),
      ctx('pos-drafts'),
    );
    expect(refreshMobilePosSession).toHaveBeenCalledWith('refresh', proof);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(409);
  });
});
