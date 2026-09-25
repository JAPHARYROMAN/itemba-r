import { APP_REGISTRY, getApp } from './apps';
import { parseDesktopViewState, type DesktopViewState } from './desktop-view-state';

export const WINDOW_APP_IDS = [
  'invoice-desk',
  'cash-desk',
  'sales-desk',
  'inventory',
  'payroll',
  'reports',
  'documents',
  'pos',
  'records',
] as const;
export const isWindowApp = (id: string) => WINDOW_APP_IDS.some((value) => value === id);
export type WindowMode =
  | 'floating'
  | 'maximized'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
export type Bounds = { x: number; y: number; width: number; height: number };
export interface DesktopWindow {
  id: string;
  appId: string;
  href: string;
  bounds: Bounds;
  mode: WindowMode;
  minimized: boolean;
  viewState?: DesktopViewState;
}
export interface DesktopSession {
  version: 1;
  windows: DesktopWindow[];
  activeId: string | null;
}
export const EMPTY_DESKTOP: DesktopSession = { version: 1, windows: [], activeId: null };
export const THEMES = [
  { id: 'dune', label: 'Dune', accent: '#a85d29', color: '#d4b896' },
  { id: 'pearl', label: 'Pearl', accent: '#426ac8', color: '#c4d2e0' },
  { id: 'ocean', label: 'Ocean', accent: '#007b99', color: '#1a9bb5' },
  { id: 'aurora', label: 'Aurora', accent: '#7552d9', color: '#8273d9' },
  { id: 'midnight', label: 'Midnight', accent: '#8f8afb', color: '#273a67' },
  { id: 'graphite', label: 'Graphite', accent: '#71839e', color: '#535e70' },
] as const;
export interface DesktopAppearance {
  version: 1;
  theme: (typeof THEMES)[number]['id'];
  mode: 'system' | 'light' | 'dark';
  accent: string;
  wallpaperId: string | null;
  wallpaperPosition: 'center' | 'top' | 'bottom';
  dock: 'bottom' | 'left' | 'right';
  autoHide: boolean;
  iconSize: number;
  density: 'comfortable' | 'compact';
  transparency: 'full' | 'reduced';
  blur: number;
  motion: 'system' | 'full' | 'reduced';
  intensity: number;
  pinnedApps: string[];
  recentApps: string[];
  shortcuts: { appId: string; x: number; y: number }[];
  widgets: { recent: boolean; drafts: boolean; approvals: boolean };
  presets: { name: string; theme: string; accent: string; mode: 'system' | 'light' | 'dark' }[];
}
export const DEFAULT_APPEARANCE: DesktopAppearance = {
  version: 1,
  theme: 'aurora',
  mode: 'system',
  accent: '#7552d9',
  wallpaperId: null,
  wallpaperPosition: 'center',
  dock: 'bottom',
  autoHide: false,
  iconSize: 48,
  density: 'comfortable',
  transparency: 'full',
  blur: 24,
  motion: 'system',
  intensity: 1,
  pinnedApps: [...WINDOW_APP_IDS],
  recentApps: [],
  shortcuts: ['invoice-desk', 'cash-desk', 'sales-desk', 'documents'].map((appId, i) => ({
    appId,
    x: 24,
    y: 32 + i * 112,
  })),
  widgets: { recent: true, drafts: true, approvals: true },
  presets: [],
};
const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
export function parseAppearance(input: unknown): DesktopAppearance {
  if (!input || typeof input !== 'object') return DEFAULT_APPEARANCE;
  const v = input as Partial<DesktopAppearance>;
  return {
    ...DEFAULT_APPEARANCE,
    theme: THEMES.some((t) => t.id === v.theme) ? v.theme! : 'aurora',
    mode: v.mode === 'light' || v.mode === 'dark' ? v.mode : 'system',
    accent: /^#[\da-f]{6}$/i.test(v.accent ?? '') ? v.accent! : DEFAULT_APPEARANCE.accent,
    wallpaperId:
      typeof v.wallpaperId === 'string' && /^[a-z\d-]{1,64}$/i.test(v.wallpaperId)
        ? v.wallpaperId
        : null,
    wallpaperPosition:
      v.wallpaperPosition === 'top' || v.wallpaperPosition === 'bottom'
        ? v.wallpaperPosition
        : 'center',
    dock: v.dock === 'left' || v.dock === 'right' ? v.dock : 'bottom',
    autoHide: v.autoHide === true,
    iconSize: clamp(v.iconSize, 36, 64, 48),
    blur: clamp(v.blur, 0, 40, 24),
    intensity: clamp(v.intensity, 0.5, 1.4, 1),
    density: v.density === 'compact' ? 'compact' : 'comfortable',
    transparency: v.transparency === 'reduced' ? 'reduced' : 'full',
    motion: v.motion === 'full' || v.motion === 'reduced' ? v.motion : 'system',
    pinnedApps: Array.isArray(v.pinnedApps)
      ? [...new Set(v.pinnedApps.filter((id) => !!getApp(id)))].slice(0, 20)
      : DEFAULT_APPEARANCE.pinnedApps,
    recentApps: Array.isArray(v.recentApps)
      ? [...new Set(v.recentApps.filter((id) => !!getApp(id)))].slice(0, 8)
      : [],
    shortcuts: Array.isArray(v.shortcuts)
      ? v.shortcuts
          .filter((s) => s && !!getApp(s.appId))
          .slice(0, 20)
          .filter((s, i, all) => all.findIndex((a) => a.appId === s.appId) === i)
          .map((s) => ({ appId: s.appId, x: clamp(s.x, 0, 4000, 24), y: clamp(s.y, 0, 2000, 32) }))
      : DEFAULT_APPEARANCE.shortcuts,
    widgets: {
      recent: v.widgets?.recent !== false,
      drafts: v.widgets?.drafts !== false,
      approvals: v.widgets?.approvals !== false,
    },
    presets: Array.isArray(v.presets)
      ? v.presets
          .filter(
            (p) =>
              p &&
              typeof p.name === 'string' &&
              THEMES.some((t) => t.id === p.theme) &&
              /^#[\da-f]{6}$/i.test(p.accent),
          )
          .slice(0, 12)
          .map((p) => ({
            name: p.name.slice(0, 40),
            theme: p.theme,
            accent: p.accent,
            mode: p.mode === 'dark' || p.mode === 'light' ? p.mode : 'system',
          }))
      : [],
  };
}
export function validDesktopHref(value: unknown) {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\r\n]/.test(value) &&
    value.length <= 2048
  );
}
export function parseDesktopSession(input: unknown): DesktopSession {
  if (!input || typeof input !== 'object') return EMPTY_DESKTOP;
  const v = input as Partial<DesktopSession>;
  if (v.version !== 1 || !Array.isArray(v.windows)) return EMPTY_DESKTOP;
  const modes: WindowMode[] = [
    'floating',
    'maximized',
    'left',
    'right',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right',
  ];
  const seen = new Set<string>();
  const windows = v.windows
    .filter(
      (w) =>
        w &&
        typeof w.id === 'string' &&
        /^[\w-]{1,80}$/.test(w.id) &&
        !seen.has(w.id) &&
        seen.add(w.id) &&
        APP_REGISTRY.some((app) => app.id === w.appId) &&
        validDesktopHref(w.href),
    )
    .slice(0, 24)
    .map((w) => ({
      id: w.id,
      appId: w.appId,
      href: w.href,
      mode: modes.includes(w.mode) ? w.mode : ('floating' as WindowMode),
      minimized: w.minimized === true,
      ...(w.viewState ? { viewState: parseDesktopViewState(w.appId, w.viewState) } : {}),
      bounds: {
        x: clamp(w.bounds?.x, 0, 4000, 72),
        y: clamp(w.bounds?.y, 0, 2000, 32),
        width: clamp(w.bounds?.width, 480, 4000, 1040),
        height: clamp(w.bounds?.height, 360, 2400, 700),
      },
    }));
  return {
    version: 1,
    windows,
    activeId: windows.some((w) => w.id === v.activeId) ? v.activeId! : (windows.at(-1)?.id ?? null),
  };
}
export function fitBounds(bounds: Bounds, width: number, height: number): Bounds {
  const w = Math.min(Math.max(480, bounds.width), Math.max(320, width - 16));
  const h = Math.min(Math.max(360, bounds.height), Math.max(240, height - 16));
  return {
    width: w,
    height: h,
    x: Math.max(8, Math.min(bounds.x, width - w - 8)),
    y: Math.max(8, Math.min(bounds.y, height - h - 8)),
  };
}
export function windowBounds(window: DesktopWindow, width: number, height: number): Bounds {
  if (window.mode === 'floating') return fitBounds(window.bounds, width, height);
  const quarter = window.mode.includes('-');
  const right = window.mode.includes('right');
  const bottom = window.mode.startsWith('bottom');
  const w = window.mode === 'maximized' ? width - 16 : (width - 24) / 2;
  const h = quarter ? (height - 24) / 2 : height - 16;
  return { x: right ? width / 2 + 4 : 8, y: bottom ? height / 2 + 4 : 8, width: w, height: h };
}
/** WCAG relative luminance, used for user-selected accent foregrounds. */
function luminance(hex: string) {
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map((value) => value + value).join('');
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
export function contrastRatio(foreground: string, background: string) {
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function accentForeground(hex: string) {
  return contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';
}
/** Preserve the chosen hue while keeping focus/selection visible on an opaque surface. */
export function accentFocus(hex: string, background: string) {
  if (contrastRatio(hex, background) >= 3) return hex;
  const target = accentForeground(background) === '#000000' ? 0 : 255;
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  for (let step = 1; step <= 20; step++) {
    const mixed =
      '#' +
      channels
        .map((value) =>
          Math.round(value + ((target - value) * step) / 20)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    if (contrastRatio(mixed, background) >= 3) return mixed;
  }
  return target ? '#ffffff' : '#000000';
}
