import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isDesktopViewValue } from './workspace-view-state';

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Expected an object');
  return value as Record<string, any>;
}
export function boundedJson(value: unknown, maxBytes = 65536): Prisma.InputJsonObject {
  const row = object(value);
  const text = JSON.stringify(row);
  if (Buffer.byteLength(text) > maxBytes || /"(?:__proto__|constructor|prototype)"\s*:/.test(text))
    throw new BadRequestException('Workspace data is invalid or too large');
  return row as Prisma.InputJsonObject;
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(value))
    throw new BadRequestException('Invalid workspace identifier');
  return value;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new BadRequestException('A non-negative expectedRevision is required');
  return Number(value);
}
export function validateAppearance(value: unknown): Prisma.InputJsonObject {
  const v = boundedJson(value, 32000);
  if (
    v.version !== 1 ||
    !['dune', 'pearl', 'ocean', 'aurora', 'midnight', 'graphite'].includes(String(v.theme)) ||
    !['system', 'light', 'dark'].includes(String(v.mode)) ||
    !/^#[0-9a-f]{6}$/i.test(String(v.accent))
  )
    throw new BadRequestException('Unsupported desktop appearance');
  if (
    !['bottom', 'left', 'right'].includes(String(v.dock)) ||
    !['full', 'reduced'].includes(String(v.transparency)) ||
    !['system', 'full', 'reduced'].includes(String(v.motion))
  )
    throw new BadRequestException('Invalid desktop controls');
  for (const [key, min, max] of [
    ['iconSize', 36, 64],
    ['blur', 0, 40],
    ['intensity', 0.5, 1.4],
  ] as const)
    if (typeof v[key] !== 'number' || v[key] < min || v[key] > max)
      throw new BadRequestException(`Invalid ${key}`);
  if (
    !Array.isArray(v.shortcuts) ||
    v.shortcuts.length > 20 ||
    !Array.isArray(v.presets) ||
    v.presets.length > 12
  )
    throw new BadRequestException('Too many desktop items');
  if (v.wallpaperId !== null) identifier(v.wallpaperId);
  return v;
}
const hosts: Record<string, RegExp> = {
  'invoice-desk': /^\/invoice-desk(?:\/|$)/,
  'cash-desk': /^\/cash-desk(?:\/|$)/,
  'sales-desk': /^\/(sales-desk|operations\/customers|operations\/sales-orders)(?:\/|$)/,
  inventory: /^\/(inventory|master-data\/products)(?:\/|$)/,
  payroll: /^\/(payroll|hr|payroll-config)(?:\/|$)/,
  reports: /^\/(reports|accounting-engine|finance\/bank-reconciliations)(?:\/|$)/,
  documents: /^\/(documents|group-control\/documents)(?:\/|$)/,
  pos: /^\/pos(?:\/activate)?$/,
  records: /^\/(records|record-book)(?:\/|$)/,
  settings: /^\/(settings|apps)(?:\/|$)/,
  'itemba-r': /^\//,
};
export function validateLayout(value: unknown): Prisma.InputJsonObject {
  const v = boundedJson(value);
  if (v.version !== 1 || !Array.isArray(v.windows) || v.windows.length > 24)
    throw new BadRequestException('Unsupported workspace layout');
  const ids = new Set<string>(),
    singletons = new Set<string>();
  for (const input of v.windows) {
    const w = object(input);
    const id = identifier(w.id);
    if (ids.has(id)) throw new BadRequestException('Duplicate window');
    ids.add(id);
    const host = hosts[w.appId];
    if (
      !host ||
      typeof w.href !== 'string' ||
      w.href.length > 2048 ||
      !w.href.startsWith('/') ||
      w.href.startsWith('//') ||
      /[\\\r\n]/.test(w.href) ||
      !host.test(w.href.split(/[?#]/)[0])
    )
      throw new BadRequestException('Invalid app location');
    if (['settings', 'itemba-r', 'pos'].includes(w.appId)) {
      if (singletons.has(w.appId)) throw new BadRequestException('This app supports one window');
      singletons.add(w.appId);
    }
    if (w.viewState !== undefined) {
      const state = object(w.viewState);
      const values = object(state.values);
      if (
        state.version !== 1 ||
        Object.keys(state).some((key) => !['version', 'values'].includes(key)) ||
        Object.keys(values).length > 100 ||
        !Object.entries(values).every(([key, value]) => isDesktopViewValue(w.appId, key, value))
      )
        throw new BadRequestException('Unsupported window view settings');
    }
    if (
      ![
        'floating',
        'maximized',
        'left',
        'right',
        'top-left',
        'top-right',
        'bottom-left',
        'bottom-right',
      ].includes(w.mode)
    )
      throw new BadRequestException('Invalid window mode');
    const b = object(w.bounds);
    for (const key of ['x', 'y', 'width', 'height'])
      if (typeof b[key] !== 'number' || !Number.isFinite(b[key]) || b[key] < 0 || b[key] > 5000)
        throw new BadRequestException('Invalid window size');
  }
  if (v.activeId !== null && !ids.has(String(v.activeId)))
    throw new BadRequestException('Unknown active window');
  return v;
}
