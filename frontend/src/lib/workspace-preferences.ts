export type RecordLayout = 'focus' | 'ledger';
export interface WorkspacePreferences {
  version: 1;
  lastApp: string;
  lastErpPath: string;
  pinnedApps: string[];
  recentApps: string[];
  maximized: boolean;
  startup: 'desktop' | 'resume';
  layouts: Record<string, RecordLayout>;
  density: 'comfortable' | 'compact';
  backdrop: 'landscape' | 'mist' | 'graphite';
  transparency: 'full' | 'reduced';
}

export const DEFAULT_WORKSPACE: WorkspacePreferences = {
  version: 1,
  lastApp: 'itemba-r',
  lastErpPath: '/dashboard',
  pinnedApps: ['itemba-r', 'fuel-grid'],
  recentApps: [],
  maximized: false,
  startup: 'desktop',
  layouts: {},
  density: 'comfortable',
  backdrop: 'landscape',
  transparency: 'full',
};
const cache = new Map<string, { raw: string | null; value: WorkspacePreferences }>();
const listeners = new Map<string, Set<() => void>>();
export const workspaceKey = (userId: string) =>
  `itemba.os.workspace.v1.${encodeURIComponent(userId)}`;
export const isWorkspacePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\/[a-zA-Z0-9/_-]*$/.test(value) &&
  !value.startsWith('//') &&
  value.length < 512;
const isAppId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9-]{0,48}$/.test(v);
const ids = (v: unknown, fallback: string[]) =>
  Array.isArray(v) ? [...new Set(v.filter(isAppId))].slice(0, 20) : fallback;

/** Treat device storage as untrusted. Store navigation preferences, never form contents. */
export function parseWorkspace(raw: string | null): WorkspacePreferences {
  if (!raw) return DEFAULT_WORKSPACE;
  try {
    const input = JSON.parse(raw);
    if (!input || input.version !== 1) return DEFAULT_WORKSPACE;
    const layouts: Record<string, RecordLayout> = {};
    if (input.layouts && typeof input.layouts === 'object' && !Array.isArray(input.layouts)) {
      for (const [path, value] of Object.entries(input.layouts).slice(0, 50)) {
        if (isWorkspacePath(path) && (value === 'focus' || value === 'ledger'))
          layouts[path] = value;
      }
    }
    return {
      version: 1,
      lastApp: isAppId(input.lastApp) ? input.lastApp : DEFAULT_WORKSPACE.lastApp,
      lastErpPath: isWorkspacePath(input.lastErpPath)
        ? input.lastErpPath
        : DEFAULT_WORKSPACE.lastErpPath,
      pinnedApps: ids(input.pinnedApps, DEFAULT_WORKSPACE.pinnedApps),
      recentApps: ids(input.recentApps, []),
      maximized: input.maximized === true,
      startup: input.startup === 'resume' ? 'resume' : 'desktop',
      layouts,
      density: input.density === 'compact' ? 'compact' : 'comfortable',
      backdrop:
        input.backdrop === 'mist' || input.backdrop === 'graphite' ? input.backdrop : 'landscape',
      transparency: input.transparency === 'reduced' ? 'reduced' : 'full',
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

export function readWorkspace(userId: string): WorkspacePreferences {
  const key = workspaceKey(userId);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return cache.get(key)?.value ?? DEFAULT_WORKSPACE;
  }
  const existing = cache.get(key);
  if (existing && existing.raw === raw) return existing.value;
  const value = parseWorkspace(raw);
  cache.set(key, { raw, value });
  return value;
}

export function updateWorkspace(
  userId: string,
  change: (current: WorkspacePreferences) => WorkspacePreferences,
) {
  const key = workspaceKey(userId);
  const current = readWorkspace(userId);
  const next = parseWorkspace(JSON.stringify(change(current)));
  const raw = JSON.stringify(next);
  if (raw === JSON.stringify(current)) return;
  let storageRaw: string | null = raw;
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Quota errors can reject writes while reads still work. Cache against the
    // unchanged disk value so a subsequent read does not erase the local edit.
    try {
      storageRaw = window.localStorage.getItem(key);
    } catch {
      storageRaw = null;
    }
  }
  cache.set(key, { raw: storageRaw, value: next });
  listeners.get(key)?.forEach((listener) => listener());
}

export function subscribeWorkspace(userId: string, callback: () => void) {
  const key = workspaceKey(userId);
  const group = listeners.get(key) ?? new Set();
  group.add(callback);
  listeners.set(key, group);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      cache.delete(key);
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    group.delete(callback);
    window.removeEventListener('storage', onStorage);
    if (!group.size) listeners.delete(key);
  };
}
