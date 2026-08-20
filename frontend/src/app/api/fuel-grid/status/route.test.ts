import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Fuel Grid status route', () => {
  it('reports an unconfigured launcher without making a request', async () => {
    vi.stubEnv('FUELGRID_APP_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();
    expect(await response.json()).toMatchObject({
      configured: false,
      available: false,
      latencyMs: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an available independent application', async () => {
    vi.stubEnv('FUELGRID_APP_URL', 'https://fuelgrid.example.com');
    vi.stubEnv('FUELGRID_HEALTH_URL', 'https://api.fuelgrid.example.com/readyz');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();
    expect(await response.json()).toMatchObject({ configured: true, available: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.fuelgrid.example.com/readyz',
      expect.objectContaining({ method: 'GET', cache: 'no-store', redirect: 'manual' }),
    );
  });

  it('keeps status failures advisory instead of throwing', async () => {
    vi.stubEnv('FUELGRID_APP_URL', 'https://fuelgrid.example.com');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    const response = await GET();
    expect(await response.json()).toMatchObject({ configured: true, available: false });
  });
});
