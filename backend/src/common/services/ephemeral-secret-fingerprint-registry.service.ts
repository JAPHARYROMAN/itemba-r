import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { PERSISTED_SECRET_PLACEHOLDER } from '../utils/persistent-secret-redaction';

const MAX_SECRET_BYTES = 16_384;
const MAX_REGISTERED_VARIANTS = 4_096;
const HMAC_DOMAIN = 'itemba/msaidizi/ephemeral-secret/v1\0';
const REDACTION_MARKERS = [
  PERSISTED_SECRET_PLACEHOLDER,
  '[REDACTED]',
  '[REMOVED]',
  '[FILTERED]',
  '[MASKED]',
  '[X]',
  '[]',
] as const;

interface RollingParameters {
  base: number;
  salt: number;
}

type HmacFingerprints = Set<string>;
type SecondRollingBuckets = Map<number, HmacFingerprints>;
type FirstRollingBuckets = Map<number, SecondRollingBuckets>;

interface RegistryState {
  hmacKey: Buffer;
  firstRolling: RollingParameters;
  secondRolling: RollingParameters;
  byLength: Map<number, FirstRollingBuckets>;
  registeredVariants: number;
}

interface VariantFingerprint {
  length: number;
  firstRolling: number;
  secondRolling: number;
  hmac: string;
}

export interface EphemeralSecretRedaction<T> {
  value: T;
  redactionsApplied: boolean;
}

// Keeping the state in a WeakMap means serialising or inspecting the injectable
// cannot expose the per-process fingerprint key. The map contains only keyed
// fingerprints and lengths; declared raw values and their encodings are never
// retained as registry fields.
const REGISTRY_STATE = new WeakMap<EphemeralSecretFingerprintRegistry, RegistryState>();

/**
 * Process-local taint registry for explicitly declared ephemeral secrets.
 *
 * The registry retains a random-keyed HMAC and two keyed rolling fingerprints
 * for the raw value and common textual encodings. The raw bytes and generated
 * variants exist only for the duration of `register()` and are never persisted,
 * logged, returned, or held by this service. Rolling fingerprints make bounded
 * substring hunting practical; an HMAC check confirms every possible match
 * before redaction.
 *
 * Limitation: this mechanism cannot identify an unlabelled value that was never
 * explicitly registered. Those values still depend on the conservative
 * pattern/entropy detector at the persistence boundary.
 */
@Injectable()
export class EphemeralSecretFingerprintRegistry {
  constructor() {
    REGISTRY_STATE.set(this, {
      hmacKey: randomBytes(32),
      firstRolling: rollingParameters(),
      secondRolling: rollingParameters(),
      byLength: new Map(),
      registeredVariants: 0,
    });
  }

  /** Registers one known secret without retaining its raw or encoded value. */
  register(secret: string | Uint8Array): void {
    const state = this.state();
    const variants = secretVariants(secret);
    try {
      const additions: VariantFingerprint[] = [];
      for (const variant of variants) {
        const candidate = fingerprintVariant(state, variant);
        if (!hasFingerprint(state, candidate)) additions.push(candidate);
      }
      if (state.registeredVariants + additions.length > MAX_REGISTERED_VARIANTS) {
        throw new Error(
          'EPHEMERAL_SECRET_REGISTRY_CAPACITY_EXCEEDED: Refusing to use an untracked secret.',
        );
      }
      for (const addition of additions) addFingerprint(state, addition);
    } finally {
      // Strings are immutable and reclaimed by the runtime, but clearing the
      // temporary set prevents this stack frame from retaining references.
      variants.clear();
    }
  }

  redactText(input: string): EphemeralSecretRedaction<string> {
    const state = this.state();
    if (input.length === 0 || state.registeredVariants === 0) {
      return { value: input, redactionsApplied: false };
    }

    const ranges = findRegisteredSecretRanges(input, state);
    if (ranges.length === 0) return { value: input, redactionsApplied: false };

    // A fixed marker is not safe when a declared short secret occurs inside
    // the marker itself. Select a marker only after scanning the complete
    // candidate output, including the newly joined boundaries.
    for (const marker of REDACTION_MARKERS) {
      const candidate = redactRanges(input, ranges, marker);
      if (findRegisteredSecretRanges(candidate, state).length === 0) {
        return { value: candidate, redactionsApplied: true };
      }
    }

    // Removal can join two fragments into another registered value. Re-scan
    // until the output is clean. Each iteration removes at least one UTF-16
    // code unit because empty secrets cannot be registered, so this terminates.
    let output = redactRanges(input, ranges, '');
    for (;;) {
      const residual = findRegisteredSecretRanges(output, state);
      if (residual.length === 0) return { value: output, redactionsApplied: true };
      output = redactRanges(output, residual, '');
    }
  }

