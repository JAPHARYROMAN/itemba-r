/**
 * Response-shape unwrappers for the backend's pagination envelope.
 *
 * The Nest backend wraps every list response in a `{ data: ... }` envelope.
 * Most list endpoints further wrap with their own pagination shape, so the
 * actual array can be at:
 *   1. `json` (the response is the raw array)
 *   2. `json.data` (single-wrap envelope)
 *   3. `json.data.data` (envelope around `{data, total, page, limit}`)
 *   4. `json.data.items` (envelope around `{items, total, ...}`)
 *
 * Pages that hand-rolled their unwrap typically only handled cases 1 and 2,
 * which broke whenever the inner page used `items` or returned `{data, total}`.
 * Use these helpers instead so the bug is fixed in one place.
 */

/** Extract the row array from a list-style API response, regardless of wrapping. */
export function unwrapList<T = unknown>(json: unknown): T[] {
  if (json == null) return [];
  if (Array.isArray(json)) return json as T[];

  const innerData = (json as { data?: unknown }).data;
  if (Array.isArray(innerData)) return innerData as T[];

  if (innerData && typeof innerData === 'object') {
    const nestedData = (innerData as { data?: unknown }).data;
    if (Array.isArray(nestedData)) return nestedData as T[];
    const items = (innerData as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
  }

  // Top-level `items` (no `data` envelope at all)
  const topItems = (json as { items?: unknown }).items;
  if (Array.isArray(topItems)) return topItems as T[];

  return [];
}

/** Extract `total` from a paginated response, falling back to a default. */
export function unwrapTotal(json: unknown, fallback = 0): number {
  if (json == null) return fallback;
  const inner = (json as { data?: unknown }).data ?? json;
  if (inner && typeof inner === 'object') {
    const t = (inner as { total?: unknown }).total;
    if (typeof t === 'number') return t;
  }
  const topT = (json as { total?: unknown }).total;
  if (typeof topT === 'number') return topT;
  return fallback;
}

/** Extract a single object from a wrapped response. Returns the unwrapped
 *  payload, or `null` if the response is empty/missing. */
export function unwrapOne<T = unknown>(json: unknown): T | null {
  if (json == null) return null;
  // If the response is a primitive or array, treat as-is.
  if (typeof json !== 'object' || Array.isArray(json)) return json as T;
  const inner = (json as { data?: unknown }).data;
  if (inner !== undefined) {
    // If `data` is an object that itself looks like a list envelope, walk in once more.
    if (
      inner &&
      typeof inner === 'object' &&
      !Array.isArray(inner) &&
      'data' in (inner as object) &&
      Array.isArray((inner as { data?: unknown }).data) === false &&
      (inner as { data?: unknown }).data !== undefined
    ) {
      return (inner as { data?: unknown }).data as T;
    }
    return inner as T;
  }
  return json as T;
}

/** Extract `page` from a paginated response, falling back to 1. */
export function unwrapPage(json: unknown, fallback = 1): number {
  if (json == null) return fallback;
  const inner = (json as { data?: unknown }).data ?? json;
  if (inner && typeof inner === 'object') {
    const p = (inner as { page?: unknown }).page;
    if (typeof p === 'number') return p;
  }
  const topP = (json as { page?: unknown }).page;
  if (typeof topP === 'number') return topP;
  return fallback;
}
