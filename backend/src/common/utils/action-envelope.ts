import { actionArgumentDigest } from './canonical-digest';

export interface ExactActionEnvelope {
  path: Record<string, unknown>;
  query: Record<string, unknown>;
  body?: unknown;
}

/**
 * Converts a planned envelope to the representation visible after an HTTP
 * round-trip. Path/query scalars become strings; the JSON body remains typed.
 */
export function normaliseHttpActionEnvelope(value: unknown): ExactActionEnvelope | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.path) || !isRecord(value.query)) return null;
  const extra = Object.keys(value).filter((key) => !['path', 'query', 'body'].includes(key));
  if (extra.length > 0) return null;

  const path = Object.fromEntries(
    Object.entries(value.path)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => [key, String(item)]),
  );
  const query = Object.fromEntries(
    Object.entries(value.query)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => [key, normaliseQueryValue(item)]),
  );

  return {
    path,
    query,
    ...(Object.prototype.hasOwnProperty.call(value, 'body') ? { body: value.body } : {}),
  };
}

export function exactActionEnvelopeDigest(value: unknown): string | null {
  const envelope = normaliseHttpActionEnvelope(value);
  return envelope ? actionArgumentDigest(envelope as unknown as Record<string, unknown>) : null;
}

function normaliseQueryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normaliseQueryValue);
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
