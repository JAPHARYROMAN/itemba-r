import { MsaidiziMemoryKind } from '@prisma/client';
import { createHash } from 'node:crypto';

export const MSAIDIZI_RUNTIME_MEMORY_VERSION = 1 as const;
export const MSAIDIZI_RUNTIME_MEMORY_SCOPE_PREFIX = 'runtime-outcome:v1:' as const;

export interface GovernedRuntimeMemoryScope {
  principalId: string;
  initiatedByUserId: string;
  companyId: string | null;
  mandateId: string | null;
  deviceId: string | null;
}

export function runtimeMemoryScopeKey(
  kind: MsaidiziMemoryKind,
  scope: GovernedRuntimeMemoryScope,
): string {
  return (
    `${MSAIDIZI_RUNTIME_MEMORY_SCOPE_PREFIX}${kind.toLowerCase()}` +
    `:company=${scope.companyId ?? 'none'}` +
    `:mandate=${scope.mandateId ?? 'none'}` +
    `:device=${scope.deviceId ?? 'none'}`
  );
}

export function runtimeMemoryScopeDigest(
  taskId: string,
  kind: MsaidiziMemoryKind,
  contentDigest: string,
  scope: GovernedRuntimeMemoryScope,
): string {
  return sha256(
    JSON.stringify({
      version: MSAIDIZI_RUNTIME_MEMORY_VERSION,
      taskId,
      kind,
      contentDigest,
      principalId: scope.principalId,
      initiatedByUserId: scope.initiatedByUserId,
      companyId: scope.companyId,
      mandateId: scope.mandateId,
      deviceId: scope.deviceId,
    }),
  );
}

export function deterministicRuntimeMemoryId(
  taskId: string,
  kind: MsaidiziMemoryKind,
  scopeKey: string,
): string {
  const bytes = createHash('sha256')
    .update(`msaidizi-runtime-memory/v1\0${taskId}\0${kind}\0${scopeKey}`)
    .digest()
    .subarray(0, 16);
  // RFC 4122-compatible deterministic UUID. The task row CAS remains the
  // concurrency fence; this primary key is the final duplicate-write guard.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
