export const LEGACY_DURABLE_FILE_READ_CAPABILITY = 'filesystem.file.read';
export const LEGACY_DURABLE_FILE_READ_VERSION = '1.0.0';
export const EPHEMERAL_FILE_DISCLOSURE_CAPABILITY = 'filesystem.file.disclose.ephemeral';
export const EPHEMERAL_FILE_DISCLOSURE_VERSION = '1.0.0';
export const REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY =
  'REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY';

/**
 * File bytes cannot use the normal durable ActionResult/artifact lifecycle.
 * Keep this capability closed until a separately signed one-shot ephemeral
 * reread protocol is implemented and provisioned.
 */
export function isForbiddenDurableFileRead(capability: unknown): capability is string {
  return capability === LEGACY_DURABLE_FILE_READ_CAPABILITY;
}

/**
 * Neither the legacy result-bearing read nor the reserved disclosure protocol
 * may enter ordinary action dispatch. The latter stays closed until a single
 * authenticated stream can couple device read, provider disclosure and nonce
 * settlement without a durable or cross-worker byte rendezvous.
 */
export function isUnavailableHostFileContentCapability(capability: unknown): capability is string {
  return (
    isForbiddenDurableFileRead(capability) || capability === EPHEMERAL_FILE_DISCLOSURE_CAPABILITY
  );
}