  /** Recursively hunts declared secrets at a JSON-shaped durable boundary. */
  sanitizeValue<T>(input: T): EphemeralSecretRedaction<T> {
    let redactionsApplied = false;
    const seen = new WeakSet<object>();

    const visit = (value: unknown, depth: number): unknown => {
      if (depth > 24) throw new Error('Persisted JSON exceeds the nesting limit');
      if (typeof value === 'string') {
        const sanitized = this.redactText(value);
        redactionsApplied ||= sanitized.redactionsApplied;
        return sanitized.value;
      }
      if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        const sanitized = this.redactText(String(value));
        if (sanitized.redactionsApplied) {
          redactionsApplied = true;
          return sanitized.value;
        }
        return value;
      }
      if (value === null || value === undefined || typeof value !== 'object') return value;
      if (value instanceof Date) return value;
      if (seen.has(value)) throw new Error('Persisted JSON must not contain cycles');
      seen.add(value);
      if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));

      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        const sanitizedKey = this.redactText(key);
        redactionsApplied ||= sanitizedKey.redactionsApplied;
        result[sanitizedKey.value] = visit(item, depth + 1);
      }
      return result;
    };

    return { value: visit(input, 0) as T, redactionsApplied };
  }

  private state(): RegistryState {
    const state = REGISTRY_STATE.get(this);
    if (!state) throw new Error('EPHEMERAL_SECRET_REGISTRY_NOT_INITIALIZED');
    return state;
  }
}

function secretVariants(secret: string | Uint8Array): Set<string> {
  if (typeof secret !== 'string' && !(secret instanceof Uint8Array)) {
    throw new Error('EPHEMERAL_SECRET_TYPE_INVALID');
  }
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  if (bytes.length === 0) {
    bytes.fill(0);
    throw new Error('EPHEMERAL_SECRET_EMPTY');
  }
  if (bytes.length > MAX_SECRET_BYTES) {
    bytes.fill(0);
    throw new Error('EPHEMERAL_SECRET_TOO_LARGE');
  }

  const variants = new Set<string>();
  try {
    const base64 = bytes.toString('base64');
    const base64Url = bytes.toString('base64url');
    const hex = bytes.toString('hex');
    variants.add(base64);
    variants.add(base64.replace(/=+$/u, ''));
    variants.add(base64Url);
    variants.add(`${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`);
    variants.add(hex);
    variants.add(hex.toUpperCase());

    const decoded = typeof secret === 'string' ? secret : bytes.toString('utf8');
    if (typeof secret === 'string' || Buffer.from(decoded, 'utf8').equals(bytes)) {
      variants.add(decoded);
      try {
        const urlEncoded = encodeURIComponent(decoded);
        variants.add(urlEncoded);
        variants.add(urlEncoded.replace(/%[0-9A-F]{2}/gu, (value) => value.toLowerCase()));
        variants.add(urlEncoded.replace(/%20/gu, '+'));
      } catch {
        // A lone UTF-16 surrogate has no URI encoding. Its exact UTF-8 form and
        // the binary transformations above remain registered.
      }
    }
    variants.delete('');
    return variants;
  } finally {
    bytes.fill(0);
  }
}

function rollingParameters(): RollingParameters {
  let base = randomBytes(4).readUInt32BE(0) | 1;
  if (base >>> 0 < 257) base = 65_537;
  return { base: base >>> 0, salt: randomBytes(2).readUInt16BE(0) };
}

function rollingHash(value: string, parameters: RollingParameters): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, parameters.base) + (value.charCodeAt(index) ^ parameters.salt)) >>> 0;
  }
  return hash;
}

