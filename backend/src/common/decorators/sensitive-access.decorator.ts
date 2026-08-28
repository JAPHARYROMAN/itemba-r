import { SetMetadata } from '@nestjs/common';

/** Metadata key shared by guards, interceptors, and coverage evidence. */
export const SENSITIVE_ACCESS_KEY = 'itemba:sensitive-access';

export interface SensitiveAccessMetadata {
  /** Stable audit entity name; independent of a controller class rename. */
  entityType: string;
}

/**
 * Marks a controller or route as a sensitive-data boundary.
 *
 * Authentication/permission failures happen before controller interceptors, so
 * this metadata is deliberately consumable by both guards and interceptors.
 */
export const SensitiveAccess = (entityType: string) =>
  SetMetadata(SENSITIVE_ACCESS_KEY, { entityType } satisfies SensitiveAccessMetadata);
