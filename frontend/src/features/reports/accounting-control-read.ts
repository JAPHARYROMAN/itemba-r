import { backendGet } from '@/lib/api-client';
import type { ControlKind, ControlRecord, DepreciationEntry } from './accounting-controls-types';

export type ControlReview = { record: ControlRecord; entries: DepreciationEntry[] };
export async function readControl(
  kind: ControlKind,
  id: string,
  signal: AbortSignal,
): Promise<ControlReview> {
  const path = `/${kind}/${encodeURIComponent(id)}`;
  const [record, entries] = await Promise.all([
    backendGet<ControlRecord>(path, { signal }),
    kind === 'depreciation'
      ? backendGet<DepreciationEntry[]>(`${path}/entries`, { signal })
      : Promise.resolve([]),
  ]);
  return { record, entries: entries.filter((r) => !r.deletedAt) };
}