function rollingTextIndex(
  value: string,
  maximumLength: number,
  parameters: RollingParameters,
): { prefixes: Uint32Array; powers: Uint32Array } {
  const prefixes = new Uint32Array(value.length + 1);
  const powers = new Uint32Array(maximumLength + 1);
  powers[0] = 1;
  for (let index = 0; index < value.length; index += 1) {
    prefixes[index + 1] =
      (Math.imul(prefixes[index], parameters.base) +
        (value.charCodeAt(index) ^ parameters.salt)) >>>
      0;
  }
  for (let index = 1; index <= maximumLength; index += 1) {
    powers[index] = Math.imul(powers[index - 1], parameters.base) >>> 0;
  }
  return { prefixes, powers };
}

function substringRollingHash(
  index: { prefixes: Uint32Array; powers: Uint32Array },
  start: number,
  length: number,
): number {
  return (
    (index.prefixes[start + length] - Math.imul(index.prefixes[start], index.powers[length])) >>> 0
  );
}

function hmacFingerprint(state: RegistryState, value: string): string {
  return createHmac('sha256', state.hmacKey)
    .update(HMAC_DOMAIN, 'utf8')
    .update(value, 'utf8')
    .digest('base64url');
}

function fingerprintVariant(state: RegistryState, variant: string): VariantFingerprint {
  return {
    length: variant.length,
    firstRolling: rollingHash(variant, state.firstRolling),
    secondRolling: rollingHash(variant, state.secondRolling),
    hmac: hmacFingerprint(state, variant),
  };
}

function hasFingerprint(state: RegistryState, candidate: VariantFingerprint): boolean {
  return Boolean(
    state.byLength
      .get(candidate.length)
      ?.get(candidate.firstRolling)
      ?.get(candidate.secondRolling)
      ?.has(candidate.hmac),
  );
}

function addFingerprint(state: RegistryState, fingerprint: VariantFingerprint): void {
  let firstBuckets = state.byLength.get(fingerprint.length);
  if (!firstBuckets) {
    firstBuckets = new Map();
    state.byLength.set(fingerprint.length, firstBuckets);
  }
  let secondBuckets = firstBuckets.get(fingerprint.firstRolling);
  if (!secondBuckets) {
    secondBuckets = new Map();
    firstBuckets.set(fingerprint.firstRolling, secondBuckets);
  }
  let hmacs = secondBuckets.get(fingerprint.secondRolling);
  if (!hmacs) {
    hmacs = new Set();
    secondBuckets.set(fingerprint.secondRolling, hmacs);
  }
  hmacs.add(fingerprint.hmac);
  state.registeredVariants += 1;
}

function findRegisteredSecretRanges(
  input: string,
  state: RegistryState,
): Array<{ start: number; end: number }> {
  if (input.length === 0 || state.registeredVariants === 0) return [];
  const eligibleLengths = [...state.byLength.keys()].filter((length) => length <= input.length);
  if (eligibleLengths.length === 0) return [];

  const maximumLength = Math.max(...eligibleLengths);
  const first = rollingTextIndex(input, maximumLength, state.firstRolling);
  const second = rollingTextIndex(input, maximumLength, state.secondRolling);
  const ranges: Array<{ start: number; end: number }> = [];

  for (const length of eligibleLengths) {
    const firstBuckets = state.byLength.get(length)!;
    for (let start = 0; start + length <= input.length; start += 1) {
      const firstHash = substringRollingHash(first, start, length);
      const secondBuckets = firstBuckets.get(firstHash);
      if (!secondBuckets) continue;
      const secondHash = substringRollingHash(second, start, length);
      const hmacs = secondBuckets.get(secondHash);
      if (!hmacs) continue;
      const candidate = input.slice(start, start + length);
      if (hmacs.has(hmacFingerprint(state, candidate))) {
        ranges.push({ start, end: start + length });
      }
    }
  }

  return ranges;
}

function redactRanges(
  input: string,
  ranges: Array<{ start: number; end: number }>,
  marker: string,
): string {
  ranges.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  let output = '';
  let cursor = 0;
  for (const range of merged) {
    output += `${input.slice(cursor, range.start)}${marker}`;
    cursor = range.end;
  }
  return `${output}${input.slice(cursor)}`;
}
