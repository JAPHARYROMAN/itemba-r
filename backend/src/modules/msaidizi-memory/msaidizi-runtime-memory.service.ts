import { Injectable } from '@nestjs/common';
import {
  MsaidiziExecutionTarget,
  MsaidiziMemoryKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziTrustLevel,
  Prisma,
} from '@prisma/client';
import { EncryptionService, PersistenceSecretGuard } from '../../common/services';
import { PrismaService } from '../../prisma/prisma.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { conceptsForText, MSAIDIZI_MEMORY_RETRIEVAL_PROFILE } from './msaidizi-memory-semantics';
import {
  deterministicRuntimeMemoryId,
  GovernedRuntimeMemoryScope,
  MSAIDIZI_RUNTIME_MEMORY_SCOPE_PREFIX,
  MSAIDIZI_RUNTIME_MEMORY_VERSION,
  runtimeMemoryScopeDigest,
  runtimeMemoryScopeKey,
  sha256,
} from './msaidizi-runtime-memory-scope';

const TERMINAL_TASK_STATUSES = [
  MsaidiziTaskStatus.COMPLETED,
  MsaidiziTaskStatus.PARTIAL,
  MsaidiziTaskStatus.FAILED,
  MsaidiziTaskStatus.CANCELLED,
  MsaidiziTaskStatus.NEEDS_ATTENTION,
] as const;
const RUNTIME_MEMORY_KINDS = [
  MsaidiziMemoryKind.EPISODIC,
  MsaidiziMemoryKind.PROCEDURAL,
  MsaidiziMemoryKind.SEMANTIC,
] as const;
const CAPTURED_EVENT = 'memory.runtime_outcome_captured';
const SKIPPED_EVENT = 'memory.runtime_outcome_skipped';
const MAX_RECONCILE_BATCH = 100;
const MAX_DEVICE_SCOPES = 4;
const MAX_CAPABILITY_IDS = 32;
const MAX_CONTENT_BYTES_EACH = 4_096;
const MAX_PERSISTED_BYTES_PER_TASK = 64 * 1024;
const SAFE_CAPABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

export type RuntimeMemoryCaptureResult =
  | { outcome: 'CAPTURED'; records: number; bytesWritten: number }
  | { outcome: 'ALREADY_CAPTURED'; records: 0; bytesWritten: 0 }
  | { outcome: 'CONTENDED'; records: 0; bytesWritten: 0 }
  | { outcome: 'NOT_ELIGIBLE'; records: 0; bytesWritten: 0 }
  | { outcome: 'SKIPPED'; records: 0; bytesWritten: 0; reason: string };

/**
 * Writes only deterministic, server-derived outcome structure. Objective text,
 * model prose, tool arguments/results, artifacts, and clipboard/page content
 * are intentionally absent from this trusted path.
 */
