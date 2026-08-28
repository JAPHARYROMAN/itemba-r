import { BadRequestException, Injectable } from '@nestjs/common';
import {
  redactPersistedSecrets,
  sanitizePersistedValue,
} from '../utils/persistent-secret-redaction';
import { EphemeralSecretFingerprintRegistry } from './ephemeral-secret-fingerprint-registry.service';

export interface SanitizedValue<T> {
  value: T;
  redactionsApplied: boolean;
}

/**
 * Last-mile DLP for durable Msaidizi and audit data.
 *
 * Encryption protects data at rest but does not make a stored credential
 * acceptable: it would still be copied into backups and could later be
 * decrypted into a model prompt. This guard removes labelled/provider secrets,
 * sensitive JSON fields and high-entropy opaque tokens before encryption. It
 * also hunts raw, embedded and commonly encoded forms of every secret declared
 * to the process-local fingerprint registry. An unlabelled secret that never
 * enters that registry remains outside the mechanism's knowledge.
 */
@Injectable()
export class PersistenceSecretGuard {
  constructor(private readonly ephemeralSecrets: EphemeralSecretFingerprintRegistry) {}

  sanitizeText(input: string): SanitizedValue<string> {
    const knownSecretSafe = this.ephemeralSecrets.redactText(input);
    const heuristicOutput = redactPersistedSecrets(knownSecretSafe.value);
    // The generic scrubber uses a human-readable placeholder. A declared
    // short secret can occur inside that placeholder, so the registry must be
    // the final authority over the bytes that cross the durable boundary.
    const output = this.ephemeralSecrets.redactText(heuristicOutput);
    return {
      value: output.value,
      redactionsApplied:
        knownSecretSafe.redactionsApplied ||
        heuristicOutput !== knownSecretSafe.value ||
        output.redactionsApplied,
    };
  }

  sanitizeJson(input: unknown): SanitizedValue<unknown> {
    try {
      // Declared-secret hunting runs first so a known value cannot hide in a
      // typed digest field that the generic shape detector deliberately keeps.
      const knownSecretSafe = this.ephemeralSecrets.sanitizeValue(input);
      const heuristicSafe = sanitizePersistedValue(knownSecretSafe.value);
      const output = this.ephemeralSecrets.sanitizeValue(heuristicSafe.value);
      return {
        value: output.value,
        redactionsApplied:
          knownSecretSafe.redactionsApplied ||
          heuristicSafe.redactionsApplied ||
          output.redactionsApplied,
      };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /**
   * Signed/canonical protocol data cannot be rewritten without invalidating its
   * digest or signature. Refuse that write when it contains a declared secret.
   */
  assertNoDeclaredSecretText(input: string): void {
    if (this.ephemeralSecrets.redactText(input).redactionsApplied) {
      throw new BadRequestException('DECLARED_EPHEMERAL_SECRET_AT_IMMUTABLE_BOUNDARY');
    }
  }

  assertNoDeclaredSecretJson(input: unknown): void {
    try {
      if (this.ephemeralSecrets.sanitizeValue(input).redactionsApplied) {
        throw new BadRequestException('DECLARED_EPHEMERAL_SECRET_AT_IMMUTABLE_BOUNDARY');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }
}
