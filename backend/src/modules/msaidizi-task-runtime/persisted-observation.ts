import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';

/**
 * Small successful tool results may be checkpointed for adaptive reasoning.
 * They remain explicitly untrusted, are scrubbed before persistence, and are
 * omitted rather than truncated when they cannot fit a complete JSON value.
 * Large/binary observations must use the encrypted artifact path.
 */
export const MAX_PERSISTED_OBSERVATION_BYTES = 64 * 1024;

export interface PreparedUntrustedObservation {
  observation: Prisma.InputJsonObject;
  artifact?: {
    content: Buffer;
    sourceSha256: string;
    sourceBytes: number;
    persistedSha256: string;
    persistedBytes: number;
    redactionsApplied: boolean;
  };
}

export function persistedUntrustedObservation(
  value: unknown,
  sourceType: 'ERP_RESULT' | 'HOST_RESULT',
): Prisma.InputJsonObject {
  return preparePersistedUntrustedObservation(value, sourceType).observation;
}

export function preparePersistedUntrustedObservation(
  value: unknown,
  sourceType: 'ERP_RESULT' | 'HOST_RESULT',
): PreparedUntrustedObservation {
  const sourceText = stringify(value);
  if (sourceText === null) {
    return { observation: unavailable(sourceType, 'NOT_JSON_SERIALIZABLE', null, 0) };
  }
  const sourceBytes = Buffer.byteLength(sourceText, 'utf8');
  const sourceSha256 = sha256(sourceText);

  let sanitized;
  try {
    sanitized = sanitizePersistedValue(value);
  } catch {
    return {
      observation: unavailable(sourceType, 'PERSISTENCE_DLP_REJECTED', sourceSha256, sourceBytes),
    };
  }
  const sanitizedText = stringify(sanitized.value);
  if (sanitizedText === null) {
    return {
      observation: unavailable(sourceType, 'NOT_JSON_SERIALIZABLE', sourceSha256, sourceBytes),
    };
  }
  const persistedBytes = Buffer.byteLength(sanitizedText, 'utf8');
  if (persistedBytes > MAX_PERSISTED_OBSERVATION_BYTES) {
    return {
      observation: unavailable(sourceType, 'ARTIFACT_REQUIRED', sourceSha256, sourceBytes),
      artifact: {
        content: Buffer.from(sanitizedText, 'utf8'),
        sourceSha256,
        sourceBytes,
        persistedSha256: sha256(sanitizedText),
        persistedBytes,
        redactionsApplied: sanitized.redactionsApplied,
      },
    };
  }

  return {
    observation: {
      available: true,
      trustLevel: 'UNTRUSTED',
      sourceType,
      sourceSha256,
      sourceBytes,
      persistedBytes,
      redactionsApplied: sanitized.redactionsApplied,
      value: JSON.parse(sanitizedText) as Prisma.InputJsonValue,
    },
  };
}

function unavailable(
  sourceType: string,
  reason: string,
  sourceSha256: string | null,
  sourceBytes: number,
): Prisma.InputJsonObject {
  return {
    available: false,
    trustLevel: 'UNTRUSTED',
    sourceType,
    reason,
    ...(sourceSha256 ? { sourceSha256 } : {}),
    sourceBytes,
  };
}

function stringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