@Injectable()
export class MsaidiziRuntimeMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly secrets: PersistenceSecretGuard,
    private readonly autonomy: AutonomyConfig,
  ) {}

  async reconcileTerminalOutcomes(limit = 20): Promise<{
    examined: number;
    captured: number;
    skipped: number;
  }> {
    const tasks = await this.prisma.msaidiziTask.findMany({
      where: {
        status: { in: [...TERMINAL_TASK_STATUSES] },
        endedAt: { not: null },
        initiatedByUserId: { not: null },
        principal: {
          key: this.autonomy.principalKey,
          status: MsaidiziPrincipalStatus.ACTIVE,
        },
        events: { none: { type: { in: [CAPTURED_EVENT, SKIPPED_EVENT] } } },
      },
      select: { id: true },
      orderBy: { endedAt: 'asc' },
      take: Math.max(1, Math.min(limit, MAX_RECONCILE_BATCH)),
    });
    let captured = 0;
    let skipped = 0;
    for (const task of tasks) {
      const result = await this.captureTerminalOutcome(task.id);
      if (result.outcome === 'CAPTURED' || result.outcome === 'ALREADY_CAPTURED') captured += 1;
      if (result.outcome === 'SKIPPED') skipped += 1;
    }
    return { examined: tasks.length, captured, skipped };
  }

  async captureTerminalOutcome(taskId: string): Promise<RuntimeMemoryCaptureResult> {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.msaidiziTask.findFirst({
        where: {
          id: taskId,
          status: { in: [...TERMINAL_TASK_STATUSES] },
          endedAt: { not: null },
          initiatedByUserId: { not: null },
          principal: {
            key: this.autonomy.principalKey,
            status: MsaidiziPrincipalStatus.ACTIVE,
          },
        },
        select: {
          id: true,
          principalId: true,
          initiatedByUserId: true,
          companyId: true,
          mandateId: true,
          activePlanVersion: true,
          status: true,
          endedAt: true,
          bytesRead: true,
          bytesWritten: true,
          maxLocalBytes: true,
        },
      });
      if (!task?.initiatedByUserId || !task.endedAt) return notEligible();

      const priorMarker = await tx.msaidiziTaskEvent.findFirst({
        where: { taskId, type: { in: [CAPTURED_EVENT, SKIPPED_EVENT] } },
        select: { type: true },
      });
      if (priorMarker) {
        return priorMarker.type === CAPTURED_EVENT ? alreadyCaptured() : notEligible();
      }

      const steps = await tx.msaidiziTaskStep.findMany({
        where: { taskId, planVersion: { version: task.activePlanVersion } },
        select: {
          sequence: true,
          capability: true,
          target: true,
          expectedEffect: true,
          mutation: true,
          status: true,
          hostActions: { select: { deviceId: true } },
        },
        orderBy: { sequence: 'asc' },
      });

      const allCapabilities = [...new Set(steps.map((step) => step.capability))];
      if (
        allCapabilities.length > MAX_CAPABILITY_IDS ||
        allCapabilities.some((capability) => !SAFE_CAPABILITY_ID.test(capability))
      ) {
        return this.skip(tx, taskId, 'CAPABILITY_SCOPE_INVALID');
      }

      const hostSteps = steps.filter((step) => step.target === MsaidiziExecutionTarget.HOST);
      const deviceIds = [
        ...new Set(hostSteps.flatMap((step) => step.hostActions.map((action) => action.deviceId))),
      ].sort();
      if (hostSteps.length > 0 && deviceIds.length === 0) {
        return this.skip(tx, taskId, 'DEVICE_SCOPE_UNKNOWN');
      }
      if (deviceIds.length > MAX_DEVICE_SCOPES) {
        return this.skip(tx, taskId, 'DEVICE_SCOPE_LIMIT_EXCEEDED');
      }

      const scopes: GovernedRuntimeMemoryScope[] = (deviceIds.length > 0 ? deviceIds : [null]).map(
        (deviceId) => ({
          principalId: task.principalId,
          initiatedByUserId: task.initiatedByUserId!,
          companyId: task.companyId,
          mandateId: task.mandateId,
          deviceId,
        }),
      );
      const contents = structuralOutcomeContents(task.status, steps);
      const rows: Prisma.MsaidiziMemoryCreateManyInput[] = [];

      for (const scope of scopes) {
        for (const kind of RUNTIME_MEMORY_KINDS) {
          const content = contents[kind];
          if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES_EACH) {
            return this.skip(tx, taskId, 'CONTENT_LIMIT_EXCEEDED');
          }
          const contentSafe = this.secrets.sanitizeText(content);
          if (contentSafe.redactionsApplied) {
            return this.skip(tx, taskId, 'DLP_SECRET_DETECTED');
          }
          const contentDigest = sha256(content);
          const scopeKey = runtimeMemoryScopeKey(kind, scope);
          const metadata = {
            schema: 'msaidizi.runtime-memory/v1',
            runtimeMemoryVersion: MSAIDIZI_RUNTIME_MEMORY_VERSION,
            retrievalProfile: MSAIDIZI_MEMORY_RETRIEVAL_PROFILE,
            instructionAuthority: false,
            taskStatus: task.status,
            companyId: scope.companyId,
            mandateId: scope.mandateId,
            deviceId: scope.deviceId,
            stepCounts: stepStatusCounts(steps),
            capabilityIds: allCapabilities,
            semanticConcepts: conceptsForText(allCapabilities.join(' ')),
          };
          const sourceProvenance = {
            sourceType: 'TASK',
            sourceId: task.id,
            capturedAt: task.endedAt.toISOString(),
            transformations: [
              'server-derived-structural-outcome-v1',
              MSAIDIZI_MEMORY_RETRIEVAL_PROFILE,
            ],
            authorityVerified: true,
            verificationVersion: 1,
            runtimeMemoryVersion: MSAIDIZI_RUNTIME_MEMORY_VERSION,
            instructionAuthority: false,
            principalId: scope.principalId,
            initiatedByUserId: scope.initiatedByUserId,
            companyId: scope.companyId,
            mandateId: scope.mandateId,
            deviceId: scope.deviceId,
            scopeDigest: runtimeMemoryScopeDigest(task.id, kind, contentDigest, scope),
          };
          const metadataSafe = this.secrets.sanitizeJson(metadata);
          const provenanceSafe = this.secrets.sanitizeJson(sourceProvenance);
          if (metadataSafe.redactionsApplied || provenanceSafe.redactionsApplied) {
            return this.skip(tx, taskId, 'DLP_SECRET_DETECTED');
          }
          rows.push({
            id: deterministicRuntimeMemoryId(task.id, kind, scopeKey),
            principalId: task.principalId,
            companyId: task.companyId,
            sourceTaskId: task.id,
            createdByUserId: task.initiatedByUserId,
            kind,
            scopeKey,
            contentCiphertext: this.encryption.encrypt(content),
            contentDigest,
            metadata: metadata as Prisma.InputJsonValue,
            trustLevel: MsaidiziTrustLevel.TRUSTED,
            sourceProvenance: sourceProvenance as Prisma.InputJsonValue,
            expiresAt: null,
          });
        }
      }

      const existing = await tx.msaidiziMemory.findMany({
        where: { id: { in: rows.map((row) => row.id!) } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((row) => row.id));
      const missing = rows.filter((row) => !existingIds.has(row.id!));
      if (missing.length === 0) {
        await this.writeMarker(tx, taskId, CAPTURED_EVENT, { records: 0, bytesWritten: 0 });
        return alreadyCaptured();
      }

      const persistedBytes = missing.reduce((total, row) => total + rowStorageBytes(row), 0);
      if (
        persistedBytes > MAX_PERSISTED_BYTES_PER_TASK ||
        task.bytesRead + task.bytesWritten + BigInt(persistedBytes) > task.maxLocalBytes
      ) {
        return this.skip(tx, taskId, 'MEMORY_WRITE_BUDGET_EXCEEDED');
      }

      const charged = await tx.msaidiziTask.updateMany({
        where: {
          id: task.id,
          status: task.status,
          endedAt: task.endedAt,
          bytesRead: task.bytesRead,
          bytesWritten: task.bytesWritten,
        },
        data: { bytesWritten: { increment: BigInt(persistedBytes) } },
      });
      if (charged.count !== 1) return contended();

      const created = await tx.msaidiziMemory.createMany({ data: missing });
      if (created.count !== missing.length) {
        throw new Error('Runtime memory batch was not written atomically');
      }
      await this.writeMarker(tx, taskId, CAPTURED_EVENT, {
        records: missing.length,
        bytesWritten: persistedBytes,
        deviceScopes: scopes.length,
        kinds: [...RUNTIME_MEMORY_KINDS],
      });
      return { outcome: 'CAPTURED', records: missing.length, bytesWritten: persistedBytes };
    });
  }

  private async skip(
    tx: Prisma.TransactionClient,
    taskId: string,
    reason: string,
  ): Promise<RuntimeMemoryCaptureResult> {
    await this.writeMarker(tx, taskId, SKIPPED_EVENT, { reason });
    return { outcome: 'SKIPPED', records: 0, bytesWritten: 0, reason };
  }

  private async writeMarker(
    tx: Prisma.TransactionClient,
    taskId: string,
    type: string,
    payload: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.msaidiziTaskEvent.create({
      data: { taskId, type, actorType: 'SERVICE', payload },
    });
  }
}

