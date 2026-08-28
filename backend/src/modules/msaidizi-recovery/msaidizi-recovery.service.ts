import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditChannel,
  AuditSeverity,
  MsaidiziDeviceStatus,
  MsaidiziHostActionStatus,
  MsaidiziRecoveryCommandStatus,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  companyWhereForUser,
  isGroupScopedUser,
} from '../../common/services/company-scope.service';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { directMtlsPeer } from '../msaidizi-devices/direct-mtls-peer';
import {
  MsaidiziRecoveryProgressDto,
  MsaidiziRecoveryResultDto,
  PollMsaidiziRecoveryDto,
  QueryMsaidiziRecoveryDto,
  RequestMsaidiziRecoveryDto,
} from './dto/msaidizi-recovery.dto';
import { MsaidiziRecoveryManifestSigner } from './msaidizi-recovery-manifest-signer.service';

const QUARANTINE_CAPABILITY = 'filesystem.entry.quarantine';
const ADMINISTRATIVE_RECOVERY_CAPABILITIES = new Set([
  'registry.value.set',
  'registry.value.delete',
  'environment.machine.set',
  'environment.machine.delete',
  'windows.service.start',
  'windows.service.stop',
  'windows.service.start-mode.set',
  'scheduled-task.enabled.set',
]);
const ABSENT_STATE_SHA256 = createHash('sha256')
  .update('msaidizi-host-state:absent:v1', 'utf8')
  .digest('hex');
const ACTIVE_RECOVERY_STATES = [
  MsaidiziRecoveryCommandStatus.DISPATCHED,
  MsaidiziRecoveryCommandStatus.RECOVERING,
] as const;
const MAX_RECOVERY_DELIVERY_SESSIONS = 3;
const LATE_RECOVERY_RESULT_REASONS = new Set([
  'RECOVERY_MANIFEST_EXPIRED_UNSEEN',
  'RECOVERY_DISPATCH_LIMIT_EXHAUSTED',
]);

