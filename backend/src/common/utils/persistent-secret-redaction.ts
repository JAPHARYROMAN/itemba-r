/**
 * Fail-closed DLP for recognisable secret material that is about to become
 * durable application data.
 *
 * This is deliberately separate from model input handling. Msaidizi may need to
 * use a credential ephemerally, but the same bytes must not be copied into a
 * transcript, resume record, memory, audit payload, or log line. Detection is
 * conservative: losing a little display text is preferable to retaining a
 * bearer credential.
 *
 * It is still not a credential vault: authority-bearing bytes must enter the
 * agent through a supervisor-owned ephemeral reference. This detector is the
 * final persistence backstop, not permission to pass raw credentials around.
 */

export const PERSISTED_SECRET_PLACEHOLDER = '[REDACTED SECRET]';

const LABEL =
  '(?:password|passwd|passcode|pwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token|' +
  'refresh[_ -]?token|auth(?:orization)?[_ -]?token|bearer|secret|private[_ -]?key|' +
  'connection[_ -]?string|pairing[_ -]?code|enrollment[_ -]?code|activation[_ -]?code|cvv|pin)';

const SENSITIVE_KEY =
  /(?:password|passwd|passcode|pwd|secret|token|api.?key|private.?key|credential|authorization|cookie|session|pairing.?code|enrollment.?code|activation.?code|cvv|pin)/i;
const OPAQUE_TOKEN = /\b[A-Za-z0-9_+\/=.-]{32,}\b/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPED_DIGEST_KEY = /(?:sha256|digest)$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Journal receipt hashes are protocol provenance, not bearer authority. Their
 * names do not use the `sha256`/`digest` suffix because they mirror the device
 * wire contract, so they need a deliberately closed exemption. Do not broaden
 * this to `*Hash`: opaque hashes in arbitrary fields may still be credentials.
 */
const JOURNAL_RECEIPT_SHA256_KEYS = new Set([
  'journalPrepareEntryHash',
  'journalPreparePreviousHash',
  'journalRecoveryPreparedEntryHash',
  'journalRecoveryPreparedPreviousHash',
  'journalEntryHash',
  'journalPreviousHash',
]);

const SECRET_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  replace: string | ((substring: string, ...args: string[]) => string);
}> = [
  {
    // PEM and OpenSSH private keys, including all line breaks in the block.
    pattern:
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi,
    replace: PERSISTED_SECRET_PLACEHOLDER,
  },
  {
    // Credentials embedded in URLs. Retain the scheme and destination only.
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s\/@:]+:[^\s\/@]+@/gi,
    replace: `$1${PERSISTED_SECRET_PLACEHOLDER}@`,
  },
  {
    // HTTP Authorization headers and prose using the same conventional form.
    pattern: /\b(authorization\s*:\s*bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,
    replace: `$1${PERSISTED_SECRET_PLACEHOLDER}`,
  },
  {
    // Mobile POS activation links use a deliberately terse `code` query key.
    // Scope this rule to the exact activation route so ordinary business codes
    // remain displayable while the one-time bearer value never becomes durable.
    pattern: /(\/mobile-pos\/activate\?[^\s"'<>]*?[?&]code=)[A-Za-z0-9_-]{32}(?=$|[&#\s"'<>])/gi,
    replace: `$1${PERSISTED_SECRET_PLACEHOLDER}`,
  },
  {
    // Quoted labelled values, including JSON object fields.
    pattern: new RegExp(`(["']?${LABEL}["']?\\s*[:=]\\s*)(["'])(.*?)\\2`, 'gi'),
    replace: (_match: string, prefix: string, quote: string) =>
      `${prefix}${quote}${PERSISTED_SECRET_PLACEHOLDER}${quote}`,
  },
  {
    // Natural-language dictation commonly uses "password is ..." rather than
    // a key/value delimiter. Treat that phrasing exactly like a labelled field
    // before a local transcript can become durable or model-visible.
    pattern: new RegExp(`(\\b${LABEL}\\b\\s+(?:is|equals)\\s+)([^\\s,;}&\\]\\)]+)`, 'gi'),
    replace: `$1${PERSISTED_SECRET_PLACEHOLDER}`,
  },
  {
    // Unquoted labelled values. Stop at ordinary record/argument delimiters.
    pattern: new RegExp(`(\\b${LABEL}\\b\\s*[:=]\\s*)([^\\s,;}&\\]\\)]+)`, 'gi'),
    replace: `$1${PERSISTED_SECRET_PLACEHOLDER}`,
  },
  {
    // Common provider tokens that are unsafe even without a nearby label.
    pattern:
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16})\b/g,
    replace: PERSISTED_SECRET_PLACEHOLDER,
  },
  {
    // Compact JWTs. The minimum lengths avoid treating dotted version numbers
    // and ordinary filenames as credentials.
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: PERSISTED_SECRET_PLACEHOLDER,
  },
];

