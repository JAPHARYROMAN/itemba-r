const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function benchmarkConnection(env = process.env) {
  const url = new URL(env.MSAIDIZI_API ?? 'http://127.0.0.1:3014/api/v1');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('MSAIDIZI_API must not contain credentials, a query or a fragment');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Remote benchmark targets require HTTPS');
  }
  const email = env.SEED_ADMIN_EMAIL?.trim() || (local ? 'admin@itemba.local' : '');
  const password = env.SEED_ADMIN_PASSWORD || (local ? 'ChangeMe!123' : '');
  if (!email || !password.trim()) {
    throw new Error('Remote benchmarks require explicit SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD');
  }
  return { api: url.href.replace(/\/$/, ''), email, password };
}

export function assertReadOnlyBenchmark(caps) {
  if (caps?.enabled !== true || caps?.writeMode !== 'read-only') {
    throw new Error('Live benchmark requires Msaidizi enabled with writeMode exactly read-only');
  }
  if (!Array.isArray(caps.capabilities)) {
    throw new Error('Capabilities response is malformed');
  }
}

/** No retries: a timeout does not prove that the backend/model stopped work. */
export async function benchmarkJson(
  url,
  init = {},
  { timeoutMs = 15_000, fetchImpl = fetch } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Benchmark request timeout must be positive and finite');
  }
  const response = await fetchImpl(url, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Never print an error body: proxies and auth services may echo credentials.
  if (!response.ok) throw new Error(`Benchmark request failed (HTTP ${response.status})`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('Benchmark response was not valid JSON or its body timed out');
  }
  return { body, status: response.status };
}