@Injectable()
export class MsaidiziRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: MsaidiziRecoveryManifestSigner,
    private readonly audit: AuditLogsService,
  ) {}

  async request(dto: RequestMsaidiziRecoveryDto, user: AuthUser) {
    this.signer.assertReady();
    const action = await this.prisma.msaidiziHostAction.findFirst({
      where: { id: dto.hostActionId, task: taskCompanyScope(user) },
      include: {
        task: {
          select: {
            id: true,
            principalId: true,
            mandateId: true,
            companyId: true,
            initiatedByUserId: true,
          },
        },
        device: { select: { id: true, status: true } },
      },
    });
    if (!action) throw new NotFoundException('Host action not found');
    const summary = jsonObject(action.resultSummary);
    const evidenceEvent =
      action.journalEvidenceEventCursor == null
        ? null
        : await this.prisma.msaidiziTaskEvent.findFirst({
            where: {
              cursor: action.journalEvidenceEventCursor,
              taskId: action.taskId,
            },
            select: {
              cursor: true,
              taskId: true,
              type: true,
              actorType: true,
              actorId: true,
              payload: true,
              integrityVersion: true,
              previousHash: true,
              eventHash: true,
            },
          });
    const recoveryRecordSha256 = normalizedDigest(action.recoveryRecordSha256);
    const expectedRestoredStateSha256 = normalizedDigest(action.expectedRestoredStateSha256);
    const isQuarantine = action.capability === QUARANTINE_CAPABILITY;
    const expectedCurrentStateSha256 = isQuarantine
      ? ABSENT_STATE_SHA256
      : dto.expectedCurrentStateSha256?.toLowerCase();
    const requiredPhrase = isQuarantine
      ? `RESTORE ${action.actionId}`
      : `RESTORE ${action.actionId} AT ${expectedCurrentStateSha256 ?? '<CURRENT-STATE-SHA256>'}`;
    if (dto.confirmationPhrase !== requiredPhrase) {
      throw new BadRequestException(`Type ${requiredPhrase} to authorize this exact recovery`);
    }
    const committedRecovery =
      action.status === MsaidiziHostActionStatus.SUCCEEDED &&
      action.journalAccepted === true &&
      hasVerifiedRecoveryPreparedEvidence(action, summary, evidenceEvent, {
        eventTypes: new Set(['host_action.settled']),
        outcome: 'Completed',
        outcomeUncertain: false,
        mutationCommitted: true,
      });
    const uncertainCheckpointRecovery =
      action.status === MsaidiziHostActionStatus.UNKNOWN &&
      action.journalAccepted === true &&
      hasVerifiedRecoveryPreparedEvidence(action, summary, evidenceEvent, {
        eventTypes: new Set([
          'host_action.outcome_unknown',
          'host_action.late_evidence_reconciled',
        ]),
        outcome: 'NeedsAttention',
        outcomeUncertain: true,
        mutationCommitted: false,
      });
    const lateCommittedCheckpointRecovery =
      action.status === MsaidiziHostActionStatus.UNKNOWN &&
      action.uncertainOutcome === true &&
      action.journalAccepted === true &&
      hasVerifiedRecoveryPreparedEvidence(action, summary, evidenceEvent, {
        eventTypes: new Set(['host_action.late_evidence_reconciled']),
        outcome: 'Completed',
        outcomeUncertain: false,
        mutationCommitted: true,
      });
    if (
      (!isQuarantine && !ADMINISTRATIVE_RECOVERY_CAPABILITIES.has(action.capability)) ||
      (!committedRecovery && !uncertainCheckpointRecovery && !lateCommittedCheckpointRecovery) ||
      !recoveryRecordSha256 ||
      !expectedRestoredStateSha256 ||
      !expectedCurrentStateSha256
    ) {
      throw new ConflictException('This action has no proved recovery record');
    }
    if (
      action.device.status !== MsaidiziDeviceStatus.ACTIVE &&
      action.device.status !== MsaidiziDeviceStatus.OFFLINE
    ) {
      throw new ConflictException('The assigned recovery supervisor is not enrolled');
    }

    const existing = await this.prisma.msaidiziRecoveryCommand.findUnique({
      where: { hostActionId: action.id },
    });
    if (existing) return existing;

    const recoveryId = randomUUID();
    const idempotencyKey = createHash('sha256')
      .update(`msaidizi-recovery\0${action.actionId}`, 'utf8')
      .digest('hex');
    const signed = this.signer.issue({
      schemaVersion: 2,
      recoveryId,
      deviceId: action.deviceId,
      originalActionId: action.actionId,
      recoveryRecordSha256,
      expectedCurrentStateSha256,
      expectedRestoredStateSha256,
      idempotencyKey,
    });

    return this.prisma.$transaction(async (tx) => {
      const command = await tx.msaidiziRecoveryCommand.upsert({
        where: { hostActionId: action.id },
        update: {},
        create: {
          id: recoveryId,
          hostActionId: action.id,
          deviceId: action.deviceId,
          requestedByUserId: user.id,
          originalActionId: action.actionId,
          recoveryRecordSha256,
          expectedCurrentStateSha256,
          expectedRestoredStateSha256,
          idempotencyKey,
          manifestJson: signed.manifestJson,
          manifestSha256: signed.manifestSha256,
          manifestSignature: signed.signature,
          signingKeyId: signed.signingKeyId,
        },
      });
      if (command.id === recoveryId) {
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_TRUSTED_RECOVERY_REQUESTED',
          entityType: 'MsaidiziRecoveryCommand',
          entityId: command.id,
          userId: user.id,
          companyId: action.task.companyId,
          newValue: persistedJson({
            recoveryId: command.id,
            originalActionId: action.actionId,
            deviceId: action.deviceId,
            recoveryRecordSha256,
            expectedCurrentStateSha256,
            expectedRestoredStateSha256,
            uncertainCheckpointRecovery,
            lateCommittedCheckpointRecovery,
            manifestSha256: signed.manifestSha256,
          }),
          severity: AuditSeverity.CRITICAL,
          channel: AuditChannel.WEB,
          principalType: 'HUMAN',
          initiatedByUserId: user.id,
          taskId: action.taskId,
          stepId: action.stepId,
          deviceId: action.deviceId,
        });
      }
      return command;
    });
  }

  list(query: QueryMsaidiziRecoveryDto, user: AuthUser) {
    return this.prisma.msaidiziRecoveryCommand.findMany({
      where: {
        ...(query.status ? { status: query.status as MsaidiziRecoveryCommandStatus } : {}),
        hostAction: { task: taskCompanyScope(user) },
      },
      select: recoveryProjection,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string, user: AuthUser) {
    const command = await this.prisma.msaidiziRecoveryCommand.findFirst({
      where: { id, hostAction: { task: taskCompanyScope(user) } },
      select: recoveryProjection,
    });
    if (!command) throw new NotFoundException('Recovery command not found');
    return command;
  }

  async poll(dto: PollMsaidiziRecoveryDto, request: Request) {
    this.signer.assertReady();
    const device = await this.authenticatedDevice(dto.deviceId, request);
    const staleBefore = new Date(Date.now() - this.signer.redeliverySeconds * 1_000);
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.msaidiziRecoveryCommand.findFirst({
        where: {
          deviceId: device.id,
          OR: [
            { status: MsaidiziRecoveryCommandStatus.QUEUED },
            { status: { in: [...ACTIVE_RECOVERY_STATES] }, updatedAt: { lte: staleBefore } },
          ],
        },
        include: { hostAction: { include: { task: true } } },
        orderBy: { queuedAt: 'asc' },
      });
      if (!command) return { recoveryId: null };

      const isActive = ACTIVE_RECOVERY_STATES.includes(
        command.status as (typeof ACTIVE_RECOVERY_STATES)[number],
      );
      const terminalReason = isActive
        ? recoveryManifestExpired(command.manifestJson)
          ? 'RECOVERY_MANIFEST_EXPIRED_UNSEEN'
          : command.dispatchCount >= MAX_RECOVERY_DELIVERY_SESSIONS
            ? 'RECOVERY_DISPATCH_LIMIT_EXHAUSTED'
            : null
        : null;
      if (terminalReason) {
        const now = new Date();
        const summary = persistedJson({
          reason: terminalReason,
          manifestSha256: command.manifestSha256,
          dispatchCount: command.dispatchCount,
          maximumDeliverySessions: MAX_RECOVERY_DELIVERY_SESSIONS,
          terminalizedAt: now.toISOString(),
        });
        const stopped = await tx.msaidiziRecoveryCommand.updateMany({
          where: {
            id: command.id,
            status: command.status,
            updatedAt: command.updatedAt,
            resultDigest: null,
          },
          data: {
            status: MsaidiziRecoveryCommandStatus.NEEDS_ATTENTION,
            resultSummary: summary,
            completedAt: now,
          },
        });
        if (stopped.count !== 1) return { recoveryId: null };
        await tx.msaidiziTaskEvent.create({
          data: {
            taskId: command.hostAction.taskId,
            type: 'host_action.recovery_delivery_exhausted',
            actorType: 'RECOVERY_BROKER',
            actorId: device.id,
            payload: persistedJson({
              recoveryId: command.id,
              originalActionId: command.originalActionId,
              deviceId: device.id,
              ...summary,
            }),
          },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_TRUSTED_RECOVERY_DELIVERY_EXHAUSTED',
          entityType: 'MsaidiziRecoveryCommand',
          entityId: command.id,
          userId: command.requestedByUserId,
          companyId: command.hostAction.task.companyId,
          newValue: summary,
          severity: AuditSeverity.CRITICAL,
          channel: AuditChannel.SYSTEM,
          principalType: 'TRUSTED_SUPERVISOR',
          principalId: command.hostAction.task.principalId,
          mandateId: command.hostAction.task.mandateId,
          initiatedByUserId: command.requestedByUserId,
          taskId: command.hostAction.taskId,
          stepId: command.hostAction.stepId,
          deviceId: device.id,
        });
        await tx.notification.upsert({
          where: {
            notificationNumber: `MSAIDIZI-RECOVERY-${command.id}-DELIVERY-NEEDS-ATTENTION`,
          },
          update: {},
          create: {
            notificationNumber: `MSAIDIZI-RECOVERY-${command.id}-DELIVERY-NEEDS-ATTENTION`,
            recipientUserId: command.requestedByUserId,
            companyId: command.hostAction.task.companyId,
            title: 'Msaidizi recovery delivery needs attention',
            message:
              terminalReason === 'RECOVERY_MANIFEST_EXPIRED_UNSEEN'
                ? 'The trusted recovery manifest expired before a result was observed. Inspect the device and recovery ledger.'
                : 'The trusted recovery command reached its delivery-session limit without a result. Inspect the device and recovery ledger.',
            notificationType: NotificationType.SECURITY_ALERT,
            priority: NotificationPriority.CRITICAL,
            linkedEntityType: 'MsaidiziRecoveryCommand',
            linkedEntityId: command.id,
            actionUrl: `/msaidizi?workspace=devices&deviceId=${device.id}&recoveryId=${command.id}`,
          },
        });
        return { recoveryId: null, needsAttention: true, reason: terminalReason };
      }

      // Once a command crosses the supervisor boundary, its signed manifest is
      // the immutable execution identity used by the durable result cache.
      // Refresh only before first dispatch; active redelivery is bounded and
      // stops before an expired manifest could thrash indefinitely.
      const refreshed =
        command.status === MsaidiziRecoveryCommandStatus.QUEUED
          ? this.refreshManifest(command)
          : null;
      const currentStatus = command.status;
      const won = await tx.msaidiziRecoveryCommand.updateMany({
        where: { id: command.id, status: currentStatus, updatedAt: command.updatedAt },
        data: {
          status: MsaidiziRecoveryCommandStatus.DISPATCHED,
          dispatchCount: { increment: 1 },
          dispatchedAt: new Date(),
          ...(refreshed
            ? {
                manifestJson: refreshed.manifestJson,
                manifestSha256: refreshed.manifestSha256,
                manifestSignature: refreshed.signature,
                signingKeyId: refreshed.signingKeyId,
              }
            : {}),
        },
      });
      if (won.count !== 1) return { recoveryId: null };
      return {
        recoveryId: command.id,
        manifestJson: refreshed?.manifestJson ?? command.manifestJson,
        manifestSha256: refreshed?.manifestSha256 ?? command.manifestSha256,
        signature: refreshed?.signature ?? command.manifestSignature,
        signingKeyId: refreshed?.signingKeyId ?? command.signingKeyId,
      };
    });
  }

  async progress(dto: MsaidiziRecoveryProgressDto, request: Request) {
    const device = await this.authenticatedDevice(dto.deviceId, request);
    const won = await this.prisma.msaidiziRecoveryCommand.updateMany({
      where: {
        id: dto.recoveryId,
        deviceId: device.id,
        status: { in: [...ACTIVE_RECOVERY_STATES] },
      },
      data: {
        status: MsaidiziRecoveryCommandStatus.RECOVERING,
        supervisorJournalHead: dto.journalHeadSha256.toLowerCase(),
        startedAt: new Date(),
      },
    });
    if (won.count !== 1) throw new ConflictException('Invalid recovery progress transition');
    return { accepted: true };
  }

  async result(dto: MsaidiziRecoveryResultDto, request: Request) {
    const device = await this.authenticatedDevice(dto.deviceId, request, true);
    const digest = resultDigest(dto);
    return this.prisma.$transaction(async (tx) => {
      const command = await tx.msaidiziRecoveryCommand.findFirst({
        where: { id: dto.recoveryId, deviceId: device.id },
        include: { hostAction: { include: { task: true } } },
      });
      if (!command) throw new NotFoundException('Recovery command not found');
      if (command.manifestSha256 !== dto.manifestSha256.toLowerCase()) {
        throw new ConflictException('Result does not match the signed recovery manifest');
      }
      if (command.resultDigest) {
        if (command.resultDigest !== digest) {
          throw new ConflictException('A different recovery result was already recorded');
        }
        return { accepted: true, replay: true, status: command.status };
      }
      const lateTerminalEvidence =
        command.status === MsaidiziRecoveryCommandStatus.NEEDS_ATTENTION &&
        LATE_RECOVERY_RESULT_REASONS.has(String(jsonObject(command.resultSummary).reason));
      if (
        !ACTIVE_RECOVERY_STATES.includes(
          command.status as (typeof ACTIVE_RECOVERY_STATES)[number],
        ) &&
        !lateTerminalEvidence
      ) {
        throw new ConflictException('Recovery result transition was rejected');
      }

      const outcome = dto.outcome as MsaidiziRecoveryCommandStatus;
      const expectedRestoredStateSha256 = normalizedDigest(command.expectedRestoredStateSha256);
      if (
        outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED &&
        (!expectedRestoredStateSha256 ||
          dto.restoredStateSha256?.toLowerCase() !== expectedRestoredStateSha256)
      ) {
        throw new ConflictException('Supervisor did not prove the immutable pre-action state');
      }
      const now = new Date();
      const summary = persistedJson({
        outcome,
        manifestSha256: dto.manifestSha256.toLowerCase(),
        journalHeadSha256: dto.journalHeadSha256.toLowerCase(),
        restoredStateSha256: dto.restoredStateSha256?.toLowerCase(),
        expectedRestoredStateSha256,
        reason: dto.reason,
        deviceId: device.id,
        receivedAt: now.toISOString(),
      });
      const won = await tx.msaidiziRecoveryCommand.updateMany({
        where: {
          id: command.id,
          resultDigest: null,
          expectedRestoredStateSha256: command.expectedRestoredStateSha256,
          status: lateTerminalEvidence
            ? MsaidiziRecoveryCommandStatus.NEEDS_ATTENTION
            : { in: [...ACTIVE_RECOVERY_STATES] },
        },
        data: {
          status: outcome,
          resultDigest: digest,
          resultSummary: summary,
          supervisorJournalHead: dto.journalHeadSha256.toLowerCase(),
          completedAt: now,
        },
      });
      if (won.count !== 1) throw new ConflictException('Recovery result transition was rejected');

      await tx.msaidiziTaskEvent.create({
        data: {
          taskId: command.hostAction.taskId,
          type:
            outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED
              ? 'host_action.recovered'
              : 'host_action.recovery_failed',
          actorType: 'TRUSTED_SUPERVISOR',
          actorId: device.id,
          payload: persistedJson({
            recoveryId: command.id,
            originalActionId: command.originalActionId,
            deviceId: device.id,
            outcome,
            manifestSha256: command.manifestSha256,
            journalHeadSha256: dto.journalHeadSha256.toLowerCase(),
            restoredStateSha256: dto.restoredStateSha256?.toLowerCase(),
            expectedRestoredStateSha256,
          }),
        },
      });
      await this.audit.logStrictInTransaction(tx, {
        action:
          outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED
            ? 'MSAIDIZI_TRUSTED_RECOVERY_SUCCEEDED'
            : 'MSAIDIZI_TRUSTED_RECOVERY_FAILED',
        entityType: 'MsaidiziRecoveryCommand',
        entityId: command.id,
        userId: command.requestedByUserId,
        companyId: command.hostAction.task.companyId,
        newValue: summary,
        severity:
          outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED
            ? AuditSeverity.HIGH
            : AuditSeverity.CRITICAL,
        channel: AuditChannel.SYSTEM,
        principalType: 'TRUSTED_SUPERVISOR',
        principalId: command.hostAction.task.principalId,
        mandateId: command.hostAction.task.mandateId,
        initiatedByUserId: command.requestedByUserId,
        taskId: command.hostAction.taskId,
        stepId: command.hostAction.stepId,
        deviceId: device.id,
      });
      await tx.notification.upsert({
        where: { notificationNumber: `MSAIDIZI-RECOVERY-${command.id}-${outcome}` },
        update: {},
        create: {
          notificationNumber: `MSAIDIZI-RECOVERY-${command.id}-${outcome}`,
          recipientUserId: command.requestedByUserId,
          companyId: command.hostAction.task.companyId,
          title:
            outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED
              ? 'Msaidizi recovery completed'
              : 'Msaidizi recovery needs attention',
          message:
            outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED
              ? 'The trusted supervisor restored the exact quarantined entry and verified its recorded state.'
              : 'The trusted supervisor could not prove a safe recovery result. Inspect the recovery ledger.',
          notificationType: NotificationType.SECURITY_ALERT,
          priority:
            outcome === MsaidiziRecoveryCommandStatus.SUCCEEDED
              ? NotificationPriority.HIGH
              : NotificationPriority.CRITICAL,
          linkedEntityType: 'MsaidiziRecoveryCommand',
          linkedEntityId: command.id,
          actionUrl: `/msaidizi?workspace=devices&deviceId=${device.id}&recoveryId=${command.id}`,
        },
      });
      return { accepted: true, replay: false, status: outcome };
    });
  }

  private refreshManifest(command: {
    id: string;
    deviceId: string;
    originalActionId: string;
    recoveryRecordSha256: string;
    expectedCurrentStateSha256: string;
    expectedRestoredStateSha256: string | null;
    idempotencyKey: string;
    manifestJson: string;
  }) {
    try {
      const parsed = JSON.parse(command.manifestJson) as Record<string, unknown>;
      const expiresAt = new Date(String(parsed.expiresAt));
      const expectedRestoredStateSha256 = normalizedDigest(command.expectedRestoredStateSha256);
      const schemaVersion = parsed.schemaVersion;
      if (
        (schemaVersion !== 1 && schemaVersion !== 2) ||
        !expectedRestoredStateSha256 ||
        parsed.recoveryId !== command.id ||
        parsed.deviceId !== command.deviceId ||
        parsed.originalActionId !== command.originalActionId ||
        parsed.recoveryRecordSha256 !== command.recoveryRecordSha256 ||
        parsed.expectedCurrentStateSha256 !== command.expectedCurrentStateSha256 ||
        (schemaVersion === 2 &&
          parsed.expectedRestoredStateSha256 !== expectedRestoredStateSha256) ||
        parsed.idempotencyKey !== command.idempotencyKey
      ) {
        throw new Error('manifest claims mismatch');
      }
      if (schemaVersion === 2 && expiresAt.getTime() > Date.now() + 60_000) return null;
      return this.signer.issue({
        schemaVersion: 2,
        recoveryId: command.id,
        deviceId: command.deviceId,
        originalActionId: command.originalActionId,
        recoveryRecordSha256: command.recoveryRecordSha256,
        expectedCurrentStateSha256: command.expectedCurrentStateSha256,
        expectedRestoredStateSha256,
        idempotencyKey: command.idempotencyKey,
      });
    } catch {
      throw new ConflictException('The queued signed recovery manifest is invalid');
    }
  }

  private async authenticatedDevice(
    deviceId: string,
    request: Request,
    terminalEvidenceOnly = false,
  ) {
    const peer = directMtlsPeer(request);
    if (!peer.publicKeySpkiSha256) {
      throw new UnauthorizedException('The recovery supervisor TLS peer has no SPKI identity');
    }
    const device = await this.prisma.msaidiziDevice.findFirst({
      where: {
        id: deviceId,
        status: terminalEvidenceOnly
          ? {
              in: [
                MsaidiziDeviceStatus.ACTIVE,
                MsaidiziDeviceStatus.OFFLINE,
                MsaidiziDeviceStatus.KILLED,
              ],
            }
          : MsaidiziDeviceStatus.ACTIVE,
        recoverySupervisorCertificateSha256: peer.certificateSha256,
        recoverySupervisorPublicKeySpkiSha256: peer.publicKeySpkiSha256,
      },
      select: { id: true },
    });
    if (!device) {
      throw new UnauthorizedException(
        'The recovery supervisor TLS identity is not bound to this device',
      );
    }
    return device;
  }
}

