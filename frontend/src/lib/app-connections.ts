import { APP_REGISTRY, type WorkspaceApp } from './apps';

export interface AppConnectionStatus {
  configured: boolean;
  available: boolean;
  checkedAt: string;
  latencyMs: number | null;
}

function httpUrl(value?: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Server use only: URLs come from administrator configuration, never a request parameter. */
export function getAppConnection(
  app: WorkspaceApp,
  environment: Record<string, string | undefined> = process.env,
) {
  if (app.launch.kind !== 'external') return { appUrl: null, healthUrl: null };
  const appUrl = httpUrl(environment[app.launch.urlVariable]);
  return { appUrl, healthUrl: httpUrl(environment[app.launch.healthVariable]) ?? appUrl };
}

export function getAppUrls() {
  return Object.fromEntries(
    APP_REGISTRY.filter((app) => app.launch.kind === 'external').map((app) => [
      app.id,
      getAppConnection(app).appUrl,
    ]),
  );
}

export async function checkAppConnection(app: WorkspaceApp): Promise<AppConnectionStatus> {
  const { appUrl, healthUrl } = getAppConnection(app);
  const checkedAt = new Date().toISOString();
  if (!appUrl || !healthUrl)
    return { configured: false, available: false, checkedAt, latencyMs: null };
  const startedAt = Date.now();
  try {
    // Check both the launch page and service health: a healthy API alone does
    // not prove that the user can reach the application's login page.
    const responses = await Promise.all(
      [...new Set([appUrl, healthUrl])].map((url) =>
        fetch(url, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'manual',
          signal: AbortSignal.timeout(5_000),
          headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8' },
        }),
      ),
    );
    const available = responses.every(
      (response) => response.status >= 200 && response.status < 400,
    );
    await Promise.all(responses.map((response) => response.body?.cancel()));
    return { configured: true, available, checkedAt, latencyMs: Date.now() - startedAt };
  } catch {
    return { configured: true, available: false, checkedAt, latencyMs: Date.now() - startedAt };
  }
}
