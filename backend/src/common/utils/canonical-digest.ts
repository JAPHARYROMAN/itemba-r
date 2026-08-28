import { createHash } from 'node:crypto';

/**
 * Injective, deterministic encoding for JSON-shaped action arguments.
 * Length prefixes and type tags prevent nested values from collapsing onto a
 * single representation; sorted object keys make serializer order irrelevant.
 */
export function canonicaliseActionValue(value: unknown): string {
  if (value === undefined) return 'u';
  if (value === null) return 'z';
  if (typeof value === 'boolean') return value ? 't' : 'f';
  if (typeof value === 'number') return Object.is(value, -0) ? 'n:-0' : `n:${String(value)}`;
  if (typeof value === 'string') return `s:${value.length}:${value}`;
  if (Array.isArray(value)) return `a[${value.map(canonicaliseActionValue).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `o{${Object.keys(source)
      .sort()
      .map((key) => `${key.length}:${key}=${canonicaliseActionValue(source[key])}`)
      .join(',')}}`;
  }
  return `x:${typeof value}:${String(value)}`;
}

/** SHA-256 digest used to bind a token, approval, or attempt to exact arguments. */
export function actionArgumentDigest(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicaliseActionValue(args), 'utf16le').digest('hex');
}