/** Redacts recognisable credentials from free-form text before persistence. */
export function redactPersistedSecrets(text: string): string {
  // The placeholder itself contains the label "secret". Process only the
  // surrounding segments so a second pass is idempotent instead of treating
  // its own output as a fresh labelled assignment.
  return text
    .split(PERSISTED_SECRET_PLACEHOLDER)
    .map(redactTextSegment)
    .join(PERSISTED_SECRET_PLACEHOLDER);
}

function redactTextSegment(text: string): string {
  let redacted = text;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    // RegExp instances with the global flag retain lastIndex across calls in
    // some JS operations. replace() resets it in current engines; setting it
    // explicitly keeps this helper deterministic across runtimes.
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, replace as never);
  }
  OPAQUE_TOKEN.lastIndex = 0;
  redacted = redacted.replace(OPAQUE_TOKEN, (candidate) =>
    looksLikeOpaqueCredential(candidate) ? PERSISTED_SECRET_PLACEHOLDER : candidate,
  );
  return redacted;
}

/** True when the detector would remove at least one credential from the text. */
export function containsPersistedSecret(text: string): boolean {
  return redactPersistedSecrets(text) !== text;
}

export interface SanitizedPersistedValue<T = unknown> {
  value: T;
  redactionsApplied: boolean;
}

/** Recursively scrubs JSON-shaped data before it crosses a durable boundary. */
export function sanitizePersistedValue<T>(input: T): SanitizedPersistedValue<T> {
  let redactionsApplied = false;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 24) throw new Error('Persisted JSON exceeds the nesting limit');
    if (typeof value === 'string') {
      const sanitized = redactPersistedSecrets(value);
      redactionsApplied ||= sanitized !== value;
      return sanitized;
    }
    if (value === null || value === undefined || typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    if (seen.has(value)) throw new Error('Persisted JSON must not contain cycles');
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      // A digest in a typed field is provenance, not bearer authority. Keep
      // this exemption key- and shape-bound: the same 64 hex characters in
      // prose or an arbitrary field remain redacted by OPAQUE_TOKEN. Sensitive
      // key names always win, even when they end in `Sha256` or `Digest`.
      if (SENSITIVE_KEY.test(key)) {
        result[key] = PERSISTED_SECRET_PLACEHOLDER;
        redactionsApplied = true;
      } else if (
        (TYPED_DIGEST_KEY.test(key) || JOURNAL_RECEIPT_SHA256_KEYS.has(key)) &&
        typeof item === 'string' &&
        SHA256_HEX.test(item)
      ) {
        result[key] = item;
      } else {
        result[key] = visit(item, depth + 1);
      }
    }
    return result;
  };

  return { value: visit(input, 0) as T, redactionsApplied };
}

function looksLikeOpaqueCredential(candidate: string): boolean {
  if (UUID.test(candidate)) return false;
  // Random credentials are frequently emitted as hex. Treating every hex
  // string as a harmless digest created a trivial unlabeled persistence bypass.
  // Typed digest columns remain available for provenance; opaque prose does not
  // get that exemption.
  if (/^[0-9a-f]{32,}$/i.test(candidate)) return true;
  const characterClasses = [
    /[a-z]/.test(candidate),
    /[A-Z]/.test(candidate),
    /\d/.test(candidate),
    /[^A-Za-z0-9]/.test(candidate),
  ].filter(Boolean).length;
  // Three-class identifiers are common in audit data (controller names,
  // session ids, correlation keys). Requiring all four classes keeps this
  // heuristic focused on base64-like bearer material; labelled/provider
  // secrets above are still caught regardless of entropy.
  if (characterClasses < 4) return false;
  return shannonEntropy(candidate) >= 3.5;
}

function shannonEntropy(value: string): number {
  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}
