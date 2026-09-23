import { backendPage } from './api-client';

/** Read every accessible page for selectors and explicit full-register exports. */
export async function backendAllPages<T>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  signal?: AbortSignal,
): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  do {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await backendPage<T>(path, { query: { ...query, page, limit: 100 }, signal });
    rows.push(...result.data);
    if (!result.data.length || rows.length >= result.total) return rows;
    page += 1;
  } while (true);
}
