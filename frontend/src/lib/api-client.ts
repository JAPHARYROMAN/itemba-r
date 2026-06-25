const BACKEND_PROXY_URL = '/api/backend';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? BACKEND_PROXY_URL;

/** Dispatched on the window when a backend 401 cannot be recovered by a refresh. */
export const SESSION_EXPIRED_EVENT = 'itemba:session-expired';

/**
 * Marks a backend request as "api-client manages its own 401" (it does a refresh
 * + retry and dispatches SESSION_EXPIRED_EVENT itself). The global fetch wrapper
 * (CsrfFetchProvider) skips its own session-expired dispatch for these so it
 * can't redirect before api-client's retry has a chance to recover.
 */
export const MANAGED_401_HEADER = 'x-itemba-managed-401';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type FetchOpts = Omit<RequestInit, 'body'> & {
  body?: unknown;
  token?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
};

type ApiPayload<T> = Partial<ApiEnvelope<T>> & {
  message?: string | string[];
  error?: string;
  statusCode?: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

function messageFromPayload(payload: ApiPayload<unknown>, fallback: string): string {
  if (Array.isArray(payload.message)) return payload.message.join(', ');
  return payload.message ?? payload.error ?? fallback;
}

export function buildQuery(
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  if (!query) return '';
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function withQuery(path: string, query?: FetchOpts['query']): string {
  if (!query) return path;
  const separator = path.includes('?') ? '&' : '?';
  const qs = buildQuery(query).replace(/^\?/, '');
  return qs ? `${path}${separator}${qs}` : path;
}

export function unwrapApiPayload<T>(payload: unknown): T {
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    ('success' in payload || 'timestamp' in payload)
  ) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
}

export function normalizePaginated<T>(payload: unknown): PaginatedResult<T> {
  const unwrapped = unwrapApiPayload<PaginatedResult<T> | T[]>(payload);
  if (Array.isArray(unwrapped)) {
    return {
      data: unwrapped,
      total: unwrapped.length,
      page: 1,
      limit: unwrapped.length,
      totalPages: 1,
    };
  }

  return {
    data: Array.isArray(unwrapped?.data) ? unwrapped.data : [],
    total: Number(unwrapped?.total ?? unwrapped?.data?.length ?? 0),
    page: Number(unwrapped?.page ?? 1),
    limit: Number(unwrapped?.limit ?? unwrapped?.data?.length ?? 0),
    totalPages: Number(unwrapped?.totalPages ?? 1),
  };
}

async function parseJson(res: Response): Promise<ApiPayload<unknown>> {
  return (await res.json().catch(() => ({}))) as ApiPayload<unknown>;
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const encoded = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(encoded));
  return match ? decodeURIComponent(match.slice(encoded.length)) : undefined;
}

async function refreshSessionForBackendRetry(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const res = await fetch('/api/auth/refresh', { method: 'POST', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * On a backend 401: try one silent refresh + retry. If it is STILL 401, the
 * session can't be recovered — broadcast a session-expired event so the auth
 * context redirects to /login, instead of every page surfacing a raw
 * "Unauthorized" on a half-filled form.
 */
async function retryOrExpire(
  res: Response,
  url: string,
  fetchOnce: () => Promise<Response>,
): Promise<Response> {
  if (res.status !== 401 || !url.startsWith(BACKEND_PROXY_URL)) return res;
  if (await refreshSessionForBackendRetry()) {
    res = await fetchOnce();
  }
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
  return res;
}

async function requestJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { body, token, headers, query: _query, ...rest } = opts;
  const method = (rest.method ?? 'GET').toUpperCase();
  const serializedBody = body !== undefined ? JSON.stringify(body) : undefined;
  const fetchOnce = () => {
    const csrfToken =
      typeof window !== 'undefined' &&
      UNSAFE_METHODS.has(method) &&
      url.startsWith(BACKEND_PROXY_URL)
        ? readCookie('itemba_csrf')
        : undefined;

    return fetch(url, {
      ...rest,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(url.startsWith(BACKEND_PROXY_URL) ? { [MANAGED_401_HEADER]: '1' } : {}),
        ...headers,
      },
      body: serializedBody,
      cache: rest.cache ?? 'no-store',
    });
  };

  let res = await fetchOnce();
  res = await retryOrExpire(res, url, fetchOnce);

  const json = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(messageFromPayload(json, `Request failed: ${res.status}`), res.status, json);
  }
  return unwrapApiPayload<T>(json);
}

async function requestFormData<T>(
  url: string,
  formData: FormData,
  opts: Omit<FetchOpts, 'body'> = {},
): Promise<T> {
  const { token, headers, query: _query, ...rest } = opts;
  const method = (rest.method ?? 'POST').toUpperCase();
  const fetchOnce = () => {
    const csrfToken =
      typeof window !== 'undefined' &&
      UNSAFE_METHODS.has(method) &&
      url.startsWith(BACKEND_PROXY_URL)
        ? readCookie('itemba_csrf')
        : undefined;

    return fetch(url, {
      ...rest,
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        ...(url.startsWith(BACKEND_PROXY_URL) ? { [MANAGED_401_HEADER]: '1' } : {}),
        ...headers,
      },
      body: formData,
      cache: rest.cache ?? 'no-store',
    });
  };

  let res = await fetchOnce();
  res = await retryOrExpire(res, url, fetchOnce);

  const json = await parseJson(res);
  if (!res.ok) {
    throw new ApiError(messageFromPayload(json, `Request failed: ${res.status}`), res.status, json);
  }
  return unwrapApiPayload<T>(json);
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  return requestJson<T>(`${API_URL}${withQuery(path, opts.query)}`, opts);
}

export async function backendFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return requestJson<T>(`${BACKEND_PROXY_URL}${withQuery(normalizedPath, opts.query)}`, opts);
}

export function backendGet<T>(path: string, opts: FetchOpts = {}) {
  return backendFetch<T>(path, { ...opts, method: 'GET' });
}

export async function backendList<T>(path: string, opts: FetchOpts = {}) {
  const payload = await backendGet<unknown>(path, opts);
  return normalizePaginated<T>(payload).data;
}

export async function backendPage<T>(path: string, opts: FetchOpts = {}) {
  const payload = await backendGet<unknown>(path, opts);
  return normalizePaginated<T>(payload);
}

export function backendPost<T>(path: string, body?: unknown, opts: FetchOpts = {}) {
  return backendFetch<T>(path, { ...opts, method: 'POST', body });
}

export function backendPut<T>(path: string, body?: unknown, opts: FetchOpts = {}) {
  return backendFetch<T>(path, { ...opts, method: 'PUT', body });
}

export function backendPatch<T>(path: string, body?: unknown, opts: FetchOpts = {}) {
  return backendFetch<T>(path, { ...opts, method: 'PATCH', body });
}

export function backendUpload<T>(
  path: string,
  formData: FormData,
  opts: Omit<FetchOpts, 'body'> = {},
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return requestFormData<T>(
    `${BACKEND_PROXY_URL}${withQuery(normalizedPath, opts.query)}`,
    formData,
    {
      ...opts,
      method: opts.method ?? 'POST',
    },
  );
}

export function backendDelete<T>(path: string, opts: FetchOpts = {}) {
  return backendFetch<T>(path, { ...opts, method: 'DELETE' });
}

export { API_URL, BACKEND_PROXY_URL };
