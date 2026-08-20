import { describe, expect, it } from 'vitest';
import { getFuelGridConfig } from './fuel-grid';

describe('Fuel Grid runtime configuration', () => {
  it('normalizes the configured app and health URLs', () => {
    expect(
      getFuelGridConfig({
        FUELGRID_APP_URL: ' https://fuelgrid.example.com/ ',
        FUELGRID_HEALTH_URL: 'https://api.fuelgrid.example.com/readyz',
      }),
    ).toEqual({
      appUrl: 'https://fuelgrid.example.com',
      healthUrl: 'https://api.fuelgrid.example.com/readyz',
    });
  });

  it('checks the app URL when no dedicated health URL is configured', () => {
    expect(getFuelGridConfig({ FUELGRID_APP_URL: 'https://fuelgrid.example.com' })).toEqual({
      appUrl: 'https://fuelgrid.example.com',
      healthUrl: 'https://fuelgrid.example.com',
    });
  });

  it('rejects missing and non-http application URLs', () => {
    expect(getFuelGridConfig({})).toEqual({ appUrl: null, healthUrl: null });
    expect(getFuelGridConfig({ FUELGRID_APP_URL: 'file:///etc/passwd' })).toEqual({
      appUrl: null,
      healthUrl: null,
    });
  });
});