function structuralOutcomeContents(
  status: MsaidiziTaskStatus,
  steps: Array<{
    capability: string;
    expectedEffect: string;
    mutation: boolean;
    status: MsaidiziTaskStepStatus;
  }>,
): Record<MsaidiziMemoryKind, string> {
  const counts = stepStatusCounts(steps);
  const attempted = steps.filter(
    (step) =>
      step.status !== MsaidiziTaskStepStatus.PENDING &&
      step.status !== MsaidiziTaskStepStatus.READY &&
      step.status !== MsaidiziTaskStepStatus.CANCELLED &&
      step.status !== MsaidiziTaskStepStatus.SKIPPED,
  );
  const succeededCapabilities = [
    ...new Set(
      steps
        .filter((step) => step.status === MsaidiziTaskStepStatus.SUCCEEDED)
        .map((step) => step.capability),
    ),
  ];
  const concepts = conceptsForText(attempted.map((step) => step.capability).join(' '));
  const mutations = attempted.filter((step) => step.mutation).length;
  const externalEffects = attempted.filter(
    (step) => step.expectedEffect === 'EXTERNAL' || step.expectedEffect === 'IRREVERSIBLE',
  ).length;
  return {
    [MsaidiziMemoryKind.EPISODIC]:
      `Verified task episode ended ${status}. ` +
      `Step outcomes: ${counts.SUCCEEDED} succeeded, ${counts.FAILED} failed, ` +
      `${counts.NEEDS_ATTENTION} need attention, ${counts.CANCELLED} cancelled, ` +
      `${counts.SKIPPED} skipped. Attempted mutations: ${mutations}; external effects: ${externalEffects}.`,
    [MsaidiziMemoryKind.PROCEDURAL]:
      `Verified governed capability sequence with task outcome ${status}. ` +
      (succeededCapabilities.length > 0
        ? `Capabilities that succeeded: ${succeededCapabilities.join(', ')}.`
        : 'No governed capability was recorded as successful.'),
    [MsaidiziMemoryKind.SEMANTIC]:
      `Verified task outcome ${status}. Governed concepts observed: ` +
      `${concepts.length > 0 ? concepts.join(', ') : 'general operations'}.`,
  };
}

