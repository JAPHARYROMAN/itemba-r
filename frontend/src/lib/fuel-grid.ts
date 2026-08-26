export const FUEL_GRID_PERMISSION = 'fuel_grid.access';
export const FUEL_GRID_ROUTE = '/fuel-grid';

export interface FuelGridConfig {
  appUrl: string | null;
  healthUrl: string | null;
}

export interface FuelGridStatus {
  configured: boolean;
  available: boolean;
  checkedAt: string;
  latencyMs: number | null;
}

function normalizeHttpUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function getFuelGridConfig(
  environment: Record<string, string | undefined> = process.env,
): FuelGridConfig {
  const appUrl = normalizeHttpUrl(environment.FUELGRID_APP_URL);
  const explicitHealthUrl = normalizeHttpUrl(environment.FUELGRID_HEALTH_URL);

  return {
    appUrl,
    healthUrl: explicitHealthUrl ?? appUrl,
  };
}
