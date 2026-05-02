const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const BACKEND_PROXY_URL = '/api/backend';

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

async function requestJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { body, token, headers, query: _query, ...rest } = opts;
  const method = (rest.method ?? 'GET').toUpperCase();
  const csrfToken =
    typeof window !== 'undefined' && UNSAFE_METHODS.has(method) && url.startsWith(BACKEND_PROXY_URL)
      ? readCookie('itemba_csrf')
      : undefined;

  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: rest.cache ?? 'no-store',
  });

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

export function backendDelete<T>(path: string, opts: FetchOpts = {}) {
  return backendFetch<T>(path, { ...opts, method: 'DELETE' });
}

export { API_URL, BACKEND_PROXY_URL };