const recoveryProjection = {
  id: true,
  hostActionId: true,
  deviceId: true,
  requestedByUserId: true,
  originalActionId: true,
  recoveryRecordSha256: true,
  expectedCurrentStateSha256: true,
  expectedRestoredStateSha256: true,
  status: true,
  manifestSha256: true,
  signingKeyId: true,
  dispatchCount: true,
  resultSummary: true,
  supervisorJournalHead: true,
  queuedAt: true,
  dispatchedAt: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MsaidiziRecoveryCommandSelect;

function taskCompanyScope(user: AuthUser): Prisma.MsaidiziTaskWhereInput {
  const companyScope = companyWhereForUser(user);
  return isGroupScopedUser(user) ? { OR: [{ companyId: null }, companyScope] } : companyScope;
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {};
}

function digestField(value: Prisma.JsonObject, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' && /^[0-9a-f]{64}$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

function hasVerifiedRecoveryPreparedEvidence(
  action: {
    taskId: string;
    deviceId: string;
    expectedPreState: Prisma.JsonValue;
    journalExpectedPreviousSequence: number | null;
    journalPrepareSequence: number | null;
    journalPreparePreviousHash: string | null;
    journalPrepareHash: string | null;
    journalRecoveryPreparedSequence: number | null;
    journalRecoveryPreparedPreviousHash: string | null;
    journalRecoveryPreparedHash: string | null;
    journalSequence: number | null;
    journalPreviousHash: string | null;
    journalHash: string | null;
    journalReceiptDigest: string | null;
    journalEvidenceEventCursor: bigint | null;
    journalEvidenceAcceptedAt: Date | null;
    recoveryRecordSha256: string | null;
    expectedRestoredStateSha256: string | null;
  },
  summary: Prisma.JsonObject,
  event: {
    cursor: bigint;
    taskId: string;
    type: string;
    actorType: string;
    actorId: string | null;
    payload: Prisma.JsonValue;
    integrityVersion: number;
    previousHash: string;
    eventHash: string;
  } | null,
  expected: {
    eventTypes: ReadonlySet<string>;
    outcome: 'Completed' | 'NeedsAttention';
    outcomeUncertain: boolean;
    mutationCommitted: boolean;
  },
): boolean {
  if (
    !event ||
    action.journalEvidenceEventCursor == null ||
    action.journalEvidenceAcceptedAt == null ||
    action.journalReceiptDigest == null ||
    event.cursor !== action.journalEvidenceEventCursor ||
    event.taskId !== action.taskId ||
    !expected.eventTypes.has(event.type) ||
    event.actorType !== 'DEVICE_BROKER' ||
    event.actorId !== action.deviceId ||
    event.integrityVersion !== 1 ||
    digestField({ value: event.previousHash }, 'value') == null ||
    digestField({ value: event.eventHash }, 'value') == null
  ) {
    return false;
  }
  const payload = jsonObject(event.payload);
  if (!hasVerifiedRecoveryPreparedChain(summary) || !hasVerifiedRecoveryPreparedChain(payload)) {
    return false;
  }
  const expectedPreviousSequence = safeNonNegativeInteger(action.journalExpectedPreviousSequence);
  const prepareSequence = safePositiveInteger(action.journalPrepareSequence);
  const checkpointSequence = safePositiveInteger(action.journalRecoveryPreparedSequence);
  const terminalSequence = safePositiveInteger(action.journalSequence);
  const typedDigests = {
    preparePrevious: normalizedDigest(action.journalPreparePreviousHash),
    prepare: normalizedDigest(action.journalPrepareHash),
    checkpointPrevious: normalizedDigest(action.journalRecoveryPreparedPreviousHash),
    checkpoint: normalizedDigest(action.journalRecoveryPreparedHash),
    terminalPrevious: normalizedDigest(action.journalPreviousHash),
    terminal: normalizedDigest(action.journalHash),
  };
  const expectedPreStateSha256 = digestField(jsonObject(action.expectedPreState), 'sha256');
  const recoveryRecordSha256 = normalizedDigest(action.recoveryRecordSha256);
  const expectedRestoredStateSha256 = normalizedDigest(action.expectedRestoredStateSha256);
  if (
    expectedPreviousSequence == null ||
    prepareSequence !== expectedPreviousSequence + 1 ||
    checkpointSequence !== prepareSequence + 1 ||
    terminalSequence !== checkpointSequence + 1 ||
    Object.values(typedDigests).some((digest) => digest == null) ||
    typedDigests.checkpointPrevious !== typedDigests.prepare ||
    typedDigests.terminalPrevious !== typedDigests.checkpoint ||
    new Set([
      typedDigests.preparePrevious,
      typedDigests.prepare,
      typedDigests.checkpoint,
      typedDigests.terminal,
    ]).size !== 4 ||
    !recoveryRecordSha256 ||
    !expectedRestoredStateSha256 ||
    expectedRestoredStateSha256 !== expectedPreStateSha256 ||
    expectedRestoredStateSha256 !== digestField(summary, 'preStateSha256') ||
    recoveryRecordSha256 !== digestField(summary, 'recoveryProvenanceSha256')
  ) {
    return false;
  }
  return [summary, payload].every(
    (projection) =>
      safePositiveInteger(projection.journalPrepareSequence) === prepareSequence &&
      safePositiveInteger(projection.journalRecoveryPreparedSequence) === checkpointSequence &&
      safePositiveInteger(projection.journalSequence) === terminalSequence &&
      digestField(projection, 'journalPreparePreviousHash') === typedDigests.preparePrevious &&
      digestField(projection, 'journalPrepareEntryHash') === typedDigests.prepare &&
      digestField(projection, 'journalRecoveryPreparedPreviousHash') ===
        typedDigests.checkpointPrevious &&
      digestField(projection, 'journalRecoveryPreparedEntryHash') === typedDigests.checkpoint &&
      digestField(projection, 'journalPreviousHash') === typedDigests.terminalPrevious &&
      digestField(projection, 'journalEntryHash') === typedDigests.terminal &&
      digestField(projection, 'receiptDigest') === action.journalReceiptDigest!.toLowerCase() &&
      projection.outcome === expected.outcome &&
      projection.outcomeUncertain === expected.outcomeUncertain &&
      projection.mutationCommitted === expected.mutationCommitted &&
      digestField(projection, 'preStateSha256') === expectedRestoredStateSha256 &&
      digestField(projection, 'recoveryProvenanceSha256') === recoveryRecordSha256 &&
      digestField(projection, 'recoveryHandleSha256') ===
        digestField(summary, 'recoveryHandleSha256'),
  );
}

function hasVerifiedRecoveryPreparedChain(value: Prisma.JsonObject): boolean {
  const prepareSequence = safePositiveInteger(value.journalPrepareSequence);
  const recoveryPreparedSequence = safePositiveInteger(value.journalRecoveryPreparedSequence);
  const terminalSequence = safePositiveInteger(value.journalSequence);
  const preparePreviousHash = digestField(value, 'journalPreparePreviousHash');
  const prepareHash = digestField(value, 'journalPrepareEntryHash');
  const recoveryPreparedPreviousHash = digestField(value, 'journalRecoveryPreparedPreviousHash');
  const recoveryPreparedHash = digestField(value, 'journalRecoveryPreparedEntryHash');
  const terminalPreviousHash = digestField(value, 'journalPreviousHash');
  const terminalHash = digestField(value, 'journalEntryHash');
  const distinctHeads = [preparePreviousHash, prepareHash, recoveryPreparedHash, terminalHash];
  return (
    digestField(value, 'preStateSha256') !== null &&
    digestField(value, 'recoveryProvenanceSha256') !== null &&
    digestField(value, 'recoveryHandleSha256') !== null &&
    prepareSequence !== null &&
    recoveryPreparedSequence === prepareSequence + 1 &&
    terminalSequence === recoveryPreparedSequence + 1 &&
    preparePreviousHash !== null &&
    prepareHash !== null &&
    recoveryPreparedPreviousHash === prepareHash &&
    recoveryPreparedHash !== null &&
    terminalPreviousHash === recoveryPreparedHash &&
    terminalHash !== null &&
    distinctHeads.every((head): head is string => head !== null) &&
    new Set(distinctHeads).size === distinctHeads.length &&
    preparePreviousHash !== prepareHash &&
    recoveryPreparedPreviousHash !== recoveryPreparedHash &&
    terminalPreviousHash !== terminalHash
  );
}

function normalizedDigest(value: string | null): string | null {
  return value && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function safeNonNegativeInteger(value: number | null): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safePositiveInteger(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function resultDigest(dto: MsaidiziRecoveryResultDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        deviceId: dto.deviceId,
        recoveryId: dto.recoveryId,
        outcome: dto.outcome,
        manifestSha256: dto.manifestSha256.toLowerCase(),
        journalHeadSha256: dto.journalHeadSha256.toLowerCase(),
        restoredStateSha256: dto.restoredStateSha256?.toLowerCase() ?? null,
        reason: dto.reason ?? null,
      }),
      'utf8',
    )
    .digest('hex');
}

function recoveryManifestExpired(manifestJson: string, now = Date.now()): boolean {
  try {
    const parsed = JSON.parse(manifestJson) as Record<string, unknown>;
    const expiresAt = Date.parse(String(parsed.expiresAt));
    return !Number.isFinite(expiresAt) || expiresAt <= now;
  } catch {
    return true;
  }
}

function persistedJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(sanitizePersistedValue(value).value)) as Prisma.InputJsonObject;
}
