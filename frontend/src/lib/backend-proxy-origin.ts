const ORIGIN_ENV_KEYS = [
  'ALLOWED_PROXY_ORIGINS',
  'FRONTEND_URL',
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_FRONTEND_URL',
  'NEXT_PUBLIC_WEBSITE_URL',
  'CORS_ORIGIN',
] as const;

type ProxyOriginEnv = Partial<Record<(typeof ORIGIN_ENV_KEYS)[number] | 'NODE_ENV', string>>;

function addOrigin(target: Set<string>, rawValue?: string) {
  if (!rawValue) return;
  for (const entry of rawValue.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed || trimmed === '*' || trimmed.includes('*')) continue;
    try {
      target.add(new URL(trimmed).origin);
    } catch {
      // Invalid operator-provided origin entries are ignored here; deployment
      // env validation is responsible for failing fast on malformed config.
    }
  }
}

export function buildBackendProxyAllowedOrigins(requestOrigin: string, env: ProxyOriginEnv) {
  const allowedOrigins = new Set<string>();
  addOrigin(allowedOrigins, requestOrigin);
  for (const key of ORIGIN_ENV_KEYS) addOrigin(allowedOrigins, env[key]);
  return allowedOrigins;
}

export function backendProxyRequestOriginAllowed({
  origin,
  referer,
  requestOrigin,
  env,
}: {
  origin: string | null;
  referer: string | null;
  requestOrigin: string;
  env: ProxyOriginEnv;
}) {
  const allowedOrigins = buildBackendProxyAllowedOrigins(requestOrigin, env);

  if (origin) {
    try {
      return allowedOrigins.has(new URL(origin).origin);
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      return allowedOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  return env.NODE_ENV !== 'production';
}
