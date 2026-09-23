import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
const identity = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/app/api/auth/me/route', () => ({ GET: identity.get }));
const request = new NextRequest('http://localhost/api/apps/fuel-grid/status');
const params = { params: Promise.resolve({ appId: 'fuel-grid' }) };
beforeEach(() => {
  identity.get.mockResolvedValue(
    NextResponse.json({ data: { permissions: ['fuel_grid.access'] } }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('App connection authorization and health', () => {
  it.each([401, 403])(
    'does not probe a service for an unauthorized request (%s)',
    async (status) => {
      identity.get.mockResolvedValue(
        status === 401
          ? NextResponse.json({}, { status: 401 })
          : NextResponse.json({ data: { permissions: [] } }),
      );
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      expect((await GET(request, params)).status).toBe(status);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('requires the launch page and API health to both be reachable', async () => {
    vi.stubEnv('FUELGRID_APP_URL', 'https://fuel.example.test');
    vi.stubEnv('FUELGRID_HEALTH_URL', 'https://api.fuel.example.test/readyz');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) => new Response(null, { status: url.includes('api.') ? 200 : 503 }),
      ),
    );
    const response = await GET(request, params);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ configured: true, available: false });
  });
  it('rejects arbitrary app ids without making network requests', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect((await GET(request, { params: Promise.resolve({ appId: 'unknown' }) })).status).toBe(
      404,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
