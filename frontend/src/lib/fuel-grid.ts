import { getApp } from '@/lib/apps';
import { getAppConnection, type AppConnectionStatus } from '@/lib/app-connections';

export const FUEL_GRID_PERMISSION = 'fuel_grid.access';
export const FUEL_GRID_ROUTE = '/fuel-grid';
export type FuelGridStatus = AppConnectionStatus;
export interface FuelGridConfig {
  appUrl: string | null;
  healthUrl: string | null;
}
export function getFuelGridConfig(
  environment: Record<string, string | undefined> = process.env,
): FuelGridConfig {
  return getAppConnection(getApp('fuel-grid')!, environment);
}