function stepStatusCounts(steps: Array<{ status: MsaidiziTaskStepStatus }>) {
  const counts: Record<MsaidiziTaskStepStatus, number> = {
    [MsaidiziTaskStepStatus.PENDING]: 0,
    [MsaidiziTaskStepStatus.READY]: 0,
    [MsaidiziTaskStepStatus.LEASED]: 0,
    [MsaidiziTaskStepStatus.RUNNING]: 0,
    [MsaidiziTaskStepStatus.SUCCEEDED]: 0,
    [MsaidiziTaskStepStatus.FAILED]: 0,
    [MsaidiziTaskStepStatus.CANCELLED]: 0,
    [MsaidiziTaskStepStatus.SKIPPED]: 0,
    [MsaidiziTaskStepStatus.NEEDS_ATTENTION]: 0,
  };
  for (const step of steps) counts[step.status] += 1;
  return counts;
}

function rowStorageBytes(row: Prisma.MsaidiziMemoryCreateManyInput): number {
  return Buffer.byteLength(
    [
      row.id,
      row.principalId,
      row.companyId ?? '',
      row.sourceTaskId ?? '',
      row.createdByUserId ?? '',
      row.kind,
      row.scopeKey,
      row.contentCiphertext,
      row.contentDigest,
      JSON.stringify(row.metadata),
      row.trustLevel,
      JSON.stringify(row.sourceProvenance),
    ].join('\0'),
    'utf8',
  );
}

function alreadyCaptured(): RuntimeMemoryCaptureResult {
  return { outcome: 'ALREADY_CAPTURED', records: 0, bytesWritten: 0 };
}

function contended(): RuntimeMemoryCaptureResult {
  return { outcome: 'CONTENDED', records: 0, bytesWritten: 0 };
}

function notEligible(): RuntimeMemoryCaptureResult {
  return { outcome: 'NOT_ELIGIBLE', records: 0, bytesWritten: 0 };
}

export const MSAIDIZI_RUNTIME_MEMORY_LIMITS = Object.freeze({
  maxDeviceScopes: MAX_DEVICE_SCOPES,
  maxCapabilityIds: MAX_CAPABILITY_IDS,
  maxContentBytesEach: MAX_CONTENT_BYTES_EACH,
  maxPersistedBytesPerTask: MAX_PERSISTED_BYTES_PER_TASK,
  scopePrefix: MSAIDIZI_RUNTIME_MEMORY_SCOPE_PREFIX,
});
