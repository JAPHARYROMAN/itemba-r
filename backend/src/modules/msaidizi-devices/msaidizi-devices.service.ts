import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditChannel,
  AuditSeverity,
  MsaidiziArtifactKind,
  MsaidiziDeviceLeaseStatus,
  MsaidiziDeviceStatus,
  MsaidiziEffect,
  MsaidiziHostActionFenceStatus,
  MsaidiziHostActionStatus,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  MsaidiziTrustLevel,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateDeploymentOperation,
  MsaidiziUpdateDeploymentStatus,
  Prisma,
} from '@prisma/client';
import { createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  grantAllowsExternalDestinationAuthority,
  requestedExternalDestinationAuthority,
} from '../../common/policies/external-destination-authority';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService, redactSensitiveFields } from '../audit-logs/audit-logs.service';
import {
  HostObservationMediaBinding,
  MsaidiziArtifactsService,
  PreparedToolObservationArtifact,
  ToolObservationArtifactInput,
} from '../msaidizi-artifacts/msaidizi-artifacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { preparePersistedUntrustedObservation } from '../msaidizi-task-runtime/persisted-observation';
import {
  parseStepBudgets,
  stepLocalIoState,
} from '../msaidizi-task-runtime/msaidizi-step-controls';
import {
  checkpointTaskWallTimeForAuthorization,
  remainingTaskWallTimeMs,
} from '../msaidizi-task-runtime/msaidizi-task-wall-time';
import {
  MsaidiziInputBindingError,
  ResolvedStepInputs,
  resolveStepInputs,
  staticStepInputs,
} from '../msaidizi-tasks/msaidizi-input-bindings';
import { ActionBudgetClaims, ActionTokenService } from './action-token.service';
import {
  actionOutcome,
  capabilityConsent,
  capabilityDataClass,
  capabilityEffect,
  capabilityRecovery,
  findCapability,
  fixedTimeHexEquals,
  jsonSha256,
  leaseTokenDigest,
  normalisePairingCode,
  pairingCodeDigest,
  pairingMarker,
  parsePairingExpiry,
  progressState,
  sha256Hex,
  stableJson,
  supervisorEnrollmentCodeDigest,
  validateCapabilityManifest,
} from './device-security';
import { directMtlsPeer } from './direct-mtls-peer';
import {
  ActionFencedReceiptDto,
  ActionProgressDto,
  ActionResultDto,
  CapabilityManifestSnapshotDto,
  CompanionHeartbeatDto,
  CompletePairingDto,
  CompleteSupervisorEnrollmentDto,
  CreatePairingCodeDto,
  CreateSupervisorEnrollmentCodeDto,
  PollDeviceCommandsDto,
} from './dto/msaidizi-device.dto';
import { MsaidiziDeviceConfig } from './msaidizi-device.config';
import { MsaidiziDeviceJournalLedgerService } from './msaidizi-device-journal-ledger.service';
import {
  EgressReceiptProof,
  egressEvidenceSha256,
  parseWireEgressReceiptProof,
} from './egress-receipt.protocol';
import {
  EgressReceiptVerificationError,
  VerifiedEgressReceiptProof,
  verifyEgressReceiptProof,
} from './egress-receipt-verifier';
import { FenceActionTokenService } from './fence-action-token.service';
import {
  isUnavailableHostFileContentCapability,
  REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
} from './host-file-ephemerality.policy';
import {
  decodeBoundHostFileRead,
  hostFileReceiptMatches,
  HostFileObservationBinding,
} from './host-file-observation';

const ACTIVE_ACTIONS = [
  MsaidiziHostActionStatus.QUEUED,
  MsaidiziHostActionStatus.DISPATCHED,
  MsaidiziHostActionStatus.RUNNING,
] as const;
const LOCAL_STT_CAPABILITY = 'speech.audio.transcribe';
const PRIVILEGED_COMMAND_CAPABILITY = 'command.privileged.execute';
const ONE_SHOT_CONSENT_CAPABILITIES = new Set([
  LOCAL_STT_CAPABILITY,
  PRIVILEGED_COMMAND_CAPABILITY,
]);
const LOCAL_STT_PROTOCOL = 'msaidizi-local-stt/v1';
const ONE_SHOT_CONSENT_PROTOCOL = 'msaidizi-one-shot-step-consent/v1';
const RAW_MICROPHONE_CAPABILITY = 'audio.microphone.capture';
const LATE_RECOVERY_EVIDENCE_ERROR_CODES = new Set(['DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN']);
const LATE_EVIDENCE_REJECTED_ERROR_CODE = 'DEVICE_LATE_EVIDENCE_REJECTED';
const DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED = 'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED';
const CANDIDATE_DEVICE_LOCK_RETRY_LIMIT = 8;

type InterruptedUpdateDeployment = {
  id: string;
  candidateId: string;
  operation: MsaidiziUpdateDeploymentOperation;
  status: MsaidiziUpdateDeploymentStatus;
};

class InterruptedUpdateCandidateSetChangedError extends Error {
  constructor() {
    super('The active update candidate set changed while locking the device');
    this.name = 'InterruptedUpdateCandidateSetChangedError';
  }
}

const STOPPING_TASKS = [
  MsaidiziTaskStatus.CANCELLING,
  MsaidiziTaskStatus.CANCELLED,
  MsaidiziTaskStatus.NEEDS_ATTENTION,
  MsaidiziTaskStatus.FAILED,
  MsaidiziTaskStatus.PARTIAL,
  MsaidiziTaskStatus.COMPLETED,
] as const;
const DISPATCHABLE_TASKS = [MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.PAUSING] as const;

export const BROKER_MAX_DELIVERY_SESSIONS = 3;
export const BROKER_MAX_REQUEST_ATTEMPTS_PER_SESSION = 3;
export const BROKER_MAX_AGGREGATE_EGRESS_BYTES = 16_777_216;
export const BROKER_MIN_SERIALIZED_RESULT_UPPER_BOUND_BYTES = 65_536;

const BROWSER_EGRESS_CAPABILITIES = new Set([
  'browser.uri.open',
  'ui.element.invoke',
  'browser.form.text.set',
  'browser.form.secret.set',
  'browser.file.upload',
  'browser.download.invoke',
]);
const METERED_EGRESS_CAPABILITIES = new Set([
  ...BROWSER_EGRESS_CAPABILITIES,
  'command.emergency.execute',
  'command.privileged.execute',
]);
const EGRESS_MAX_CLOCK_SKEW_MILLISECONDS = 30_000;
const EGRESS_MAX_ATTESTATION_LIFETIME_MILLISECONDS = 5 * 60_000;
const EGRESS_MAX_LEASE_LIFETIME_MILLISECONDS = 16 * 60_000;

interface EgressSettlementAction {
  id: string;
  actionId: string;
  actionTokenDigest: string;
  taskId: string;
  stepId: string;
  deviceId: string;
  capability: string;
  capabilityVersion: string;
  argsDigest: string;
  expectedPreState: Prisma.JsonValue;
  idempotencyKey: string;
  dispatchCount: number;
  reservedExternalEgressBytes: bigint;
  brokerMaxDeliverySessions: number;
  brokerMaxRequestAttemptsPerSession: number;
  brokerSerializedResultUpperBoundBytes: number;
  dispatches?: readonly {
    actionTokenDigest: string;
    dispatchCount: number;
    executionMode: string;
    tokenIssuedAt: Date | null;
    tokenExpiresAt: Date | null;
    leaseAuthorizationExpiresAt: Date;
  }[];
  step: { planVersionId: string; arguments: Prisma.JsonValue };
  task: { mandateId: string | null; mode: MsaidiziTaskMode };
  device: {
    egressBoundaryKeyId: string | null;
    egressBoundaryPublicKey: string | null;
    egressBoundaryPublicKeySha256: string | null;
    egressDestinationPolicySha256: string | null;
    egressExecutionIdentitySha256: string | null;
  };
}

interface EgressSettlementVerification {
  required: boolean;
  valid: boolean;
  errorCode: string | null;
  proof: EgressReceiptProof | null;
  verified: VerifiedEgressReceiptProof | null;
  authorizedDispatchCount: number | null;
}

export class HostActionPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HostActionPolicyError';
  }
}

export interface DeviceCommand {
  kind: 'execute' | 'replay-result' | 'fence-action' | 'cancel' | 'ping';
  [key: string]: unknown;
}

interface HostObservationArtifactReference {
  artifactId: string;
  artifactSha256: string;
  artifactBytes: number;
  artifactMimeType: string;
  artifactKind: MsaidiziArtifactKind;
  trustLevel: 'UNTRUSTED';
  provenance:
    | {
        sourceType: 'HOST_RESULT';
        capability: string;
        mediaType: string;
        contentSha256: string;
      }
    | {
        sourceType: 'HOST_RESULT';
        capability: 'filesystem.file.read';
        mediaType: string;
        contentSha256: string;
        argumentsSha256: string;
        sourceIdentifierSha256: string;
        extension: string;
      };
  replay: boolean;
  /** Host-local usage was committed atomically with this artifact. */
  localIoAccounted: boolean;
}

interface AuthenticatedDeviceIdentity {
  certificateThumbprint: string;
  publicKeySha256: string;
}

interface PersistedHostObservation {
  observation: Prisma.InputJsonObject;
  artifact?: HostObservationArtifactReference;
  /** Opaque encrypted preparation; never serialize this into summaries/events. */
  preparedArtifact?: PreparedToolObservationArtifact;
}

@Injectable()
export class MsaidiziDevicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MsaidiziDevicesService.name);
  private leaseSweepTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MsaidiziDeviceConfig,
    private readonly signer: ActionTokenService,
    private readonly audit: AuditLogsService,
    private readonly notifications?: NotificationsService,
    private readonly artifacts?: MsaidiziArtifactsService,
    private readonly fenceSigner?: FenceActionTokenService,
    private readonly journalLedger?: MsaidiziDeviceJournalLedgerService,
  ) {}

  onModuleInit(): void {
    const reconcile = async () => {
      await this.reconcileGlobalKill();
      if (this.config.channelEnabled) await this.expireAllLeases();
    };
    void this.reconcileGlobalKill().catch(() => {
      this.logger.error('The Msaidizi deployment global-kill reconciliation failed');
    });
    if (!this.config.channelEnabled && !this.config.globalKillSwitchActive) return;
    this.leaseSweepTimer = setInterval(() => {
      void reconcile().catch(() => {
        this.logger.error('The Msaidizi device lease/global-kill sweep failed');
      });
    }, 10_000);
    this.leaseSweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.leaseSweepTimer) clearInterval(this.leaseSweepTimer);
  }

  async createPairingCode(dto: CreatePairingCodeDto, user: AuthUser) {
    if (!this.config.pairingReady() || !this.config.pairingPepper) {
      throw new ServiceUnavailableException('Device pairing is disabled or not safely configured');
    }
    const principal = await this.requireGlobalPrincipal();
    const deviceId = randomUUID();
    const pairingCode = formatPairingCode(randomBytes(6).toString('hex').toUpperCase());
    const expiresAt = new Date(Date.now() + this.config.pairingTtlSeconds * 1_000);
    const digest = pairingCodeDigest(this.config.pairingPepper, deviceId, pairingCode);
    const device = await this.prisma.msaidiziDevice.create({
      data: {
        id: deviceId,
        principalId: principal.id,
        name: dto.name.trim(),
        status: MsaidiziDeviceStatus.PENDING,
        platform: 'windows',
        publicKey: pairingMarker(digest),
        capabilityManifest: {
          protocolVersion: 1,
          pairing: { expiresAt: expiresAt.toISOString(), initiatedByUserId: user.id },
        },
      },
      select: { id: true, name: true, status: true, createdAt: true },
    });
    await this.audit.log({
      action: 'MSAIDIZI_DEVICE_PAIRING_CODE_CREATED',
      entityType: 'MsaidiziDevice',
      entityId: device.id,
      userId: user.id,
      principalType: 'MSAIDIZI',
      principalId: principal.id,
      newValue: { id: device.id, name: device.name, status: device.status, expiresAt },
    });
    return { ...device, pairingCode, expiresAt };
  }

  async createSupervisorEnrollmentCode(
    deviceId: string,
    dto: CreateSupervisorEnrollmentCodeDto,
    user: AuthUser,
  ) {
    const pepper = this.config.supervisorEnrollmentPepper;
    if (!this.config.supervisorEnrollmentReady() || !pepper) {
      throw new ServiceUnavailableException(
        'Role-specific supervisor enrollment is disabled or not safely configured',
      );
    }
    const enrollmentId = randomUUID();
    const enrollmentCode = formatEnrollmentCode(randomBytes(16).toString('hex').toUpperCase());
    const expiresAt = new Date(Date.now() + this.config.supervisorEnrollmentTtlSeconds * 1_000);
    const challengeDigest = supervisorEnrollmentCodeDigest(
      pepper,
      enrollmentId,
      deviceId,
      dto.role,
      enrollmentCode,
    );
    const challenge = await this.prisma.$transaction(async (tx) => {
      await lockSupervisorEnrollment(tx);
      const device = await tx.msaidiziDevice.findFirst({
        where: {
          id: deviceId,
          status: { in: [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE] },
        },
        select: {
          id: true,
          principalId: true,
          updateSupervisorCertificateSha256: true,
          updateSupervisorPublicKeySpkiSha256: true,
          recoverySupervisorCertificateSha256: true,
          recoverySupervisorPublicKeySpkiSha256: true,
        },
      });
      if (!device) throw new NotFoundException('Enrolled device not found');
      const existing = supervisorIdentityForRole(device, dto.role);
      if (existing.certificateSha256 || existing.publicKeySpkiSha256) {
        throw new ConflictException(`The ${dto.role.toLowerCase()} supervisor is already enrolled`);
      }
      const now = new Date();
      await tx.msaidiziSupervisorEnrollmentChallenge.updateMany({
        where: { deviceId, role: dto.role, consumedAt: null },
        data: { consumedAt: now },
      });
      return tx.msaidiziSupervisorEnrollmentChallenge.create({
        data: {
          id: enrollmentId,
          deviceId,
          role: dto.role,
          challengeDigest,
          createdByUserId: user.id,
          expiresAt,
        },
        select: { id: true, deviceId: true, role: true, expiresAt: true },
      });
    });
    await this.audit.log({
      action: 'MSAIDIZI_SUPERVISOR_ENROLLMENT_CODE_CREATED',
      entityType: 'MsaidiziDevice',
      entityId: deviceId,
      userId: user.id,
      principalType: 'MSAIDIZI',
      deviceId,
      metadata: { role: challenge.role, enrollmentId: challenge.id, expiresAt },
    });
    return { ...challenge, enrollmentCode };
  }

  async list() {
    const principal = await this.findGlobalPrincipal();
    if (!principal) return { items: [], total: 0 };
    const items = await this.prisma.msaidiziDevice.findMany({
      where: { principalId: principal.id },
      select: {
        id: true,
        name: true,
        status: true,
        platform: true,
        osVersion: true,
        architecture: true,
        certificateThumbprint: true,
        updateSupervisorCertificateSha256: true,
        updateSupervisorPublicKeySpkiSha256: true,
        recoverySupervisorCertificateSha256: true,
        recoverySupervisorPublicKeySpkiSha256: true,
        capabilityManifest: true,
        pairedAt: true,
        lastSeenAt: true,
        revokedAt: true,
        killedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: items.map((item) => {
        const {
          updateSupervisorCertificateSha256,
          updateSupervisorPublicKeySpkiSha256,
          recoverySupervisorCertificateSha256,
          recoverySupervisorPublicKeySpkiSha256,
          ...device
        } = item;
        return {
          ...device,
          updateSupervisorEnrolled: Boolean(
            updateSupervisorCertificateSha256 && updateSupervisorPublicKeySpkiSha256,
          ),
          recoverySupervisorEnrolled: Boolean(
            recoverySupervisorCertificateSha256 && recoverySupervisorPublicKeySpkiSha256,
          ),
        };
      }),
      total: items.length,
    };
  }

  async revoke(deviceId: string, user: AuthUser) {
    return this.disableDevice(deviceId, MsaidiziDeviceStatus.REVOKED, user);
  }

  async kill(deviceId: string, user: AuthUser) {
    return this.disableDevice(deviceId, MsaidiziDeviceStatus.KILLED, user);
  }

  async killAll(user: AuthUser) {
    const principal = await this.findGlobalPrincipal();
    if (!principal) return { killed: 0 };
    const devices = await this.prisma.msaidiziDevice.findMany({
      where: {
        principalId: principal.id,
        status: {
          in: [
            MsaidiziDeviceStatus.PENDING,
            MsaidiziDeviceStatus.ACTIVE,
            MsaidiziDeviceStatus.OFFLINE,
          ],
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const now = new Date();
    let killed = 0;
    if (devices.length > 0) {
      killed = await this.prisma.$transaction(async (tx) => {
        let wonCount = 0;
        for (const device of devices) {
          const won = await tx.msaidiziDevice.updateMany({
            where: {
              id: device.id,
              principalId: principal.id,
              status: {
                in: [
                  MsaidiziDeviceStatus.PENDING,
                  MsaidiziDeviceStatus.ACTIVE,
                  MsaidiziDeviceStatus.OFFLINE,
                ],
              },
            },
            data: { status: MsaidiziDeviceStatus.KILLED, killedAt: now },
          });
          if (won.count !== 1) continue;
          wonCount += 1;
          await tx.msaidiziDeviceLease.updateMany({
            where: { deviceId: device.id, status: MsaidiziDeviceLeaseStatus.ACTIVE },
            data: { status: MsaidiziDeviceLeaseStatus.REVOKED, releasedAt: now },
          });
          await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
            kind: 'KILLED',
            deviceId: device.id,
            recipientUserId: user.id,
          });
        }
        return wonCount;
      });
    }
    // Include update commands left behind by an earlier kill-all attempt whose
    // device transition committed before reconciliation. This makes a retry
    // repair the second half even though KILLED/REVOKED devices are no longer
    // returned by the transition query above.
    const updateDevices = await this.prisma.msaidiziUpdateDeployment.findMany({
      where: {
        device: { principalId: principal.id },
        resultDigest: null,
        status: {
          in: [
            MsaidiziUpdateDeploymentStatus.QUEUED,
            MsaidiziUpdateDeploymentStatus.DISPATCHED,
            MsaidiziUpdateDeploymentStatus.APPLYING,
            MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
          ],
        },
      },
      distinct: ['deviceId'],
      select: { deviceId: true },
    });
    const updateDeviceIds = [
      ...new Set([
        ...devices.map(({ id }) => id),
        ...updateDevices.map(({ deviceId }) => deviceId),
      ]),
    ].sort();
    let interruptedUpdatesBeforeBoundary = 0;
    let interruptedUpdatesAfterBoundary = 0;
    for (const deviceId of updateDeviceIds) {
      const settled = await this.settleInterruptedUpdatesWithCanonicalLocks(
        deviceId,
        MsaidiziDeviceStatus.KILLED,
        now,
      );
      interruptedUpdatesBeforeBoundary += settled.preBoundary;
      interruptedUpdatesAfterBoundary += settled.postBoundary;
    }
    const actions = await this.prisma.msaidiziHostAction.findMany({
      // Include actions on devices that a prior kill attempt already marked
      // KILLED/REVOKED. The status transition and action settlement cannot be
      // one database transaction because settlement spans task/step recovery;
      // retries must therefore repair the second half idempotently.
      where: {
        device: { principalId: principal.id },
        status: { in: [...ACTIVE_ACTIONS] },
      },
      include: { step: true },
    });
    for (const action of actions) {
      const unknown = action.step.mutation && action.status !== MsaidiziHostActionStatus.QUEUED;
      await this.settleInterruptedAction(
        action.id,
        unknown ? 'GLOBAL_DEVICE_KILL_WRITE_OUTCOME_UNKNOWN' : 'GLOBAL_DEVICE_KILL',
        unknown,
        action.status === MsaidiziHostActionStatus.QUEUED,
      );
    }
    await this.audit.log({
      action: 'MSAIDIZI_DEVICE_KILL_ALL',
      entityType: 'MsaidiziDevice',
      userId: user.id,
      principalType: 'MSAIDIZI',
      principalId: principal.id,
      metadata: {
        affectedDeviceCount: killed,
        interruptedActions: actions.length,
        interruptedUpdatesBeforeBoundary,
        interruptedUpdatesAfterBoundary,
      },
    });
    return { killed };
  }

  /**
   * Repairs the durable side of the deployment kill switch. Repeated calls are
   * safe because only ACTIVE leases and actions are selected.
   */
  async reconcileGlobalKill(): Promise<{
    revokedLeases: number;
    settledActions: number;
    settledUpdatesBeforeBoundary: number;
    settledUpdatesAfterBoundary: number;
  }> {
    if (!this.config.globalKillSwitchActive) {
      return {
        revokedLeases: 0,
        settledActions: 0,
        settledUpdatesBeforeBoundary: 0,
        settledUpdatesAfterBoundary: 0,
      };
    }
    const now = new Date();
    const revoked = await this.prisma.msaidiziDeviceLease.updateMany({
      where: { status: MsaidiziDeviceLeaseStatus.ACTIVE },
      data: { status: MsaidiziDeviceLeaseStatus.REVOKED, releasedAt: now },
    });
    const actions = await this.prisma.msaidiziHostAction.findMany({
      where: { status: { in: [...ACTIVE_ACTIONS] } },
      select: { id: true, status: true },
    });
    for (const action of actions) {
      const crossedDeviceBoundary = action.status !== MsaidiziHostActionStatus.QUEUED;
      await this.settleInterruptedAction(
        action.id,
        crossedDeviceBoundary
          ? 'GLOBAL_KILL_SWITCH_OUTCOME_UNKNOWN'
          : 'GLOBAL_KILL_SWITCH_CANCELLED_BEFORE_DISPATCH',
        crossedDeviceBoundary,
        !crossedDeviceBoundary,
      );
    }
    const updateDevices = await this.prisma.msaidiziUpdateDeployment.findMany({
      where: {
        resultDigest: null,
        status: {
          in: [
            MsaidiziUpdateDeploymentStatus.QUEUED,
            MsaidiziUpdateDeploymentStatus.DISPATCHED,
            MsaidiziUpdateDeploymentStatus.APPLYING,
            MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
          ],
        },
      },
      distinct: ['deviceId'],
      select: { deviceId: true },
    });
    let settledUpdatesBeforeBoundary = 0;
    let settledUpdatesAfterBoundary = 0;
    for (const { deviceId } of updateDevices) {
      const settled = await this.settleInterruptedUpdatesWithCanonicalLocks(
        deviceId,
        MsaidiziDeviceStatus.KILLED,
        now,
      );
      settledUpdatesBeforeBoundary += settled.preBoundary;
      settledUpdatesAfterBoundary += settled.postBoundary;
    }
    return {
      revokedLeases: revoked.count,
      settledActions: actions.length,
      settledUpdatesBeforeBoundary,
      settledUpdatesAfterBoundary,
    };
  }

  async completePairing(dto: CompletePairingDto, request: Request) {
    if (!this.config.pairingReady() || !this.config.pairingPepper) {
      throw new ServiceUnavailableException('Device pairing is disabled or not safely configured');
    }
    const peer = directMtlsPeer(request);
    if (dto.capabilityManifest.deviceId !== dto.deviceId) {
      throw new BadRequestException('The capability manifest is for a different device');
    }
    validateCapabilityManifest(dto.capabilityManifest);
    const pending = await this.prisma.msaidiziDevice.findUnique({ where: { id: dto.deviceId } });
    if (
      pending &&
      pending.status === MsaidiziDeviceStatus.ACTIVE &&
      peerMatchesStoredDevice(pending, peer)
    ) {
      // The server may have committed pairing while the workstation lost the
      // response. Exact TLS fingerprint + SPKI proof makes this retry safe;
      // no different certificate can consume the already-used challenge.
      return { deviceId: pending.id, status: MsaidiziDeviceStatus.ACTIVE };
    }
    if (!pending || pending.status !== MsaidiziDeviceStatus.PENDING) {
      throw new UnauthorizedException('Pairing challenge is invalid');
    }
    const expiresAt = parsePairingExpiry(pending.capabilityManifest);
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      await this.prisma.$transaction(async (tx) => {
        const won = await tx.msaidiziDevice.updateMany({
          where: { id: pending.id, status: MsaidiziDeviceStatus.PENDING },
          data: { status: MsaidiziDeviceStatus.REVOKED, revokedAt: new Date() },
        });
        const recipientUserId = pairingInitiator(pending.capabilityManifest);
        if (won.count === 1 && recipientUserId) {
          await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
            kind: 'REVOKED',
            deviceId: pending.id,
            recipientUserId,
          });
        }
      });
      throw new GoneException('Pairing challenge has expired');
    }
    const suppliedDigest = pairingCodeDigest(
      this.config.pairingPepper,
      pending.id,
      normalisePairingCode(dto.pairingCode),
    );
    const expectedMarker = pairingMarker(suppliedDigest);
    if (!fixedTimeStringEquals(pending.publicKey, expectedMarker)) {
      throw new UnauthorizedException('Pairing challenge is invalid');
    }

    try {
      const won = await this.prisma.msaidiziDevice.updateMany({
        where: {
          id: pending.id,
          status: MsaidiziDeviceStatus.PENDING,
          publicKey: expectedMarker,
        },
        data: {
          status: MsaidiziDeviceStatus.ACTIVE,
          platform: dto.platform,
          osVersion: dto.osVersion,
          architecture: dto.architecture,
          publicKey: peer.publicKeyPem,
          certificateThumbprint: peer.certificateSha256,
          capabilityManifest: dto.capabilityManifest as unknown as Prisma.InputJsonValue,
          pairedAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
      if (won.count !== 1) throw new ConflictException('Pairing challenge was already consumed');
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictException('The TLS certificate is already bound to another device');
      }
      throw error;
    }

    const initiatedByUserId = pairingInitiator(pending.capabilityManifest);
    await this.audit.log({
      action: 'MSAIDIZI_DEVICE_PAIRED',
      entityType: 'MsaidiziDevice',
      entityId: pending.id,
      userId: initiatedByUserId ?? undefined,
      channel: AuditChannel.SYSTEM,
      principalType: 'MSAIDIZI',
      principalId: pending.principalId,
      deviceId: pending.id,
      metadata: { certificateSha256: peer.certificateSha256 },
    });
    return { deviceId: pending.id, status: MsaidiziDeviceStatus.ACTIVE };
  }

  async completeSupervisorEnrollment(dto: CompleteSupervisorEnrollmentDto, request: Request) {
    const pepper = this.config.supervisorEnrollmentPepper;
    if (!this.config.supervisorEnrollmentReady() || !pepper) {
      throw new ServiceUnavailableException(
        'Role-specific supervisor enrollment is disabled or not safely configured',
      );
    }
    const peer = directMtlsPeer(request);
    const spkiSha256 = peer.publicKeySpkiSha256;
    if (!spkiSha256) {
      throw new UnauthorizedException('The supervisor TLS peer has no SPKI identity');
    }
    const suppliedDigest = supervisorEnrollmentCodeDigest(
      pepper,
      dto.enrollmentId,
      dto.deviceId,
      dto.role,
      dto.enrollmentCode,
    );
    let result:
      | { kind: 'expired' }
      | {
          kind: 'enrolled' | 'replay';
          principalId: string;
          createdByUserId: string;
        };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await lockSupervisorEnrollment(tx);
        const challenge = await tx.msaidiziSupervisorEnrollmentChallenge.findUnique({
          where: { id: dto.enrollmentId },
          include: {
            device: {
              select: {
                id: true,
                principalId: true,
                status: true,
                updateSupervisorCertificateSha256: true,
                updateSupervisorPublicKeySpkiSha256: true,
                recoverySupervisorCertificateSha256: true,
                recoverySupervisorPublicKeySpkiSha256: true,
              },
            },
          },
        });
        if (
          !challenge ||
          challenge.deviceId !== dto.deviceId ||
          challenge.role !== dto.role ||
          !fixedTimeHexEquals(challenge.challengeDigest, suppliedDigest)
        ) {
          throw new UnauthorizedException('Supervisor enrollment challenge is invalid');
        }
        const currentIdentity = supervisorIdentityForRole(challenge.device, dto.role);
        const exactIdentityReplay =
          currentIdentity.certificateSha256 != null &&
          currentIdentity.publicKeySpkiSha256 != null &&
          fixedTimeHexEquals(currentIdentity.certificateSha256, peer.certificateSha256) &&
          fixedTimeHexEquals(currentIdentity.publicKeySpkiSha256, spkiSha256);
        if (challenge.consumedAt) {
          if (!exactIdentityReplay) {
            throw new UnauthorizedException('Supervisor enrollment challenge is invalid');
          }
          return {
            kind: 'replay' as const,
            principalId: challenge.device.principalId,
            createdByUserId: challenge.createdByUserId,
          };
        }
        if (challenge.expiresAt.getTime() <= Date.now()) {
          await tx.msaidiziSupervisorEnrollmentChallenge.updateMany({
            where: { id: challenge.id, consumedAt: null },
            data: { consumedAt: new Date() },
          });
          return { kind: 'expired' as const };
        }
        if (
          challenge.device.status !== MsaidiziDeviceStatus.ACTIVE &&
          challenge.device.status !== MsaidiziDeviceStatus.OFFLINE
        ) {
          throw new UnauthorizedException('Supervisor enrollment challenge is invalid');
        }
        if (currentIdentity.certificateSha256 || currentIdentity.publicKeySpkiSha256) {
          throw new ConflictException(
            `The ${dto.role.toLowerCase()} supervisor is already enrolled`,
          );
        }
        await this.assertSupervisorIdentityDistinct(tx, peer.certificateSha256, spkiSha256);
        const identityWhere =
          dto.role === 'UPDATE'
            ? {
                updateSupervisorCertificateSha256: null,
                updateSupervisorPublicKeySpkiSha256: null,
              }
            : {
                recoverySupervisorCertificateSha256: null,
                recoverySupervisorPublicKeySpkiSha256: null,
              };
        const identityData =
          dto.role === 'UPDATE'
            ? {
                updateSupervisorCertificateSha256: peer.certificateSha256,
                updateSupervisorPublicKeySpkiSha256: spkiSha256,
              }
            : {
                recoverySupervisorCertificateSha256: peer.certificateSha256,
                recoverySupervisorPublicKeySpkiSha256: spkiSha256,
              };
        const deviceWon = await tx.msaidiziDevice.updateMany({
          where: {
            id: challenge.deviceId,
            status: { in: [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE] },
            ...identityWhere,
          },
          data: identityData,
        });
        const challengeWon = await tx.msaidiziSupervisorEnrollmentChallenge.updateMany({
          where: { id: challenge.id, challengeDigest: suppliedDigest, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (deviceWon.count !== 1 || challengeWon.count !== 1) {
          throw new ConflictException('Supervisor enrollment challenge was already consumed');
        }
        return {
          kind: 'enrolled' as const,
          principalId: challenge.device.principalId,
          createdByUserId: challenge.createdByUserId,
        };
      });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictException('The supervisor TLS identity is already bound');
      }
      throw error;
    }
    if (result.kind === 'expired') {
      throw new GoneException('Supervisor enrollment challenge has expired');
    }
    await this.audit.log({
      action: 'MSAIDIZI_SUPERVISOR_ENROLLED',
      entityType: 'MsaidiziDevice',
      entityId: dto.deviceId,
      userId: result.createdByUserId,
      channel: AuditChannel.SYSTEM,
      principalType: 'MSAIDIZI',
      principalId: result.principalId,
      deviceId: dto.deviceId,
      metadata: {
        role: dto.role,
        enrollmentId: dto.enrollmentId,
        certificateSha256: peer.certificateSha256,
        publicKeySpkiSha256: spkiSha256,
        replay: result.kind === 'replay',
      },
    });
    return {
      deviceId: dto.deviceId,
      role: dto.role,
      enrolled: true,
      replay: result.kind === 'replay',
    };
  }

  private async assertSupervisorIdentityDistinct(
    tx: Prisma.TransactionClient,
    certificateSha256: string,
    publicKeySpkiSha256: string,
  ): Promise<void> {
    const certificate = certificateSha256.toUpperCase();
    const spki = publicKeySpkiSha256.toUpperCase();
    if (fixedTimeHexEquals(certificate, spki)) {
      throw new ConflictException('Supervisor certificate and SPKI identities must be distinct');
    }
    const devices = await tx.msaidiziDevice.findMany({
      select: {
        publicKey: true,
        certificateThumbprint: true,
        egressBoundaryPublicKeySha256: true,
        updateSupervisorCertificateSha256: true,
        updateSupervisorPublicKeySpkiSha256: true,
        recoverySupervisorCertificateSha256: true,
        recoverySupervisorPublicKeySpkiSha256: true,
      },
    });
    const reserved = new Set(this.config.reservedSupervisorIdentityDigests);
    for (const device of devices) {
      for (const digest of [
        device.certificateThumbprint,
        device.egressBoundaryPublicKeySha256,
        device.updateSupervisorCertificateSha256,
        device.updateSupervisorPublicKeySpkiSha256,
        device.recoverySupervisorCertificateSha256,
        device.recoverySupervisorPublicKeySpkiSha256,
      ]) {
        if (digest) reserved.add(digest.toUpperCase());
      }
      const deviceSpki = publicKeySpkiDigest(device.publicKey);
      if (deviceSpki) reserved.add(deviceSpki);
    }
    if (reserved.has(certificate) || reserved.has(spki)) {
      throw new ConflictException(
        'Supervisor certificate and SPKI identities must be unique across trusted roles',
      );
    }
  }

  async updateManifest(dto: CapabilityManifestSnapshotDto, request: Request) {
    const device = await this.authenticateDevice(request, dto.deviceId);
    validateCapabilityManifest(dto);
    const previousRuntime = manifestRuntime(device.capabilityManifest);
    const capabilityManifest = {
      ...dto,
      ...(previousRuntime ? { runtime: previousRuntime } : {}),
    };
    await this.prisma.msaidiziDevice.update({
      where: { id: device.id },
      data: {
        capabilityManifest: capabilityManifest as unknown as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
      },
    });
    return { accepted: true, manifestSha256: dto.manifestSha256.toUpperCase() };
  }

  async heartbeat(dto: CompanionHeartbeatDto, request: Request) {
    const device = await this.authenticateDevice(request, dto.deviceId);
    const incomingSentAt = Date.parse(dto.sentAt);
    if (!Number.isFinite(incomingSentAt)) {
      throw new BadRequestException('Device heartbeat sentAt is invalid');
    }
    const disposition = await this.prisma.$transaction(async (tx) => {
      // The device row serializes heartbeat generations with action dispatch.
      // Retried or out-of-order snapshots are acknowledged without refreshing
      // receivedAt, liveness, journal head, or the device lease.
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_devices" WHERE "id" = ${device.id} FOR UPDATE`;
      const liveDevice = await tx.msaidiziDevice.findUnique({ where: { id: device.id } });
      if (
        !liveDevice ||
        !new Set<MsaidiziDeviceStatus>([
          MsaidiziDeviceStatus.ACTIVE,
          MsaidiziDeviceStatus.OFFLINE,
        ]).has(liveDevice.status)
      ) {
        throw new UnauthorizedException('The direct TLS peer is not an active enrolled device');
      }

      const currentManifest = asJsonObject(liveDevice.capabilityManifest);
      const previousRuntime = manifestRuntime(liveDevice.capabilityManifest);
      const previousSentAt = previousRuntime ? jsonString(previousRuntime, 'sentAt') : null;
      const previousSentAtMs = previousSentAt ? Date.parse(previousSentAt) : Number.NaN;
      if (Number.isFinite(previousSentAtMs) && incomingSentAt <= previousSentAtMs) {
        return { ignored: true };
      }

      const now = new Date();
      const declaredHash = jsonString(currentManifest, 'manifestSha256');
      const centralJournalHeads = await tx.$queryRaw<
        {
          sequence: number;
          hashVersion: number;
          entryHash: string;
          exactAcknowledgedAt: Date | null;
        }[]
      >`
        SELECT "sequence", "hashVersion", "entryHash", "exactAcknowledgedAt"
        FROM "msaidizi_device_journal_heads"
        WHERE "deviceId" = ${device.id}
      `;
      const centralJournalHead = centralJournalHeads[0];
      const runtime = {
        component: dto.component,
        componentVersion: dto.componentVersion,
        executionEnabled: dto.executionEnabled,
        killSwitchEngaged: dto.killSwitchEngaged,
        centralLedgerConnected: Boolean(
          dto.centralLedgerConnected &&
          centralJournalHead &&
          centralJournalHead.exactAcknowledgedAt != null &&
          centralJournalHead.hashVersion === 2 &&
          centralJournalHead.sequence === dto.journalSequence &&
          fixedTimeHexEquals(centralJournalHead.entryHash, dto.journalHeadHash),
        ),
        runningActionCount: dto.runningActionCount,
        journalSequence: dto.journalSequence,
        journalHeadHash: dto.journalHeadHash.toUpperCase(),
        capabilityManifestSha256: dto.capabilityManifestSha256.toUpperCase(),
        manifestMatches: Boolean(
          declaredHash && fixedTimeHexEquals(declaredHash, dto.capabilityManifestSha256),
        ),
        sentAt: new Date(incomingSentAt).toISOString(),
        receivedAt: now.toISOString(),
      };
      const updated = await tx.msaidiziDevice.updateMany({
        where: {
          id: device.id,
          status: { in: [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE] },
        },
        data: {
          status: MsaidiziDeviceStatus.ACTIVE,
          lastSeenAt: now,
          capabilityManifest: { ...currentManifest, runtime } as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) {
        throw new UnauthorizedException('The direct TLS peer is not an active enrolled device');
      }
      // A generic device heartbeat proves workstation liveness, not possession
      // of any particular action lease. Only a receipt carrying the exact
      // signed lease id/fence may renew that lease.
      return { ignored: false };
    });
    return { accepted: true, ignored: disposition.ignored, serverTime: new Date() };
  }

  async poll(dto: PollDeviceCommandsDto, request: Request): Promise<{ commands: DeviceCommand[] }> {
    const device = await this.authenticateDevice(request, dto.deviceId);
    const authenticatedIdentity = authenticatedDeviceIdentity(device);
    await this.expireDeviceLeases(device.id);
    await this.cancelUndispatchedActions(device.id);
    const cancellations = await this.cancelCommands(device.id, dto.maxCommands);
    if (cancellations.length > 0) return { commands: cancellations };
    if (!this.config.channelReady()) return { commands: [pingCommand()] };

    const runtime = manifestRuntime(device.capabilityManifest);
    if (
      !runtime ||
      runtime.executionEnabled !== true ||
      runtime.killSwitchEngaged === true ||
      runtime.centralLedgerConnected !== true ||
      runtime.manifestMatches !== true ||
      !freshRuntime(runtime, this.config.leaseTtlSeconds * 2)
    ) {
      return { commands: [pingCommand()] };
    }
    const runtimeJournalSequence = runtime.journalSequence;
    const runtimeJournalHead = jsonString(runtime, 'journalHeadHash');
    let journalHeadIsExact = false;
    if (
      this.journalLedger &&
      typeof runtimeJournalSequence === 'number' &&
      Number.isSafeInteger(runtimeJournalSequence) &&
      runtimeJournalSequence >= 0 &&
      isSha256Hex(runtimeJournalHead)
    ) {
      journalHeadIsExact = await this.journalLedger.isExactHead(
        device.id,
        runtimeJournalSequence,
        runtimeJournalHead,
      );
    }

    // Dispatch one action per heartbeat/poll. The next action must bind to the
    // journal head produced by this one; batching multiple actions against the
    // same predecessor would make their chains ambiguous.
    if (journalHeadIsExact) {
      const replay = await this.claimReplayResultCommand(
        device.id,
        runtime,
        device.capabilityManifest,
      );
      if (replay) return { commands: [replay] };
      const fence = await this.claimFenceActionCommand(
        device.id,
        runtime,
        device.capabilityManifest,
      );
      if (fence) return { commands: [fence] };
    }
    if (await this.hasPendingLateEvidence(device.id)) {
      return { commands: [pingCommand()] };
    }
    if (!journalHeadIsExact) return { commands: [pingCommand()] };
    if (!authenticatedIdentity) return { commands: [pingCommand()] };
    const command = await this.claimExecuteCommand(device.id, runtime, authenticatedIdentity);
    return { commands: command ? [command] : [pingCommand()] };
  }

  async progress(dto: ActionProgressDto, request: Request) {
    const action = await this.requireActionForPeer(dto.actionId, request);
    if (action.taskId !== dto.taskId || action.stepId !== dto.stepId) {
      throw new ForbiddenException('Action progress does not match the dispatched action');
    }
    this.assertActionLeaseReceipt(action, dto);
    if (action.status === MsaidiziHostActionStatus.QUEUED) {
      throw new ForbiddenException('Action progress was received before broker dispatch');
    }
    if (!ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number])) {
      // Lease-expiry recovery may still accept a terminal journal receipt from
      // the exact historical fence, but it must never positively acknowledge
      // progress from that old execute authorization. The companion treats a
      // successful Started round trip as its final mutation-boundary liveness
      // proof; acknowledging an UNKNOWN action here would therefore let a
      // delayed, still-cryptographically-valid token enter the adapter after
      // its database lease was fenced out.
      if (interruptedActionAcceptsLateEvidence(action)) {
        throw new ConflictException('Action lease is no longer active for execution');
      }
      return { accepted: true, terminal: true };
    }
    if (action.dispatchCount !== dto.dispatchCount) {
      throw new ConflictException('Action progress belongs to a stale dispatch generation');
    }
    const state = progressState(dto.state);
    const hasAnyPreparedBinding =
      dto.journalPrepareSequence != null ||
      dto.journalPreparePreviousHash != null ||
      dto.journalPrepareEntryHash != null;
    const hasCompletePreparedBinding =
      dto.journalPrepareSequence != null &&
      dto.journalPreparePreviousHash != null &&
      dto.journalPrepareEntryHash != null;
    if (state !== 'Started' && hasAnyPreparedBinding) {
      throw new ConflictException('Prepared journal binding is valid only for Started progress');
    }
    if (state === 'Started') {
      if (
        !hasCompletePreparedBinding ||
        action.journalExpectedPreviousSequence == null ||
        action.journalPreviousHash == null ||
        dto.journalPrepareSequence !== action.journalExpectedPreviousSequence + 1 ||
        !fixedTimeHexEquals(dto.journalPreparePreviousHash!, action.journalPreviousHash) ||
        fixedTimeHexEquals(dto.journalPrepareEntryHash!, action.journalPreviousHash)
      ) {
        throw new ConflictException('Started progress does not bind the expected Prepared record');
      }
      const hasStoredPreparedBinding =
        action.journalPrepareSequence != null ||
        action.journalPreparePreviousHash != null ||
        action.journalPrepareHash != null;
      if (
        hasStoredPreparedBinding &&
        (action.journalPrepareSequence !== dto.journalPrepareSequence ||
          action.journalPreparePreviousHash == null ||
          action.journalPrepareHash == null ||
          !fixedTimeHexEquals(action.journalPreparePreviousHash, dto.journalPreparePreviousHash!) ||
          !fixedTimeHexEquals(action.journalPrepareHash, dto.journalPrepareEntryHash!))
      ) {
        throw new ConflictException('Started progress conflicts with the accepted Prepared record');
      }
    }
    const now = new Date();
    const provesDurableExecution = new Set(['Accepted', 'Started', 'Cancelling']).has(state);
    const preparedPreviousHash = dto.journalPreparePreviousHash?.toUpperCase();
    const preparedEntryHash = dto.journalPrepareEntryHash?.toUpperCase();
    await this.prisma.$transaction(async (tx) => {
      const acknowledged = await tx.msaidiziHostAction.updateMany({
        where: {
          id: action.id,
          status: { in: [...ACTIVE_ACTIONS] },
          dispatchCount: dto.dispatchCount,
          ...(state === 'Started'
            ? {
                journalExpectedPreviousSequence: action.journalExpectedPreviousSequence,
                journalPreviousHash: action.journalPreviousHash,
                OR: [
                  {
                    journalPrepareSequence: null,
                    journalPreparePreviousHash: null,
                    journalPrepareHash: null,
                  },
                  {
                    journalPrepareSequence: dto.journalPrepareSequence,
                    journalPreparePreviousHash: preparedPreviousHash,
                    journalPrepareHash: preparedEntryHash,
                  },
                ],
              }
            : {}),
        },
        data: {
          // Accepted is emitted only after durable Prepared state. Move forward
          // to RUNNING, but never write a stale snapshot status that could
          // downgrade a concurrent Started transition.
          ...(provesDurableExecution ? { status: MsaidiziHostActionStatus.RUNNING } : {}),
          acknowledgedDispatchCount: dto.dispatchCount,
          acknowledgedAt: now,
          ...(state === 'Started' && !action.startedAt ? { startedAt: now } : {}),
          ...(state === 'Started'
            ? {
                journalPrepareSequence: dto.journalPrepareSequence,
                journalPreparePreviousHash: preparedPreviousHash,
                journalPrepareHash: preparedEntryHash,
              }
            : {}),
        },
      });
      if (acknowledged.count !== 1) {
        throw new ConflictException('Action dispatch generation changed before progress receipt');
      }
      const renewedUntil = new Date(
        Math.min(
          action.leaseAuthorizationExpiresAt!.getTime(),
          now.getTime() + this.config.leaseTtlSeconds * 1_000,
        ),
      );
      if (renewedUntil.getTime() <= now.getTime()) {
        throw new ConflictException('The signed action lease authorization has expired');
      }
      const renewed = await tx.msaidiziDeviceLease.updateMany({
        where: {
          id: action.leaseId!,
          fencingToken: action.leaseFencingToken!,
          status: MsaidiziDeviceLeaseStatus.ACTIVE,
          expiresAt: { gt: now },
        },
        data: {
          heartbeatAt: now,
          expiresAt: renewedUntil,
        },
      });
      if (renewed.count !== 1) {
        throw new ConflictException('The action lease expired or its fencing generation changed');
      }
      await this.event(tx, action.taskId, 'host_action.progress', {
        actionId: action.actionId,
        stepId: action.stepId,
        dispatchCount: dto.dispatchCount,
        state,
        percent: dto.percent,
        messageCode: dto.messageCode,
        deviceId: action.deviceId,
        leaseId: action.leaseId,
        fencingToken: action.leaseFencingToken!.toString(),
        ...(state === 'Started'
          ? {
              journalPrepareSequence: dto.journalPrepareSequence,
              journalPreparePreviousHash: preparedPreviousHash,
              journalPrepareEntryHash: preparedEntryHash,
            }
          : {}),
      });
    });
    return state === 'Started'
      ? {
          accepted: true,
          actionId: action.actionId,
          dispatchCount: dto.dispatchCount,
          journalPrepareSequence: dto.journalPrepareSequence,
          journalPreparePreviousHash: preparedPreviousHash,
          journalPrepareEntryHash: preparedEntryHash,
        }
      : { accepted: true };
  }

  async result(dto: ActionResultDto, request: Request) {
    const action = await this.requireActionForPeer(dto.actionId, request);
    if (action.taskId !== dto.taskId || action.stepId !== dto.stepId) {
      throw new ForbiddenException('Action result does not match the dispatched action');
    }
    this.assertActionLeaseReceipt(action, dto, interruptedActionAcceptsLateEvidence(action));
    if (action.status === MsaidiziHostActionStatus.QUEUED) {
      throw new ForbiddenException('Action result was received before broker dispatch');
    }
    if (isUnavailableHostFileContentCapability(action.capability)) {
      const replay = !ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number]);
      await this.settleInterruptedAction(
        action.id,
        REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
        false,
        false,
        { bytesRead: 0n, bytesWritten: 0n },
        true,
        true,
      );
      return {
        accepted: true,
        replay,
        status: MsaidiziHostActionStatus.FAILED,
        taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
      };
    }
    return this.settleResult(action.id, dto);
  }

  async actionFenced(dto: ActionFencedReceiptDto, request: Request) {
    const device = await this.authenticateDevice(request, dto.deviceId);
    if (device.id !== dto.deviceId) {
      throw new ForbiddenException('Fence receipt does not match the authenticated device');
    }
    return this.settleActionFenceReceipt(dto, device.id);
  }

  /** Called by the durable step worker after it has reserved exactly one attempt. */
  async queueHostAction(
    taskId: string,
    stepId: string,
    attemptId: string,
    preparedInputs?: ResolvedStepInputs,
  ) {
    if (!this.config.channelReady()) throw new HostActionPolicyError('HOST_CHANNEL_NOT_READY');
    try {
      this.signer.assertReady();
    } catch {
      throw new HostActionPolicyError('HOST_ACTION_SIGNER_UNAVAILABLE');
    }
    const step = await this.prisma.msaidiziTaskStep.findFirst({
      where: { id: stepId, taskId },
      include: {
        task: { include: { mandate: true, principal: { select: { status: true } } } },
        planVersion: true,
      },
    });
    if (
      !step ||
      step.status !== MsaidiziTaskStepStatus.RUNNING ||
      step.task.status !== MsaidiziTaskStatus.RUNNING
    ) {
      throw new HostActionPolicyError('HOST_STEP_NOT_RUNNING');
    }
    if (step.capability === RAW_MICROPHONE_CAPABILITY) {
      throw new HostActionPolicyError('HOST_RAW_AUDIO_EGRESS_FORBIDDEN');
    }
    if (isUnavailableHostFileContentCapability(step.capability)) {
      throw new HostActionPolicyError(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
    }
    if (step.capability === LOCAL_STT_CAPABILITY && !localSpeechArgumentsValid(step.arguments)) {
      throw new HostActionPolicyError('HOST_LOCAL_STT_ARGUMENTS_INVALID');
    }
    if (step.task.principal.status !== MsaidiziPrincipalStatus.ACTIVE) {
      throw new HostActionPolicyError('GLOBAL_AUTOPILOT_DISABLED');
    }
    if (
      step.task.mode !== MsaidiziTaskMode.AUTOPILOT ||
      !step.task.mandateId ||
      !step.task.mandate
    ) {
      throw new HostActionPolicyError('HOST_MANDATE_REQUIRED');
    }
    let resolvedInputs: ResolvedStepInputs;
    try {
      resolvedInputs =
        preparedInputs ??
        (await this.resolveHostActionInputs(
          step.taskId,
          step.planVersionId,
          step.id,
          attemptId,
          step.arguments,
          step.inputBindings,
        ));
      if (
        resolvedInputs.taskId !== taskId ||
        resolvedInputs.planVersionId !== step.planVersionId ||
        resolvedInputs.stepId !== stepId ||
        resolvedInputs.attemptId !== attemptId
      ) {
        throw new MsaidiziInputBindingError(
          'HOST_INPUT_BINDING_SCOPE_MISMATCH',
          'Prepared host inputs do not belong to the reserved task attempt',
        );
      }
    } catch (error) {
      throw new HostActionPolicyError(
        error instanceof MsaidiziInputBindingError
          ? error.code
          : 'HOST_INPUT_BINDING_RESOLUTION_FAILED',
      );
    }
    const boundAttempt = await this.prisma.msaidiziToolAttempt.findFirst({
      where: { id: attemptId, taskId, stepId, status: MsaidiziToolAttemptStatus.REQUESTED },
      select: {
        argsDigest: true,
        resolvedInputProvenance: true,
        inputProvenanceSha256: true,
      },
    });
    if (
      !boundAttempt ||
      !fixedTimeHexEquals(boundAttempt.argsDigest, resolvedInputs.argumentsSha256) ||
      !fixedTimeHexEquals(
        boundAttempt.inputProvenanceSha256 ?? '',
        resolvedInputs.provenanceSha256,
      ) ||
      boundAttempt.resolvedInputProvenance == null ||
      !fixedTimeHexEquals(
        jsonSha256(boundAttempt.resolvedInputProvenance),
        resolvedInputs.provenanceSha256,
      )
    ) {
      throw new HostActionPolicyError('HOST_INPUT_PROVENANCE_MISMATCH');
    }
    this.assertActiveMandate(
      step.task.mandate,
      step.capability,
      step.capabilityVersion,
      step.expectedEffect,
      step.dataClass,
      resolvedInputs.arguments as Prisma.JsonValue,
    );

    const allowedDeviceIds = stringArray(step.task.mandate.deviceIds);
    const explicitDeviceId = jsonString(asJsonObject(step.preconditions), 'deviceId');
    const eligibleIds = explicitDeviceId ? [explicitDeviceId] : allowedDeviceIds;
    if (eligibleIds.length !== 1 || !allowedDeviceIds.includes(eligibleIds[0])) {
      throw new HostActionPolicyError('HOST_DEVICE_SELECTION_AMBIGUOUS');
    }
    const device = await this.prisma.msaidiziDevice.findFirst({
      where: {
        id: eligibleIds[0],
        principalId: step.task.principalId,
        status: MsaidiziDeviceStatus.ACTIVE,
      },
    });
    if (!device) throw new HostActionPolicyError('HOST_DEVICE_UNAVAILABLE');
    const descriptor = findCapability(
      device.capabilityManifest,
      step.capability,
      step.capabilityVersion,
    );
    if (!descriptor) throw new HostActionPolicyError('HOST_CAPABILITY_UNAVAILABLE');
    if (capabilityEffect(descriptor.effect) !== step.expectedEffect) {
      throw new HostActionPolicyError('HOST_EFFECT_MISMATCH');
    }
    if (capabilityDataClass(descriptor.dataClass) !== step.dataClass) {
      throw new HostActionPolicyError('HOST_DATA_CLASS_MISMATCH');
    }
    if (step.mutation !== (step.expectedEffect !== MsaidiziEffect.READ)) {
      throw new HostActionPolicyError('HOST_MUTATION_CLASSIFICATION_MISMATCH');
    }
    const expectedPreStateSha256 = jsonString(
      asJsonObject(step.preconditions),
      'expectedPreStateSha256',
    );
    if (step.mutation && !isSha256Hex(expectedPreStateSha256)) {
      throw new HostActionPolicyError('HOST_EXPECTED_PRE_STATE_REQUIRED');
    }

    const argumentsJson = stableJson(resolvedInputs.arguments);
    const argsDigest = sha256Hex(argumentsJson);
    if (!fixedTimeHexEquals(argsDigest, resolvedInputs.argumentsJsonSha256)) {
      throw new HostActionPolicyError('HOST_ARGUMENT_DIGEST_DRIFT');
    }
    const idempotencyKey = `msaidizi-host:${step.id}`;
    const leaseId = `lease-${sha256Hex(`${step.id}\0${device.id}`).slice(0, 40).toLowerCase()}`;
    const leasePepper = this.config.leasePepper;
    if (!leasePepper) throw new HostActionPolicyError('HOST_LEASE_KEY_UNAVAILABLE');
    const now = new Date();
    const taskBudgetCeiling = actionBudgets(step.task);
    assertMandateBudgets(step.task.mandate.budgets, taskBudgetCeiling);

    return this.prisma.$transaction(async (tx) => {
      const authoritativeWallTime = await checkpointTaskWallTimeForAuthorization(tx, taskId);
      if (!authoritativeWallTime?.wallTimeCheckpointAt) {
        throw new HostActionPolicyError('HOST_TASK_BUDGET_EXHAUSTED');
      }
      const taskBudgetSnapshot = remainingActionBudgets(
        { ...step.task, ...authoritativeWallTime },
        authoritativeWallTime.wallTimeCheckpointAt,
      );
      const budgetSnapshot = taskBudgetSnapshot
        ? constrainActionBudgetsToStep(taskBudgetSnapshot, step)
        : null;
      if (!budgetSnapshot) throw new HostActionPolicyError('HOST_TASK_BUDGET_EXHAUSTED');

      const taskWon = await tx.msaidiziTask.updateMany({
        where: {
          id: taskId,
          status: MsaidiziTaskStatus.RUNNING,
          principal: { status: MsaidiziPrincipalStatus.ACTIVE },
        },
        data: { lastCheckpointAt: now },
      });
      const stepWon = await tx.msaidiziTaskStep.updateMany({
        where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
        data: { status: MsaidiziTaskStepStatus.RUNNING },
      });
      const deviceWon = await tx.msaidiziDevice.updateMany({
        where: { id: device.id, status: MsaidiziDeviceStatus.ACTIVE },
        data: { status: MsaidiziDeviceStatus.ACTIVE },
      });
      if (taskWon.count !== 1 || stepWon.count !== 1 || deviceWon.count !== 1) {
        throw new HostActionPolicyError('HOST_QUEUE_STATE_CHANGED');
      }
      const existing = await tx.msaidiziHostAction.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (
          existing.attemptId !== attemptId ||
          existing.argsDigest !== argsDigest ||
          !fixedTimeHexEquals(existing.inputProvenanceSha256 ?? '', resolvedInputs.provenanceSha256)
        ) {
          throw new HostActionPolicyError('HOST_IDEMPOTENCY_INPUT_MISMATCH');
        }
        await tx.msaidiziToolAttempt.updateMany({
          where: { id: attemptId, taskId, stepId, status: MsaidiziToolAttemptStatus.REQUESTED },
          data: { status: MsaidiziToolAttemptStatus.RUNNING, startedAt: now },
        });
        return {
          queued: true,
          replay: true,
          actionId: existing.actionId,
          deviceId: existing.deviceId,
        };
      }

      // A protocol-v2 terminal replay or protocol-v3 durable tombstone must
      // reconcile the prior lease generation before any new lease is created
      // for this device. Poll-side blocking alone is insufficient because the
      // durable worker may queue another task while the workstation is offline.
      const unresolvedLateEvidence = await tx.msaidiziHostAction.count({
        where: {
          deviceId: device.id,
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: { in: [...LATE_RECOVERY_EVIDENCE_ERROR_CODES] },
          journalAccepted: false,
          lateEvidenceAcceptedAt: null,
          step: { mutation: true },
        },
      });
      if (unresolvedLateEvidence > 0) {
        throw new HostActionPolicyError('HOST_DEVICE_LATE_EVIDENCE_PENDING');
      }

      // A released/expired lease generation is never reactivated: create a
      // fresh database-generated fencing token for every new step/device
      // binding. The surrounding transaction makes retry-after-commit use the
      // existing host action above instead of creating another lease.
      const lease = await tx.msaidiziDeviceLease.create({
        data: {
          id: leaseId,
          taskId,
          stepId,
          deviceId: device.id,
          leaseTokenDigest: leaseTokenDigest(leasePepper, leaseId),
          expiresAt: new Date(now.getTime() + this.config.leaseTtlSeconds * 1_000),
        },
      });
      const actionId = randomUUID();
      await tx.msaidiziHostAction.create({
        data: {
          taskId,
          stepId,
          attemptId,
          deviceId: device.id,
          leaseId: lease.id,
          leaseFencingToken: lease.fencingToken,
          leaseAuthorizationExpiresAt: lease.expiresAt,
          actionId,
          capability: step.capability,
          capabilityVersion: step.capabilityVersion,
          argumentsRedacted: redactSensitiveFields(
            resolvedInputs.arguments,
          ) as Prisma.InputJsonValue,
          argsDigest,
          resolvedInputProvenance: resolvedInputs.provenance,
          inputProvenanceSha256: resolvedInputs.provenanceSha256,
          actionTokenDigest: sha256Hex('ACTION_TOKEN_NOT_YET_ISSUED'),
          idempotencyKey,
          expectedPreState: expectedPreStateSha256
            ? ({ sha256: expectedPreStateSha256.toUpperCase() } as Prisma.InputJsonObject)
            : ({} as Prisma.InputJsonObject),
          budgetSnapshot: budgetSnapshot as unknown as Prisma.InputJsonValue,
          dataClass: capabilityDataClass(descriptor.dataClass),
          effect: step.expectedEffect,
          consent: capabilityConsent(descriptor.consent),
          recovery: capabilityRecovery(descriptor.recovery),
        },
      });
      const attemptWon = await tx.msaidiziToolAttempt.updateMany({
        where: { id: attemptId, taskId, stepId, status: MsaidiziToolAttemptStatus.REQUESTED },
        data: { status: MsaidiziToolAttemptStatus.RUNNING, startedAt: now },
      });
      if (attemptWon.count !== 1) throw new HostActionPolicyError('HOST_ATTEMPT_STATE_CHANGED');
      await tx.msaidiziTask.update({
        where: { id: taskId },
        data: { executedToolCalls: { increment: 1 }, lastCheckpointAt: now },
      });
      await this.event(tx, taskId, 'host_action.queued', {
        actionId,
        stepId,
        attemptId,
        deviceId: device.id,
        capability: step.capability,
        inputProvenanceSha256: resolvedInputs.provenanceSha256,
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MSAIDIZI_HOST_ACTION_QUEUED',
        entityType: 'MsaidiziHostAction',
        entityId: actionId,
        userId: step.task.initiatedByUserId ?? undefined,
        companyId: step.task.companyId,
        newValue: {
          capability: step.capability,
          capabilityVersion: step.capabilityVersion,
          argsDigest,
          inputProvenanceSha256: resolvedInputs.provenanceSha256,
          deviceId: device.id,
          mutation: step.mutation,
        },
        severity: step.mutation ? AuditSeverity.HIGH : AuditSeverity.LOW,
        channel: AuditChannel.AGENT,
        agentSessionId: taskSessionId(taskId),
        principalType: 'MSAIDIZI',
        principalId: step.task.principalId,
        mandateId: step.task.mandateId ?? undefined,
        initiatedByUserId: step.task.initiatedByUserId ?? undefined,
        taskId,
        stepId,
        deviceId: device.id,
      });
      return { queued: true, replay: false, actionId, deviceId: device.id };
    });
  }

  private async resolveHostActionInputs(
    taskId: string,
    planVersionId: string,
    stepId: string,
    attemptId: string,
    argumentsValue: Prisma.JsonValue,
    inputBindings: Prisma.JsonValue | undefined,
  ): Promise<ResolvedStepInputs> {
    return Array.isArray(inputBindings) && inputBindings.length > 0
      ? resolveStepInputs(
          this.prisma,
          taskId,
          stepId,
          attemptId,
          this.artifacts
            ? (binding) => this.artifacts!.materializeForHostAction(binding)
            : undefined,
        )
      : staticStepInputs(taskId, planVersionId, stepId, attemptId, argumentsValue);
  }

  private async findGlobalPrincipal() {
    return this.prisma.msaidiziPrincipal.findUnique({ where: { key: this.config.principalKey } });
  }

  private async requireGlobalPrincipal() {
    const principal = await this.findGlobalPrincipal();
    if (!principal || principal.status !== 'ACTIVE') {
      throw new ConflictException('The global Msaidizi principal is not active');
    }
    return principal;
  }

  private async authenticateDevice(request: Request, claimedDeviceId?: string) {
    if (!this.config.channelEnabled) {
      throw new ServiceUnavailableException('The device command channel is disabled');
    }
    const peer = directMtlsPeer(request);
    const device = await this.prisma.msaidiziDevice.findUnique({
      where: { certificateThumbprint: peer.certificateSha256 },
    });
    if (
      !device ||
      !new Set<MsaidiziDeviceStatus>([
        MsaidiziDeviceStatus.ACTIVE,
        MsaidiziDeviceStatus.OFFLINE,
      ]).has(device.status) ||
      !peerMatchesStoredDevice(device, peer) ||
      (claimedDeviceId && device.id !== claimedDeviceId)
    ) {
      throw new UnauthorizedException('The direct TLS peer is not an active enrolled device');
    }
    return device;
  }

  private async requireActionForPeer(actionId: string, request: Request) {
    const device = await this.authenticateDevice(request);
    const action = await this.prisma.msaidiziHostAction.findUnique({
      where: { actionId },
      include: { lease: true },
    });
    if (!action || action.deviceId !== device.id) {
      throw new NotFoundException('Host action not found');
    }
    return action;
  }

  private assertActionLeaseReceipt(
    action: {
      leaseId: string | null;
      leaseFencingToken: bigint | null;
      leaseAuthorizationExpiresAt: Date | null;
      lease: { id: string; fencingToken: bigint } | null;
    },
    receipt: { leaseId?: string; fencingToken?: string; leaseExpiresAt?: string },
    allowExpiredEvidence = false,
  ): void {
    const receiptExpiry = receipt.leaseExpiresAt ? Date.parse(receipt.leaseExpiresAt) : Number.NaN;
    if (
      !action.lease ||
      !hostActionLeaseGenerationMatchesReceipt(action, receipt) ||
      action.lease.id !== action.leaseId ||
      action.lease.fencingToken !== action.leaseFencingToken ||
      (!allowExpiredEvidence && receiptExpiry <= Date.now())
    ) {
      throw new ConflictException('Action receipt does not match the signed lease generation');
    }
  }

  private async disableDevice(deviceId: string, target: 'REVOKED' | 'KILLED', user: AuthUser) {
    const principal = await this.findGlobalPrincipal();
    if (!principal) throw new NotFoundException('Msaidizi device not found');
    const existing = await this.prisma.msaidiziDevice.findFirst({
      where: { id: deviceId, principalId: principal.id },
    });
    if (!existing) throw new NotFoundException('Msaidizi device not found');
    const alreadyDisabled = new Set<MsaidiziDeviceStatus>([
      MsaidiziDeviceStatus.REVOKED,
      MsaidiziDeviceStatus.KILLED,
    ]).has(existing.status);

    const now = new Date();
    let transitionWon = false;
    let updateSettlement = { preBoundary: 0, postBoundary: 0 };
    if (alreadyDisabled) {
      // A crash may have committed the device status but not action recovery.
      // Revoke any surviving lease again, then continue into reconciliation.
      await this.prisma.msaidiziDeviceLease.updateMany({
        where: { deviceId, status: MsaidiziDeviceLeaseStatus.ACTIVE },
        data: { status: MsaidiziDeviceLeaseStatus.REVOKED, releasedAt: now },
      });
    } else {
      const transition = await this.withCandidateFirstDeviceTransaction(
        deviceId,
        async (tx, lockedCandidateIds) => {
          const won = await tx.msaidiziDevice.updateMany({
            where: {
              id: deviceId,
              principalId: principal.id,
              status: {
                in: [
                  MsaidiziDeviceStatus.PENDING,
                  MsaidiziDeviceStatus.ACTIVE,
                  MsaidiziDeviceStatus.OFFLINE,
                ],
              },
            },
            data: {
              status: target,
              ...(target === MsaidiziDeviceStatus.KILLED ? { killedAt: now } : { revokedAt: now }),
            },
          });
          if (won.count !== 1) {
            return {
              transitionWon: false,
              updateSettlement: { preBoundary: 0, postBoundary: 0 },
            };
          }
          await tx.msaidiziDeviceLease.updateMany({
            where: { deviceId, status: MsaidiziDeviceLeaseStatus.ACTIVE },
            data: { status: MsaidiziDeviceLeaseStatus.REVOKED, releasedAt: now },
          });
          const active = await this.loadInterruptedUpdateDeployments(tx, deviceId);
          this.assertInterruptedUpdateCandidatesWereLocked(active, lockedCandidateIds);
          const settled = await this.settleInterruptedUpdateDeployments(
            tx,
            deviceId,
            target,
            now,
            active,
          );
          await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
            kind: target,
            deviceId,
            recipientUserId: user.id,
          });
          return { transitionWon: true, updateSettlement: settled };
        },
      );
      transitionWon = transition.transitionWon;
      updateSettlement = transition.updateSettlement;
      if (!transitionWon) {
        // A concurrent disable won after the initial read. Lease repair remains
        // idempotent, while the losing request must not emit another incident.
        await this.prisma.msaidiziDeviceLease.updateMany({
          where: { deviceId, status: MsaidiziDeviceLeaseStatus.ACTIVE },
          data: { status: MsaidiziDeviceLeaseStatus.REVOKED, releasedAt: now },
        });
      }
    }
    if (!transitionWon) {
      updateSettlement = await this.settleInterruptedUpdatesWithCanonicalLocks(
        deviceId,
        target,
        now,
      );
    }
    const actions = await this.prisma.msaidiziHostAction.findMany({
      where: { deviceId, status: { in: [...ACTIVE_ACTIONS] } },
      include: { step: true },
    });
    for (const action of actions) {
      const unknown = action.step.mutation && action.status !== MsaidiziHostActionStatus.QUEUED;
      await this.settleInterruptedAction(
        action.id,
        unknown ? 'DEVICE_DISABLED_WRITE_OUTCOME_UNKNOWN' : 'DEVICE_DISABLED',
        unknown,
        action.status === MsaidiziHostActionStatus.QUEUED,
      );
    }
    const finalDevice = transitionWon
      ? {
          ...existing,
          status: target,
          ...(target === MsaidiziDeviceStatus.KILLED ? { killedAt: now } : { revokedAt: now }),
        }
      : ((await this.prisma.msaidiziDevice.findFirst({
          where: { id: deviceId, principalId: principal.id },
        })) ?? existing);
    await this.audit.log({
      action:
        target === MsaidiziDeviceStatus.KILLED
          ? 'MSAIDIZI_DEVICE_KILLED'
          : 'MSAIDIZI_DEVICE_REVOKED',
      entityType: 'MsaidiziDevice',
      entityId: deviceId,
      userId: user.id,
      principalType: 'MSAIDIZI',
      principalId: principal.id,
      deviceId,
      oldValue: { status: existing.status },
      newValue: { status: finalDevice.status },
      metadata: {
        interruptedActions: actions.length,
        interruptedUpdatesBeforeBoundary: updateSettlement.preBoundary,
        interruptedUpdatesAfterBoundary: updateSettlement.postBoundary,
        reconciliationRetry: !transitionWon,
        requestedStatus: target,
      },
    });
    return safeDevice(finalDevice);
  }

  /**
   * All update paths take the candidate lock before the device lock. Device
   * disable must use the same order or an update ACK/result can deadlock with
   * kill/revoke. The pre-lock query is deliberately rechecked after the device
   * lock: a deployment queued in between is a new candidate lock dependency,
   * so the transaction is rolled back and retried from the canonical order.
   */
  private async withCandidateFirstDeviceTransaction<T>(
    deviceId: string,
    work: (tx: Prisma.TransactionClient, lockedCandidateIds: ReadonlySet<string>) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= CANDIDATE_DEVICE_LOCK_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const observed = await this.loadInterruptedUpdateDeployments(tx, deviceId);
          const candidateIds = [...new Set(observed.map(({ candidateId }) => candidateId))].sort();
          if (candidateIds.length > 0) {
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" IN (${Prisma.join(
                candidateIds,
              )}) ORDER BY "id" FOR UPDATE`,
            );
          }
          return work(tx, new Set(candidateIds));
        });
      } catch (error) {
        if (!(error instanceof InterruptedUpdateCandidateSetChangedError)) throw error;
        if (attempt === CANDIDATE_DEVICE_LOCK_RETRY_LIMIT) {
          throw new ConflictException(
            'The device update set changed repeatedly; retry the device disable request',
          );
        }
      }
    }
    throw new ConflictException('Unable to establish the device update settlement lock');
  }

  private async settleInterruptedUpdatesWithCanonicalLocks(
    deviceId: string,
    target: 'REVOKED' | 'KILLED',
    now: Date,
    honorStoredDisableStatus = true,
  ): Promise<{ preBoundary: number; postBoundary: number }> {
    return this.withCandidateFirstDeviceTransaction(deviceId, async (tx, lockedCandidateIds) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_devices" WHERE "id" = ${deviceId} FOR UPDATE`;
      let settlementTarget = target;
      if (honorStoredDisableStatus) {
        const device = await tx.msaidiziDevice.findUnique({
          where: { id: deviceId },
          select: { status: true },
        });
        if (
          device?.status === MsaidiziDeviceStatus.KILLED ||
          device?.status === MsaidiziDeviceStatus.REVOKED
        ) {
          settlementTarget = device.status;
        }
      }
      const active = await this.loadInterruptedUpdateDeployments(tx, deviceId);
      this.assertInterruptedUpdateCandidatesWereLocked(active, lockedCandidateIds);
      return this.settleInterruptedUpdateDeployments(tx, deviceId, settlementTarget, now, active);
    });
  }

  private loadInterruptedUpdateDeployments(
    tx: Prisma.TransactionClient,
    deviceId: string,
  ): Promise<InterruptedUpdateDeployment[]> {
    return tx.msaidiziUpdateDeployment.findMany({
      where: {
        deviceId,
        resultDigest: null,
        status: {
          in: [
            MsaidiziUpdateDeploymentStatus.QUEUED,
            MsaidiziUpdateDeploymentStatus.DISPATCHED,
            MsaidiziUpdateDeploymentStatus.APPLYING,
            MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
          ],
        },
      },
      select: { id: true, candidateId: true, operation: true, status: true },
    });
  }

  private assertInterruptedUpdateCandidatesWereLocked(
    active: readonly InterruptedUpdateDeployment[],
    lockedCandidateIds: ReadonlySet<string>,
  ): void {
    if (active.some(({ candidateId }) => !lockedCandidateIds.has(candidateId))) {
      throw new InterruptedUpdateCandidateSetChangedError();
    }
  }

  private async settleInterruptedUpdateDeployments(
    tx: Prisma.TransactionClient,
    deviceId: string,
    target: 'REVOKED' | 'KILLED',
    now: Date,
    active: readonly InterruptedUpdateDeployment[],
  ): Promise<{ preBoundary: number; postBoundary: number }> {
    const preBoundaryIds = active
      .filter(
        ({ status }) =>
          status === MsaidiziUpdateDeploymentStatus.QUEUED ||
          status === MsaidiziUpdateDeploymentStatus.DISPATCHED,
      )
      .map(({ id }) => id);
    const postBoundaryIds = active
      .filter(
        ({ status }) =>
          status === MsaidiziUpdateDeploymentStatus.APPLYING ||
          status === MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
      )
      .map(({ id }) => id);
    const reason = target === 'KILLED' ? 'DEVICE_KILLED' : 'DEVICE_REVOKED';
    if (preBoundaryIds.length > 0) {
      await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: { in: preBoundaryIds },
          resultDigest: null,
          status: {
            in: [MsaidiziUpdateDeploymentStatus.QUEUED, MsaidiziUpdateDeploymentStatus.DISPATCHED],
          },
        },
        data: {
          status: MsaidiziUpdateDeploymentStatus.FAILED,
          completedAt: now,
          resultSummary: persistedJsonObject({
            source: 'device-disable-reconciliation',
            reason: `${reason}_BEFORE_UPDATE_BOUNDARY`,
            deviceId,
            observedAt: now.toISOString(),
            mutationStarted: false,
            updateBoundaryCrossed: false,
            boundaryState: 'BEFORE_UPDATE_MUTATION',
          }),
        },
      });
    }
    if (postBoundaryIds.length > 0) {
      await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: { in: postBoundaryIds },
          resultDigest: null,
          status: {
            in: [
              MsaidiziUpdateDeploymentStatus.APPLYING,
              MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
            ],
          },
        },
        data: {
          status: MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
          completedAt: now,
          resultSummary: persistedJsonObject({
            source: 'device-disable-reconciliation',
            reason: `${reason}_UPDATE_OUTCOME_UNKNOWN`,
            deviceId,
            observedAt: now.toISOString(),
            mutationStarted: true,
            updateBoundaryCrossed: true,
            boundaryState: 'AFTER_UPDATE_MUTATION_UNKNOWN',
            terminalEvidenceMayReconcile: target === 'KILLED',
          }),
        },
      });
    }
    const candidateIds = [...new Set(active.map(({ candidateId }) => candidateId))];
    if (candidateIds.length > 0) {
      await tx.msaidiziUpdateCandidate.updateMany({
        where: {
          id: { in: candidateIds },
          status: {
            in: [
              MsaidiziUpdateCandidateStatus.APPROVED,
              MsaidiziUpdateCandidateStatus.CANARY,
              MsaidiziUpdateCandidateStatus.ACTIVE,
              MsaidiziUpdateCandidateStatus.FAILED,
            ],
          },
        },
        data: { status: MsaidiziUpdateCandidateStatus.FAILED },
      });
    }
    const preBoundaryApplyCandidateIds = [
      ...new Set(
        active
          .filter(
            ({ operation, status }) =>
              operation === MsaidiziUpdateDeploymentOperation.APPLY &&
              (status === MsaidiziUpdateDeploymentStatus.QUEUED ||
                status === MsaidiziUpdateDeploymentStatus.DISPATCHED),
          )
          .map(({ candidateId }) => candidateId),
      ),
    ];
    if (preBoundaryApplyCandidateIds.length > 0) {
      const succeededApplyPeers = await tx.msaidiziUpdateDeployment.findMany({
        where: {
          candidateId: { in: preBoundaryApplyCandidateIds },
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
          status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
        },
        distinct: ['candidateId'],
        select: { candidateId: true },
      });
      const peerRecoveryCandidateIds = [
        ...new Set(succeededApplyPeers.map(({ candidateId }) => candidateId)),
      ];
      if (peerRecoveryCandidateIds.length > 0) {
        await tx.msaidiziUpdateCandidate.updateMany({
          // A prior unknown-outcome/manual-repair request is strictly stronger
          // than this drainable peer rollback request and must never be
          // downgraded merely because another device is disabled later.
          where: { id: { in: peerRecoveryCandidateIds }, recoveryPending: false },
          data: {
            recoveryPending: true,
            recoveryRequestedAt: now,
            recoveryLastAttemptAt: now,
            recoveryLastErrorCode: DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED,
          },
        });
      }
    }
    const incompleteRollbackCandidateIds = [
      ...new Set(
        active
          .filter(
            ({ operation, status }) =>
              operation === MsaidiziUpdateDeploymentOperation.ROLLBACK &&
              (status === MsaidiziUpdateDeploymentStatus.QUEUED ||
                status === MsaidiziUpdateDeploymentStatus.DISPATCHED),
          )
          .map(({ candidateId }) => candidateId),
      ),
    ];
    if (incompleteRollbackCandidateIds.length > 0) {
      await tx.msaidiziUpdateCandidate.updateMany({
        where: { id: { in: incompleteRollbackCandidateIds } },
        data: {
          recoveryPending: true,
          recoveryRequestedAt: now,
          recoveryLastAttemptAt: now,
          recoveryLastErrorCode: 'DEVICE_DISABLED_ROLLBACK_INCOMPLETE',
        },
      });
    }
    const uncertainCandidateIds = [
      ...new Set(
        active
          .filter(
            ({ status }) =>
              status === MsaidiziUpdateDeploymentStatus.APPLYING ||
              status === MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
          )
          .map(({ candidateId }) => candidateId),
      ),
    ];
    if (uncertainCandidateIds.length > 0) {
      await tx.msaidiziUpdateCandidate.updateMany({
        where: { id: { in: uncertainCandidateIds } },
        data: {
          recoveryPending: true,
          recoveryRequestedAt: now,
          recoveryLastAttemptAt: now,
          recoveryLastErrorCode: 'DEVICE_DISABLED_UPDATE_OUTCOME_UNKNOWN',
        },
      });
    }
    return { preBoundary: preBoundaryIds.length, postBoundary: postBoundaryIds.length };
  }

  private async cancelCommands(deviceId: string, limit: number): Promise<DeviceCommand[]> {
    const globalKill = this.config.globalKillSwitchActive;
    const actions = await this.prisma.msaidiziHostAction.findMany({
      where: {
        deviceId,
        status: { in: [MsaidiziHostActionStatus.DISPATCHED, MsaidiziHostActionStatus.RUNNING] },
      },
      include: { task: { include: { mandate: true } }, step: true },
      orderBy: { createdAt: 'asc' },
      take: Math.max(limit * 10, 20),
    });
    const now = new Date().toISOString();
    return actions
      .map((action) => {
        const taskStopping = new Set<MsaidiziTaskStatus>(STOPPING_TASKS).has(action.task.status);
        const mandateInvalid = !isMandateValidForAction(
          action.task.mandate,
          action.deviceId,
          action.capability,
          action.capabilityVersion,
          action.effect,
          action.dataClass,
          action.step.arguments,
        );
        const reasonCode = globalKill
          ? 'GLOBAL_KILL_SWITCH'
          : taskStopping
            ? 'TASK_STOPPED'
            : mandateInvalid
              ? 'MANDATE_INACTIVE'
              : null;
        return reasonCode
          ? {
              kind: 'cancel' as const,
              request: {
                actionId: action.actionId,
                taskId: action.taskId,
                deviceId: action.deviceId,
                reasonCode,
                requestedAt: now,
              },
            }
          : null;
      })
      .filter((command): command is NonNullable<typeof command> => command !== null)
      .slice(0, limit);
  }

  private async cancelUndispatchedActions(deviceId: string) {
    const queued = await this.prisma.msaidiziHostAction.findMany({
      where: {
        deviceId,
        status: MsaidiziHostActionStatus.QUEUED,
        ...(this.config.globalKillSwitchActive
          ? {}
          : { task: { status: { in: [...STOPPING_TASKS] } } }),
      },
      select: { id: true },
    });
    for (const action of queued) {
      await this.settleInterruptedAction(action.id, 'CANCELLED_BEFORE_HOST_DISPATCH', false, true);
    }
  }

  /**
   * Cancels broker-staged actions without waiting for the workstation to poll.
   * A queued action has not crossed the device boundary, so central
   * cancellation is definitive and lets the durable task reach CANCELLED even
   * while the device is offline.
   */
  async cancelUndispatchedTaskActions(taskId: string): Promise<void> {
    const queued = await this.prisma.msaidiziHostAction.findMany({
      where: {
        taskId,
        status: MsaidiziHostActionStatus.QUEUED,
        task: {
          status: {
            in: [MsaidiziTaskStatus.CANCELLING, MsaidiziTaskStatus.CANCELLED],
          },
        },
      },
      select: { id: true },
    });
    for (const action of queued) {
      await this.settleInterruptedAction(action.id, 'CANCELLED_BEFORE_HOST_DISPATCH', false, true);
    }
  }

  private async hasPendingLateEvidence(deviceId: string): Promise<boolean> {
    return (
      (await this.prisma.msaidiziHostAction.count({
        where: {
          deviceId,
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: { in: [...LATE_RECOVERY_EVIDENCE_ERROR_CODES] },
          journalAccepted: false,
          lateEvidenceAcceptedAt: null,
          step: { mutation: true },
        },
      })) > 0
    );
  }

  /**
   * Protocol-v3 negative-execution recovery. This command creates no device
   * lease and grants no execution authority. It asks the companion to persist
   * one stable revocation tombstone for the old lease fence. Only the separate
   * authenticated receipt path can unblock the device.
   */
  private async claimFenceActionCommand(
    deviceId: string,
    runtime: Record<string, unknown>,
    capabilityManifest: Prisma.JsonValue,
  ): Promise<DeviceCommand | null> {
    if (
      manifestCommandProtocolVersion(capabilityManifest) < 3 ||
      runtime.runningActionCount !== 0 ||
      runtime.centralLedgerConnected !== true ||
      !this.fenceSigner
    ) {
      return null;
    }
    const runtimeSequence = runtime.journalSequence;
    const runtimeHead = jsonString(runtime, 'journalHeadHash');
    const runtimeReceivedAt =
      typeof runtime.receivedAt === 'string' ? Date.parse(runtime.receivedAt) : Number.NaN;
    if (
      typeof runtimeSequence !== 'number' ||
      !Number.isSafeInteger(runtimeSequence) ||
      runtimeSequence < 0 ||
      !isSha256Hex(runtimeHead) ||
      !Number.isFinite(runtimeReceivedAt)
    ) {
      return null;
    }
    const staleBefore = new Date(Date.now() - this.config.redeliverySeconds * 1_000);
    const candidates = await this.prisma.msaidiziHostAction.findMany({
      where: {
        deviceId,
        status: MsaidiziHostActionStatus.UNKNOWN,
        uncertainOutcome: true,
        errorCode: { in: [...LATE_RECOVERY_EVIDENCE_ERROR_CODES] },
        acknowledgedDispatchCount: 0,
        acknowledgedAt: null,
        startedAt: null,
        journalAccepted: false,
        lateEvidenceAcceptedAt: null,
        journalSequence: null,
        journalHash: null,
        step: { mutation: true },
      },
      include: {
        lease: true,
        task: true,
        step: true,
        fence: true,
        dispatches: {
          where: { executionMode: 'EXECUTE' },
          orderBy: { dispatchCount: 'desc' },
        },
      },
      orderBy: { endedAt: 'asc' },
      take: 10,
    });
    for (const action of candidates) {
      const latestExecute = action.dispatches[0];
      const runtimeAtPredecessor =
        action.journalExpectedPreviousSequence === runtimeSequence &&
        action.journalPreviousHash != null &&
        fixedTimeHexEquals(action.journalPreviousHash, runtimeHead);
      const runtimeAtUnconfirmedTombstone =
        action.fence?.status === MsaidiziHostActionFenceStatus.DISPATCHED &&
        action.fence.receiptDigest == null &&
        action.journalExpectedPreviousSequence != null &&
        runtimeSequence === action.journalExpectedPreviousSequence + 1 &&
        action.journalPreviousHash != null &&
        !fixedTimeHexEquals(action.journalPreviousHash, runtimeHead);
      if (
        !interruptedActionAcceptsLateEvidence(action) ||
        !action.endedAt ||
        runtimeReceivedAt <= action.endedAt.getTime() ||
        action.leaseId == null ||
        action.leaseFencingToken == null ||
        action.lease?.status !== MsaidiziDeviceLeaseStatus.EXPIRED ||
        action.journalExpectedPreviousSequence == null ||
        action.journalPreviousHash == null ||
        (!runtimeAtPredecessor && !runtimeAtUnconfirmedTombstone) ||
        !latestExecute ||
        latestExecute.dispatchCount !== action.dispatchCount ||
        latestExecute.leaseId !== action.leaseId ||
        latestExecute.leaseFencingToken !== action.leaseFencingToken ||
        !fixedTimeHexEquals(latestExecute.actionTokenDigest, action.actionTokenDigest)
      ) {
        continue;
      }
      const now = new Date();
      const claim = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${action.taskId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_devices" WHERE "id" = ${deviceId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_host_actions" WHERE "id" = ${action.id} FOR UPDATE`;
        const current = await tx.msaidiziHostAction.findUnique({
          where: { id: action.id },
          include: {
            lease: true,
            fence: true,
            dispatches: {
              where: { executionMode: 'EXECUTE' },
              orderBy: { dispatchCount: 'desc' },
            },
          },
        });
        const currentExecute = current?.dispatches[0];
        const currentRuntimeAtPredecessor =
          current?.journalExpectedPreviousSequence === runtimeSequence &&
          current.journalPreviousHash != null &&
          fixedTimeHexEquals(current.journalPreviousHash, runtimeHead);
        const currentRuntimeAtUnconfirmedTombstone =
          current?.fence?.status === MsaidiziHostActionFenceStatus.DISPATCHED &&
          current.fence.receiptDigest == null &&
          current.journalExpectedPreviousSequence != null &&
          runtimeSequence === current.journalExpectedPreviousSequence + 1 &&
          current.journalPreviousHash != null &&
          !fixedTimeHexEquals(current.journalPreviousHash, runtimeHead);
        if (
          !current ||
          current.deviceId !== deviceId ||
          !interruptedActionAcceptsLateEvidence(current) ||
          current.acknowledgedDispatchCount !== 0 ||
          current.acknowledgedAt != null ||
          current.startedAt != null ||
          current.journalAccepted ||
          current.lateEvidenceAcceptedAt != null ||
          current.journalSequence != null ||
          current.journalHash != null ||
          current.leaseId == null ||
          current.leaseFencingToken == null ||
          current.lease?.status !== MsaidiziDeviceLeaseStatus.EXPIRED ||
          current.journalExpectedPreviousSequence == null ||
          current.journalPreviousHash == null ||
          (!currentRuntimeAtPredecessor && !currentRuntimeAtUnconfirmedTombstone) ||
          !currentExecute ||
          currentExecute.dispatchCount !== current.dispatchCount ||
          currentExecute.leaseId !== current.leaseId ||
          currentExecute.leaseFencingToken !== current.leaseFencingToken ||
          !fixedTimeHexEquals(currentExecute.actionTokenDigest, current.actionTokenDigest)
        ) {
          return null;
        }
        // A newer action lease would allow a different command to race the
        // tombstone journal slot. Fence recovery never creates or rotates a
        // lease and waits until the device has no active authority.
        const activeLease = await tx.msaidiziDeviceLease.findFirst({
          where: { deviceId, status: MsaidiziDeviceLeaseStatus.ACTIVE },
          select: { id: true },
        });
        if (activeLease) return null;

        let fence = current.fence;
        if (!fence) {
          fence = await tx.msaidiziHostActionFence.create({
            data: {
              fenceId: randomUUID(),
              hostActionId: current.id,
              deviceId,
              oldLeaseId: current.leaseId,
              oldLeaseFencingToken: current.leaseFencingToken,
              oldActionTokenDigest: current.actionTokenDigest.toUpperCase(),
              journalPreviousSequence: current.journalExpectedPreviousSequence,
              journalPreviousHash: current.journalPreviousHash.toUpperCase(),
              maxDispatches: BROKER_MAX_DELIVERY_SESSIONS,
            },
          });
        }
        if (
          !new Set<MsaidiziHostActionFenceStatus>([
            MsaidiziHostActionFenceStatus.PENDING,
            MsaidiziHostActionFenceStatus.DISPATCHED,
          ]).has(fence.status) ||
          fence.deviceId !== deviceId ||
          fence.hostActionId !== current.id ||
          fence.oldLeaseId !== current.leaseId ||
          fence.oldLeaseFencingToken !== current.leaseFencingToken ||
          !fixedTimeHexEquals(fence.oldActionTokenDigest, current.actionTokenDigest) ||
          fence.journalPreviousSequence !== current.journalExpectedPreviousSequence ||
          !fixedTimeHexEquals(fence.journalPreviousHash, current.journalPreviousHash) ||
          fence.maxDispatches !== BROKER_MAX_DELIVERY_SESSIONS ||
          fence.dispatchCount >= fence.maxDispatches ||
          (fence.status === MsaidiziHostActionFenceStatus.DISPATCHED &&
            (!fence.dispatchedAt || fence.dispatchedAt > staleBefore))
        ) {
          return null;
        }
        const nextDispatchCount = fence.dispatchCount + 1;
        const issued = this.fenceSigner!.issue(
          {
            fenceId: fence.fenceId,
            deviceId,
            actionId: current.actionId,
            taskId: current.taskId,
            stepId: current.stepId,
            oldLeaseId: fence.oldLeaseId,
            oldFencingToken: fence.oldLeaseFencingToken.toString(),
            oldActionTokenSha256: fence.oldActionTokenDigest,
            journalPreviousSequence: fence.journalPreviousSequence,
            journalPreviousHash: fence.journalPreviousHash,
            dispatchCount: nextDispatchCount,
          },
          now,
        );
        const fenceTokenDigest = sha256Hex(issued.compactToken);
        const won = await tx.msaidiziHostActionFence.updateMany({
          where: {
            fenceId: fence.fenceId,
            hostActionId: current.id,
            deviceId,
            status: fence.status,
            dispatchCount: fence.dispatchCount,
            maxDispatches: fence.maxDispatches,
            dispatchedAt: fence.dispatchedAt,
            oldLeaseId: fence.oldLeaseId,
            oldLeaseFencingToken: fence.oldLeaseFencingToken,
            oldActionTokenDigest: fence.oldActionTokenDigest,
            journalPreviousSequence: fence.journalPreviousSequence,
            journalPreviousHash: fence.journalPreviousHash,
            receiptDigest: null,
          },
          data: {
            status: MsaidiziHostActionFenceStatus.DISPATCHED,
            dispatchCount: { increment: 1 },
            dispatchedAt: now,
          },
        });
        if (won.count !== 1) return null;
        await tx.msaidiziHostActionFenceDispatch.create({
          data: {
            fenceId: fence.fenceId,
            dispatchCount: nextDispatchCount,
            fenceTokenDigest,
            tokenId: issued.tokenId,
            tokenIssuedAt: new Date(issued.issuedAt * 1_000),
            tokenExpiresAt: new Date(issued.expiresAt * 1_000),
          },
        });
        await this.event(tx, current.taskId, 'host_action.fence_requested', {
          fenceId: fence.fenceId,
          actionId: current.actionId,
          stepId: current.stepId,
          deviceId,
          oldLeaseId: fence.oldLeaseId,
          oldFencingToken: fence.oldLeaseFencingToken.toString(),
          oldActionTokenSha256: fence.oldActionTokenDigest,
          journalPreviousSequence: fence.journalPreviousSequence,
          journalPreviousHash: fence.journalPreviousHash,
          dispatchCount: nextDispatchCount,
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_HOST_ACTION_FENCE_REQUESTED',
          entityType: 'MsaidiziHostActionFence',
          entityId: fence.fenceId,
          userId: action.task.initiatedByUserId ?? undefined,
          companyId: action.task.companyId,
          newValue: {
            actionId: current.actionId,
            deviceId,
            oldLeaseId: fence.oldLeaseId,
            oldFencingToken: fence.oldLeaseFencingToken.toString(),
            oldActionTokenSha256: fence.oldActionTokenDigest,
            journalPreviousSequence: fence.journalPreviousSequence,
            journalPreviousHash: fence.journalPreviousHash,
            dispatchCount: nextDispatchCount,
            tokenExpiresAt: new Date(issued.expiresAt * 1_000).toISOString(),
          },
          severity: AuditSeverity.CRITICAL,
          channel: AuditChannel.AGENT,
          agentSessionId: taskSessionId(current.taskId),
          principalType: 'MSAIDIZI',
          principalId: action.task.principalId,
          mandateId: action.task.mandateId ?? undefined,
          initiatedByUserId: action.task.initiatedByUserId ?? undefined,
          taskId: current.taskId,
          stepId: current.stepId,
          deviceId,
        });
        return {
          fence,
          issued,
          nextDispatchCount,
          actionId: current.actionId,
          taskId: current.taskId,
          stepId: current.stepId,
        };
      });
      if (!claim) continue;
      return {
        kind: 'fence-action',
        fence: {
          request: {
            fenceId: claim.fence.fenceId,
            deviceId,
            actionId: claim.actionId,
            taskId: claim.taskId,
            stepId: claim.stepId,
            oldLeaseId: claim.fence.oldLeaseId,
            oldFencingToken: claim.fence.oldLeaseFencingToken.toString(),
            oldActionTokenSha256: claim.fence.oldActionTokenDigest,
            journalPreviousSequence: claim.fence.journalPreviousSequence,
            journalPreviousHash: claim.fence.journalPreviousHash,
            dispatchCount: claim.nextDispatchCount,
            expiresAt: new Date(claim.issued.expiresAt * 1_000).toISOString(),
          },
          compactToken: claim.issued.compactToken,
        },
      };
    }
    return null;
  }

  private async settleActionFenceReceipt(dto: ActionFencedReceiptDto, deviceId: string) {
    if (!this.fenceSigner) {
      throw new ServiceUnavailableException('The device fence verifier is unavailable');
    }
    const stableReceiptDigest = fenceReceiptDigest(dto);
    const fence = await this.prisma.msaidiziHostActionFence.findUnique({
      where: { fenceId: dto.fenceId },
      include: {
        hostAction: { include: { task: true, step: true } },
        dispatches: { orderBy: { dispatchCount: 'asc' } },
      },
    });
    if (!fence || fence.deviceId !== deviceId || fence.hostAction.deviceId !== deviceId) {
      throw new NotFoundException('Host action fence not found');
    }
    const historicalReplay =
      fence.status === MsaidiziHostActionFenceStatus.ACKNOWLEDGED &&
      fence.receiptDigest != null &&
      fixedTimeHexEquals(fence.receiptDigest, stableReceiptDigest);
    const compactTokenDigest = sha256Hex(dto.compactToken);
    const authorizedDispatch = fence.dispatches.find(
      (dispatch) =>
        dispatch.dispatchCount === dto.fenceDispatchCount &&
        fixedTimeHexEquals(dispatch.fenceTokenDigest, dto.fenceTokenSha256) &&
        fixedTimeHexEquals(dispatch.fenceTokenDigest, compactTokenDigest),
    );
    const verification = this.fenceSigner.verify(dto.compactToken, new Date(), historicalReplay);
    const claims = verification.claims;
    if (!verification.valid || !claims || !authorizedDispatch) {
      throw new ConflictException('Fence receipt token is invalid or was never issued');
    }
    const recordedAt = Date.parse(dto.recordedAt);
    const now = Date.now();
    if (
      !Number.isFinite(recordedAt) ||
      recordedAt <
        authorizedDispatch.tokenIssuedAt.getTime() - EGRESS_MAX_CLOCK_SKEW_MILLISECONDS ||
      (!historicalReplay &&
        (recordedAt > now + EGRESS_MAX_CLOCK_SKEW_MILLISECONDS ||
          recordedAt >
            authorizedDispatch.tokenExpiresAt.getTime() + EGRESS_MAX_CLOCK_SKEW_MILLISECONDS)) ||
      claims.issuedAt * 1_000 !== authorizedDispatch.tokenIssuedAt.getTime() ||
      claims.expiresAt * 1_000 !== authorizedDispatch.tokenExpiresAt.getTime()
    ) {
      throw new ConflictException('Fence receipt freshness does not match its signed dispatch');
    }
    const hostAction = fence.hostAction;
    if (
      claims.fenceId !== fence.fenceId ||
      claims.deviceId !== deviceId ||
      claims.actionId !== hostAction.actionId ||
      claims.taskId !== hostAction.taskId ||
      claims.stepId !== hostAction.stepId ||
      claims.oldLeaseId !== fence.oldLeaseId ||
      claims.oldFencingToken !== fence.oldLeaseFencingToken.toString() ||
      !fixedTimeHexEquals(claims.oldActionTokenSha256, fence.oldActionTokenDigest) ||
      claims.journalPreviousSequence !== fence.journalPreviousSequence ||
      !fixedTimeHexEquals(claims.journalPreviousHash, fence.journalPreviousHash) ||
      claims.dispatchCount !== dto.fenceDispatchCount ||
      dto.deviceId !== deviceId ||
      dto.actionId !== hostAction.actionId ||
      dto.taskId !== hostAction.taskId ||
      dto.stepId !== hostAction.stepId ||
      dto.oldLeaseId !== fence.oldLeaseId ||
      dto.oldFencingToken !== fence.oldLeaseFencingToken.toString() ||
      !fixedTimeHexEquals(dto.oldActionTokenSha256, fence.oldActionTokenDigest) ||
      dto.journalPreviousSequence !== fence.journalPreviousSequence ||
      !fixedTimeHexEquals(dto.journalPreviousHash, fence.journalPreviousHash) ||
      dto.tombstoneSequence !== fence.journalPreviousSequence + 1 ||
      !fixedTimeHexEquals(dto.tombstonePreviousHash, fence.journalPreviousHash) ||
      fixedTimeHexEquals(dto.tombstoneEntryHash, fence.journalPreviousHash)
    ) {
      throw new ConflictException('Fence receipt does not match its immutable command binding');
    }
    if (fence.status === MsaidiziHostActionFenceStatus.ACKNOWLEDGED) {
      if (historicalReplay) {
        return {
          accepted: true,
          replay: true,
          status: MsaidiziHostActionStatus.FAILED,
          taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
        };
      }
      throw new ConflictException('A conflicting fence receipt was already accepted');
    }
    if (fence.status !== MsaidiziHostActionFenceStatus.DISPATCHED) {
      throw new ConflictException('Fence command has not been durably dispatched');
    }

    const settled = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${hostAction.taskId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_devices" WHERE "id" = ${deviceId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_host_actions" WHERE "id" = ${hostAction.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "fenceId" FROM "msaidizi_host_action_fences" WHERE "fenceId" = ${fence.fenceId} FOR UPDATE`;
      const currentFence = await tx.msaidiziHostActionFence.findUnique({
        where: { fenceId: fence.fenceId },
      });
      if (
        currentFence?.status === MsaidiziHostActionFenceStatus.ACKNOWLEDGED &&
        currentFence.receiptDigest != null &&
        fixedTimeHexEquals(currentFence.receiptDigest, stableReceiptDigest)
      ) {
        return { replay: true };
      }
      if (
        !currentFence ||
        currentFence.status !== MsaidiziHostActionFenceStatus.DISPATCHED ||
        currentFence.receiptDigest != null ||
        currentFence.deviceId !== deviceId ||
        currentFence.hostActionId !== hostAction.id ||
        currentFence.oldLeaseId !== fence.oldLeaseId ||
        currentFence.oldLeaseFencingToken !== fence.oldLeaseFencingToken ||
        !fixedTimeHexEquals(currentFence.oldActionTokenDigest, fence.oldActionTokenDigest) ||
        currentFence.journalPreviousSequence !== fence.journalPreviousSequence ||
        !fixedTimeHexEquals(currentFence.journalPreviousHash, fence.journalPreviousHash) ||
        currentFence.dispatchCount < dto.fenceDispatchCount ||
        currentFence.dispatchCount > currentFence.maxDispatches
      ) {
        return null;
      }
      const currentAction = await tx.msaidiziHostAction.findUnique({
        where: { id: hostAction.id },
        include: { task: true },
      });
      if (
        !currentAction ||
        currentAction.deviceId !== deviceId ||
        !interruptedActionAcceptsLateEvidence(currentAction) ||
        currentAction.acknowledgedDispatchCount !== 0 ||
        currentAction.acknowledgedAt != null ||
        currentAction.startedAt != null ||
        currentAction.journalAccepted ||
        currentAction.lateEvidenceAcceptedAt != null ||
        currentAction.journalSequence != null ||
        currentAction.journalHash != null ||
        currentAction.leaseId !== fence.oldLeaseId ||
        currentAction.leaseFencingToken !== fence.oldLeaseFencingToken ||
        !fixedTimeHexEquals(currentAction.actionTokenDigest, fence.oldActionTokenDigest) ||
        currentAction.journalExpectedPreviousSequence !== fence.journalPreviousSequence ||
        currentAction.journalPreviousHash == null ||
        !fixedTimeHexEquals(currentAction.journalPreviousHash, fence.journalPreviousHash) ||
        currentAction.task.status !== MsaidiziTaskStatus.NEEDS_ATTENTION
      ) {
        return null;
      }
      const activeLease = await tx.msaidiziDeviceLease.findFirst({
        where: { deviceId, status: MsaidiziDeviceLeaseStatus.ACTIVE },
        select: { id: true },
      });
      if (activeLease) return null;

      const acceptedAt = new Date();
      const evidence = persistedJsonObject({
        protocol: 'msaidizi-action-fence/v3',
        outcome: 'NoPrepared',
        fenceId: fence.fenceId,
        actionId: currentAction.actionId,
        taskId: currentAction.taskId,
        stepId: currentAction.stepId,
        deviceId,
        oldLeaseId: fence.oldLeaseId,
        oldFencingToken: fence.oldLeaseFencingToken.toString(),
        oldActionTokenSha256: fence.oldActionTokenDigest,
        journalPreviousSequence: fence.journalPreviousSequence,
        journalPreviousHash: fence.journalPreviousHash,
        tombstoneSequence: dto.tombstoneSequence,
        tombstonePreviousHash: dto.tombstonePreviousHash.toUpperCase(),
        tombstoneEntryHash: dto.tombstoneEntryHash.toUpperCase(),
        receiptDigest: stableReceiptDigest,
        acceptedAt: acceptedAt.toISOString(),
        mutationCommitted: false,
        outcomeUncertain: false,
      });
      const event = await this.event(
        tx,
        currentAction.taskId,
        'host_action.no_prepared_fence_reconciled',
        evidence,
      );
      const actionWon = await tx.msaidiziHostAction.updateMany({
        where: {
          id: currentAction.id,
          deviceId,
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: currentAction.errorCode,
          acknowledgedDispatchCount: 0,
          acknowledgedAt: null,
          startedAt: null,
          journalAccepted: false,
          journalReceiptDigest: null,
          journalEvidenceEventCursor: null,
          lateEvidenceAcceptedAt: null,
          journalExpectedPreviousSequence: fence.journalPreviousSequence,
          journalPreviousHash: currentAction.journalPreviousHash,
          journalSequence: null,
          journalHash: null,
          leaseId: fence.oldLeaseId,
          leaseFencingToken: fence.oldLeaseFencingToken,
          actionTokenDigest: currentAction.actionTokenDigest,
        },
        data: {
          status: MsaidiziHostActionStatus.FAILED,
          uncertainOutcome: false,
          errorCode: 'DEVICE_LEASE_EXPIRED_NO_PREPARED_CONFIRMED',
          uncertainExternalEgressBytes: 0n,
          journalSequence: dto.tombstoneSequence,
          journalPreviousHash: dto.tombstonePreviousHash.toUpperCase(),
          journalHash: dto.tombstoneEntryHash.toUpperCase(),
          journalAccepted: true,
          journalReceiptDigest: stableReceiptDigest,
          journalEvidenceEventCursor: event.cursor,
          journalEvidenceAcceptedAt: acceptedAt,
          lateEvidenceAcceptedAt: acceptedAt,
          resultSummary: evidence,
          endedAt: acceptedAt,
        },
      });
      if (actionWon.count !== 1) return null;
      const fenceWon = await tx.msaidiziHostActionFence.updateMany({
        where: {
          fenceId: currentFence.fenceId,
          hostActionId: currentAction.id,
          deviceId,
          status: MsaidiziHostActionFenceStatus.DISPATCHED,
          dispatchCount: currentFence.dispatchCount,
          receiptDigest: null,
          tombstoneSequence: null,
          tombstonePreviousHash: null,
          tombstoneHash: null,
          acknowledgedAt: null,
        },
        data: {
          status: MsaidiziHostActionFenceStatus.ACKNOWLEDGED,
          receiptDigest: stableReceiptDigest,
          tombstoneSequence: dto.tombstoneSequence,
          tombstonePreviousHash: dto.tombstonePreviousHash.toUpperCase(),
          tombstoneHash: dto.tombstoneEntryHash.toUpperCase(),
          acknowledgedAt: acceptedAt,
        },
      });
      if (fenceWon.count !== 1) {
        throw new HostActionPolicyError('HOST_ACTION_FENCE_RECEIPT_CAS_LOST');
      }
      const accountingWon = await tx.msaidiziTask.updateMany({
        where: {
          id: currentAction.taskId,
          status: MsaidiziTaskStatus.NEEDS_ATTENTION,
          externalEgressBytes: { gte: currentAction.uncertainExternalEgressBytes },
        },
        data: {
          externalEgressBytes: { decrement: currentAction.uncertainExternalEgressBytes },
          lastCheckpointAt: acceptedAt,
        },
      });
      if (accountingWon.count !== 1) {
        throw new HostActionPolicyError('HOST_ACTION_FENCE_ACCOUNTING_CAS_LOST');
      }
      await tx.msaidiziTaskStep.updateMany({
        where: {
          id: currentAction.stepId,
          taskId: currentAction.taskId,
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
        },
        data: { localIoAccountingValid: true, endedAt: acceptedAt },
      });
      const latestAttempt = await tx.msaidiziToolAttempt.findFirst({
        where: { taskId: currentAction.taskId, stepId: currentAction.stepId },
        orderBy: { attemptNumber: 'desc' },
        select: { id: true },
      });
      if (latestAttempt) {
        await tx.msaidiziToolAttempt.updateMany({
          where: {
            id: latestAttempt.id,
            status: MsaidiziToolAttemptStatus.UNKNOWN,
            uncertainOutcome: true,
          },
          data: {
            status: MsaidiziToolAttemptStatus.FAILED,
            uncertainOutcome: false,
            errorCode: 'DEVICE_LEASE_EXPIRED_NO_PREPARED_CONFIRMED',
            endedAt: acceptedAt,
          },
        });
      }
      await this.audit.logStrictInTransaction(tx, {
        action: 'MSAIDIZI_HOST_ACTION_NO_PREPARED_FENCE_ACCEPTED',
        entityType: 'MsaidiziHostActionFence',
        entityId: fence.fenceId,
        userId: currentAction.task.initiatedByUserId ?? undefined,
        companyId: currentAction.task.companyId,
        newValue: evidence,
        severity: AuditSeverity.CRITICAL,
        channel: AuditChannel.AGENT,
        agentSessionId: taskSessionId(currentAction.taskId),
        principalType: 'MSAIDIZI',
        principalId: currentAction.task.principalId,
        mandateId: currentAction.task.mandateId ?? undefined,
        initiatedByUserId: currentAction.task.initiatedByUserId ?? undefined,
        taskId: currentAction.taskId,
        stepId: currentAction.stepId,
        deviceId,
      });
      return { replay: false };
    });
    if (!settled) {
      throw new ConflictException('Fence receipt eligibility changed before persistence');
    }
    return {
      accepted: true,
      replay: settled.replay,
      status: MsaidiziHostActionStatus.FAILED,
      taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
    };
  }

  /**
   * Issues transport authority only. The signed mode is enforced again by the
   * companion, whose replay path may read a terminal cache but cannot begin a
   * journal entry or invoke an adapter.
   */
  private async claimReplayResultCommand(
    deviceId: string,
    runtime: Record<string, unknown>,
    capabilityManifest: Prisma.JsonValue,
  ): Promise<DeviceCommand | null> {
    if (
      manifestCommandProtocolVersion(capabilityManifest) < 2 ||
      runtime.runningActionCount !== 0 ||
      runtime.centralLedgerConnected !== true
    )
      return null;
    const runtimeSequence = runtime.journalSequence;
    const runtimeHead = jsonString(runtime, 'journalHeadHash');
    if (
      typeof runtimeSequence !== 'number' ||
      !Number.isSafeInteger(runtimeSequence) ||
      !isSha256Hex(runtimeHead)
    ) {
      return null;
    }
    const leasePepper = this.config.leasePepper;
    if (!leasePepper) return null;
    const staleBefore = new Date(Date.now() - this.config.redeliverySeconds * 1_000);
    const candidates = await this.prisma.msaidiziHostAction.findMany({
      where: {
        deviceId,
        status: MsaidiziHostActionStatus.UNKNOWN,
        uncertainOutcome: true,
        errorCode: { in: [...LATE_RECOVERY_EVIDENCE_ERROR_CODES] },
        journalAccepted: false,
        lateEvidenceAcceptedAt: null,
        OR: [{ dispatchedAt: null }, { dispatchedAt: { lte: staleBefore } }],
        step: { mutation: true },
      },
      include: {
        task: true,
        step: { include: { planVersion: true } },
      },
      orderBy: { endedAt: 'asc' },
      take: 10,
    });
    for (const action of candidates) {
      if (
        !interruptedActionAcceptsLateEvidence(action) ||
        action.task.mandateId == null ||
        action.journalExpectedPreviousSequence == null ||
        action.journalPreviousHash == null ||
        !heartbeatMatchesRunningTerminalJournal(
          runtimeSequence,
          runtimeHead,
          action.journalExpectedPreviousSequence,
          action.journalPreviousHash,
          action.journalSequence,
          action.journalHash,
        ) ||
        action.dispatchCount >= action.brokerMaxDeliverySessions
      ) {
        continue;
      }
      let resolvedInputs: ResolvedStepInputs;
      try {
        resolvedInputs = action.attemptId
          ? await this.resolveHostActionInputs(
              action.taskId,
              action.step.planVersionId,
              action.stepId,
              action.attemptId,
              action.step.arguments,
              action.step.inputBindings,
            )
          : staticStepInputs(
              action.taskId,
              action.step.planVersionId,
              action.stepId,
              `legacy-host-action:${action.id}`,
              action.step.arguments,
            );
      } catch {
        continue;
      }
      if (
        action.attemptId &&
        (action.resolvedInputProvenance == null ||
          !action.inputProvenanceSha256 ||
          !fixedTimeHexEquals(
            jsonSha256(action.resolvedInputProvenance),
            action.inputProvenanceSha256,
          ) ||
          !fixedTimeHexEquals(resolvedInputs.provenanceSha256, action.inputProvenanceSha256))
      ) {
        continue;
      }
      const argumentsJsonUtf8 = stableJson(resolvedInputs.arguments);
      const argumentsSha256 = sha256Hex(argumentsJsonUtf8);
      const expectedPreStateSha256 = expectedPreStateDigest(action.expectedPreState);
      const budgets = parseActionBudgets(action.budgetSnapshot);
      if (
        !fixedTimeHexEquals(argumentsSha256, action.argsDigest) ||
        !expectedPreStateSha256 ||
        !budgets ||
        BigInt(budgets.maxExternalEgressBytes) !== action.reservedExternalEgressBytes ||
        budgets.brokerMaxDeliverySessions !== action.brokerMaxDeliverySessions ||
        budgets.brokerMaxRequestAttemptsPerSession !== action.brokerMaxRequestAttemptsPerSession ||
        budgets.brokerSerializedResultUpperBoundBytes !==
          action.brokerSerializedResultUpperBoundBytes
      ) {
        continue;
      }
      const inputProvenanceSha256 =
        action.inputProvenanceSha256 ?? jsonSha256(action.step.planVersion.inputs);
      const now = new Date();
      const claim = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_host_actions" WHERE "id" = ${action.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_devices" WHERE "id" = ${deviceId} FOR UPDATE`;
        const current = await tx.msaidiziHostAction.findUnique({ where: { id: action.id } });
        if (
          !current ||
          current.deviceId !== deviceId ||
          !interruptedActionAcceptsLateEvidence(current) ||
          current.journalAccepted ||
          current.lateEvidenceAcceptedAt != null ||
          current.dispatchCount !== action.dispatchCount ||
          current.dispatchCount >= current.brokerMaxDeliverySessions ||
          current.brokerMaxDeliverySessions !== action.brokerMaxDeliverySessions ||
          current.brokerMaxRequestAttemptsPerSession !==
            action.brokerMaxRequestAttemptsPerSession ||
          current.brokerSerializedResultUpperBoundBytes !==
            action.brokerSerializedResultUpperBoundBytes ||
          current.reservedExternalEgressBytes !== action.reservedExternalEgressBytes ||
          current.journalExpectedPreviousSequence == null ||
          current.journalPreviousHash == null ||
          !heartbeatMatchesRunningTerminalJournal(
            runtimeSequence,
            runtimeHead,
            current.journalExpectedPreviousSequence,
            current.journalPreviousHash,
            current.journalSequence,
            current.journalHash,
          )
        ) {
          return null;
        }
        const activeLease = await tx.msaidiziDeviceLease.findFirst({
          where: { deviceId, status: MsaidiziDeviceLeaseStatus.ACTIVE },
          select: {
            id: true,
            taskId: true,
            stepId: true,
            fencingToken: true,
          },
        });
        if (activeLease) {
          if (
            activeLease.id !== current.leaseId ||
            activeLease.taskId !== current.taskId ||
            activeLease.stepId !== current.stepId ||
            current.leaseFencingToken == null ||
            activeLease.fencingToken !== current.leaseFencingToken
          ) {
            return null;
          }
          const released = await tx.msaidiziDeviceLease.updateMany({
            where: {
              id: activeLease.id,
              deviceId,
              taskId: current.taskId,
              stepId: current.stepId,
              fencingToken: activeLease.fencingToken,
              status: MsaidiziDeviceLeaseStatus.ACTIVE,
            },
            data: { status: MsaidiziDeviceLeaseStatus.RELEASED, releasedAt: now },
          });
          if (released.count !== 1) return null;
        }
        const nextDispatchCount = current.dispatchCount + 1;
        const leaseId = `evidence-${action.id}-${nextDispatchCount}`;
        const lease = await tx.msaidiziDeviceLease.create({
          data: {
            id: leaseId,
            taskId: action.taskId,
            stepId: action.stepId,
            deviceId,
            leaseTokenDigest: leaseTokenDigest(leasePepper, leaseId),
            expiresAt: new Date(now.getTime() + this.config.leaseTtlSeconds * 1_000),
          },
        });
        const authorizationExpiresAt = new Date(
          now.getTime() + Math.max(2, this.config.tokenTtlSeconds) * 1_000,
        );
        const request = {
          executionMode: 'REPLAY_RESULT_ONLY' as const,
          actionId: action.actionId,
          taskId: action.taskId,
          planVersionId: action.step.planVersionId,
          stepId: action.stepId,
          deviceId,
          mandateId: action.task.mandateId!,
          capabilityId: action.capability,
          capabilityVersion: action.capabilityVersion,
          argumentsJsonUtf8,
          argumentsSha256,
          expectedPreStateSha256,
          inputProvenanceSha256,
          idempotencyKey: action.idempotencyKey,
          leaseId: lease.id,
          fencingToken: lease.fencingToken.toString(),
        };
        const issued = this.signer.issue({
          executionMode: request.executionMode,
          actionId: request.actionId,
          taskId: request.taskId,
          planVersionId: request.planVersionId,
          stepId: request.stepId,
          deviceId: request.deviceId,
          mandateId: request.mandateId,
          capabilityId: request.capabilityId,
          capabilityVersion: request.capabilityVersion,
          argumentsSha256: request.argumentsSha256,
          expectedPreStateSha256: request.expectedPreStateSha256,
          inputProvenanceSha256: request.inputProvenanceSha256,
          idempotencyKey: request.idempotencyKey,
          leaseId: request.leaseId,
          fencingToken: request.fencingToken,
          leaseExpiresAt: authorizationExpiresAt,
          dispatchCount: nextDispatchCount,
          consentGrant: null,
          budgets,
        });
        const actionTokenDigest = sha256Hex(issued.compactToken);
        const won = await tx.msaidiziHostAction.updateMany({
          where: {
            id: action.id,
            deviceId,
            status: MsaidiziHostActionStatus.UNKNOWN,
            uncertainOutcome: true,
            errorCode: action.errorCode,
            journalAccepted: false,
            lateEvidenceAcceptedAt: null,
            dispatchCount: current.dispatchCount,
            journalSequence: current.journalSequence,
            journalHash: current.journalHash,
            device: { status: MsaidiziDeviceStatus.ACTIVE },
          },
          data: {
            leaseId: lease.id,
            leaseFencingToken: lease.fencingToken,
            leaseAuthorizationExpiresAt: authorizationExpiresAt,
            actionTokenDigest,
            dispatchCount: { increment: 1 },
            dispatchedAt: now,
            acknowledgedDispatchCount: 0,
            acknowledgedAt: null,
            ...(current.journalHash == null ||
            (current.journalExpectedPreviousSequence != null &&
              current.journalSequence === current.journalExpectedPreviousSequence + 2 &&
              runtimeSequence === current.journalExpectedPreviousSequence + 3)
              ? {
                  journalSequence: runtimeSequence,
                  journalHash: runtimeHead.toUpperCase(),
                }
              : {}),
          },
        });
        if (won.count !== 1) throw new HostActionPolicyError('HOST_REPLAY_RESULT_CAS_LOST');
        await tx.msaidiziHostActionDispatch.create({
          data: {
            hostActionId: action.id,
            dispatchCount: nextDispatchCount,
            actionTokenDigest,
            executionMode: 'REPLAY_RESULT_ONLY',
            tokenId: issued.tokenId,
            tokenIssuedAt: new Date(issued.issuedAt * 1_000),
            tokenExpiresAt: new Date(issued.expiresAt * 1_000),
            leaseId: lease.id,
            leaseFencingToken: lease.fencingToken,
            leaseAuthorizationExpiresAt: authorizationExpiresAt,
          },
        });
        await this.event(tx, action.taskId, 'host_action.result_replay_requested', {
          actionId: action.actionId,
          stepId: action.stepId,
          deviceId,
          dispatchCount: nextDispatchCount,
          executionMode: request.executionMode,
          journalSequence: runtimeSequence,
          journalHeadHash: runtimeHead,
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_HOST_ACTION_RESULT_REPLAY_REQUESTED',
          entityType: 'MsaidiziHostAction',
          entityId: action.actionId,
          userId: action.task.initiatedByUserId ?? undefined,
          companyId: action.task.companyId,
          newValue: {
            executionMode: request.executionMode,
            dispatchCount: nextDispatchCount,
            journalSequence: runtimeSequence,
            journalHeadHash: runtimeHead,
          },
          severity: AuditSeverity.HIGH,
          channel: AuditChannel.AGENT,
          agentSessionId: taskSessionId(action.taskId),
          principalType: 'MSAIDIZI',
          principalId: action.task.principalId,
          mandateId: action.task.mandateId ?? undefined,
          initiatedByUserId: action.task.initiatedByUserId ?? undefined,
          taskId: action.taskId,
          stepId: action.stepId,
          deviceId,
        });
        return { request, issued, authorizationExpiresAt, nextDispatchCount };
      });
      if (!claim) continue;
      return {
        kind: 'replay-result',
        action: {
          request: {
            ...claim.request,
            dispatchCount: claim.nextDispatchCount,
            leaseExpiresAt: claim.authorizationExpiresAt.toISOString(),
          },
          compactToken: claim.issued.compactToken,
        },
      };
    }
    return null;
  }

  private async claimExecuteCommand(
    deviceId: string,
    _runtime: Record<string, unknown>,
    authenticatedIdentity?: AuthenticatedDeviceIdentity,
  ): Promise<DeviceCommand | null> {
    if (
      !authenticatedIdentity ||
      !isSha256Hex(authenticatedIdentity.certificateThumbprint) ||
      !isSha256Hex(authenticatedIdentity.publicKeySha256)
    ) {
      return null;
    }
    const staleBefore = new Date(Date.now() - this.config.redeliverySeconds * 1_000);
    const candidates = await this.prisma.msaidiziHostAction.findMany({
      where: {
        deviceId,
        task: { status: { in: [...DISPATCHABLE_TASKS] } },
        OR: [
          { status: MsaidiziHostActionStatus.QUEUED },
          { status: MsaidiziHostActionStatus.DISPATCHED, dispatchedAt: { lte: staleBefore } },
          { status: MsaidiziHostActionStatus.RUNNING, dispatchedAt: { lte: staleBefore } },
        ],
      },
      include: {
        task: {
          include: {
            mandate: true,
            principal: { select: { status: true } },
            events: {
              where: { type: 'task.one_shot_consent_granted' },
              select: { actorType: true, actorId: true, payload: true },
            },
          },
        },
        step: { include: { planVersion: true } },
        lease: true,
      },
      orderBy: { queuedAt: 'asc' },
      take: 20,
    });
    for (const action of candidates) {
      if (isUnavailableHostFileContentCapability(action.capability)) {
        await this.settleInterruptedAction(
          action.id,
          REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
          false,
          false,
          { bytesRead: 0n, bytesWritten: 0n },
          true,
          true,
        );
        continue;
      }
      const firstDispatch = action.status === MsaidiziHostActionStatus.QUEUED;
      const requiresTerminalJournal =
        !firstDispatch &&
        (action.status === MsaidiziHostActionStatus.RUNNING || action.startedAt !== null);
      // A DISPATCHED command whose poll response was lost can have no progress
      // ACK at all. Permit bounded redelivery only while no generation has ever
      // been acknowledged; the action/idempotency key, lease fence, journal
      // predecessor and delivery-session cap below remain unchanged. Once any
      // generation is acknowledged, an ACK from an older generation is never
      // authority to issue the next one.
      const currentDispatchAcknowledged =
        action.acknowledgedDispatchCount === action.dispatchCount && action.acknowledgedAt != null;
      const noDispatchGenerationAcknowledged =
        action.acknowledgedDispatchCount === 0 && action.acknowledgedAt == null;
      if (
        !firstDispatch &&
        !requiresTerminalJournal &&
        !currentDispatchAcknowledged &&
        !noDispatchGenerationAcknowledged
      )
        continue;
      if (
        (firstDispatch && action.task.status !== MsaidiziTaskStatus.RUNNING) ||
        (firstDispatch && action.task.principal.status !== MsaidiziPrincipalStatus.ACTIVE) ||
        action.step.planVersion.version !== action.task.activePlanVersion ||
        !action.task.mandateId ||
        !action.lease ||
        action.leaseId !== action.lease.id ||
        action.leaseFencingToken == null ||
        action.leaseFencingToken !== action.lease.fencingToken ||
        !action.leaseAuthorizationExpiresAt ||
        action.leaseAuthorizationExpiresAt.getTime() <= Date.now() ||
        action.lease.status !== MsaidiziDeviceLeaseStatus.ACTIVE ||
        action.lease.expiresAt.getTime() <= Date.now()
      ) {
        continue;
      }
      // Capture the proven live lease before entering the transactional
      // callback. Prisma relations are nullable in the generated type and
      // TypeScript intentionally does not carry property narrowing across an
      // async closure.
      const lease = action.lease;
      const priorAuthorizationExpiresAt = action.leaseAuthorizationExpiresAt;
      let resolvedInputs: ResolvedStepInputs;
      try {
        resolvedInputs = action.attemptId
          ? await this.resolveHostActionInputs(
              action.taskId,
              action.step.planVersionId,
              action.stepId,
              action.attemptId,
              action.step.arguments,
              action.step.inputBindings,
            )
          : staticStepInputs(
              action.taskId,
              action.step.planVersionId,
              action.stepId,
              `legacy-host-action:${action.id}`,
              action.step.arguments,
            );
      } catch (error) {
        const unknown = action.step.mutation && !firstDispatch;
        await this.settleInterruptedAction(
          action.id,
          error instanceof MsaidiziInputBindingError
            ? error.code
            : 'HOST_INPUT_BINDING_RESOLUTION_FAILED',
          unknown,
          !unknown,
        );
        continue;
      }
      const persistedInputProvenanceSha256 = action.inputProvenanceSha256;
      if (
        action.attemptId &&
        (action.resolvedInputProvenance == null ||
          !persistedInputProvenanceSha256 ||
          !fixedTimeHexEquals(
            jsonSha256(action.resolvedInputProvenance),
            persistedInputProvenanceSha256,
          ) ||
          !fixedTimeHexEquals(resolvedInputs.provenanceSha256, persistedInputProvenanceSha256))
      ) {
        const unknown = action.step.mutation && !firstDispatch;
        await this.settleInterruptedAction(
          action.id,
          'HOST_INPUT_PROVENANCE_MISMATCH',
          unknown,
          !unknown,
        );
        continue;
      }
      if (
        !isMandateValidForAction(
          action.task.mandate,
          action.deviceId,
          action.capability,
          action.capabilityVersion,
          action.effect,
          action.dataClass,
          resolvedInputs.arguments as Prisma.JsonValue,
        )
      ) {
        const unknown = action.step.mutation && action.status !== MsaidiziHostActionStatus.QUEUED;
        await this.settleInterruptedAction(
          action.id,
          'HOST_MANDATE_INVALID_BEFORE_DISPATCH',
          unknown,
          !unknown,
        );
        continue;
      }

      const argumentsJsonUtf8 = stableJson(resolvedInputs.arguments);
      const argumentsSha256 = sha256Hex(argumentsJsonUtf8);
      if (!fixedTimeHexEquals(argumentsSha256, action.argsDigest)) {
        await this.settleInterruptedAction(action.id, 'HOST_ARGUMENT_DIGEST_DRIFT', true, false);
        continue;
      }
      const expectedPreStateSha256 = expectedPreStateDigest(action.expectedPreState);
      if (action.step.mutation && !expectedPreStateSha256) {
        const unknown = !firstDispatch;
        await this.settleInterruptedAction(
          action.id,
          'HOST_EXPECTED_PRE_STATE_INVALID',
          unknown,
          false,
        );
        continue;
      }
      const inputProvenanceSha256 =
        persistedInputProvenanceSha256 ?? jsonSha256(action.step.planVersion.inputs);
      const persistedBudgets = parseActionBudgets(action.budgetSnapshot);
      if (
        !persistedBudgets ||
        (!firstDispatch &&
          BigInt(persistedBudgets.maxExternalEgressBytes) !== action.reservedExternalEgressBytes)
      ) {
        await this.settleInterruptedAction(
          action.id,
          'HOST_BUDGET_SNAPSHOT_INVALID',
          !firstDispatch,
          false,
        );
        continue;
      }
      const preflightConsentGrant = mandateConsentGrantForAction(
        action.task.mandate,
        action.capability,
        action.capabilityVersion,
        action.effect,
        action.dataClass,
        action.consent,
        oneShotConsentGrantedForAction(action.task.events, action.task.initiatedByUserId, action),
      );
      if (
        new Set(['ActiveUser', 'OneShotApproval', 'EmergencyOperator']).has(action.consent) &&
        preflightConsentGrant === null
      ) {
        const unknown = action.step.mutation && !firstDispatch;
        await this.settleInterruptedAction(
          action.id,
          'HOST_CONSENT_GRANT_MISSING',
          unknown,
          !unknown,
        );
        continue;
      }
      const request = {
        actionId: action.actionId,
        taskId: action.taskId,
        planVersionId: action.step.planVersionId,
        stepId: action.stepId,
        deviceId: action.deviceId,
        mandateId: action.task.mandateId,
        capabilityId: action.capability,
        capabilityVersion: action.capabilityVersion,
        argumentsJsonUtf8,
        argumentsSha256,
        expectedPreStateSha256,
        inputProvenanceSha256,
        idempotencyKey: action.idempotencyKey,
        leaseId: lease.id,
        fencingToken: lease.fencingToken.toString(),
      };
      const claim = await this.prisma.$transaction(async (tx) => {
        // The global safety latch takes the principal row before it pauses
        // tasks. Preserve that order here so disable and dispatch cannot
        // deadlock, and hold the shared principal lock through token issuance.
        const principalLocks = await tx.$queryRaw<
          Array<{ id: string; status: MsaidiziPrincipalStatus }>
        >`
          SELECT "id", "status"
          FROM "msaidizi_principals"
          WHERE "id" = ${action.task.principalId}
          FOR SHARE
        `;
        if (
          principalLocks.length !== 1 ||
          principalLocks[0].status !== MsaidiziPrincipalStatus.ACTIVE
        ) {
          return null;
        }

        // The task row serializes host reservations with artifact and other
        // egress flows. The device row serializes heartbeat/manifest generations
        // with distinct action claims.
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${action.taskId} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "msaidizi_devices" WHERE "id" = ${action.deviceId} FOR UPDATE`;
        const mandateLocks = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "msaidizi_mandates"
          WHERE "id" = ${action.task.mandateId!}
          FOR SHARE
        `;
        if (mandateLocks.length !== 1) return null;

        const liveDevice = await tx.msaidiziDevice.findUnique({
          where: { id: action.deviceId },
          select: {
            id: true,
            principalId: true,
            status: true,
            publicKey: true,
            certificateThumbprint: true,
            capabilityManifest: true,
            updatedAt: true,
          },
        });
        if (
          !liveDevice ||
          liveDevice.principalId !== action.task.principalId ||
          liveDevice.status !== MsaidiziDeviceStatus.ACTIVE ||
          typeof liveDevice.certificateThumbprint !== 'string' ||
          !fixedTimeHexEquals(
            liveDevice.certificateThumbprint,
            authenticatedIdentity.certificateThumbprint,
          ) ||
          !fixedTimeHexEquals(
            sha256Hex(normalisePublicKey(liveDevice.publicKey)),
            authenticatedIdentity.publicKeySha256,
          )
        ) {
          return null;
        }

        const liveRuntime = manifestRuntime(liveDevice.capabilityManifest);
        const declaredManifestSha256 = jsonString(
          asJsonObject(liveDevice.capabilityManifest),
          'manifestSha256',
        );
        const runtimeManifestSha256 = liveRuntime
          ? jsonString(liveRuntime, 'capabilityManifestSha256')
          : null;
        let liveDescriptorMatches = false;
        try {
          validateCapabilityManifest(
            liveDevice.capabilityManifest as unknown as CapabilityManifestSnapshotDto,
          );
          const liveDescriptor = findCapability(
            liveDevice.capabilityManifest,
            action.capability,
            action.capabilityVersion,
          );
          liveDescriptorMatches = Boolean(
            liveDescriptor &&
            capabilityEffect(liveDescriptor.effect) === action.effect &&
            capabilityDataClass(liveDescriptor.dataClass) === action.dataClass &&
            capabilityConsent(liveDescriptor.consent) === action.consent &&
            capabilityRecovery(liveDescriptor.recovery) === action.recovery,
          );
        } catch {
          return null;
        }
        if (
          !liveRuntime ||
          !liveDescriptorMatches ||
          liveRuntime.executionEnabled !== true ||
          liveRuntime.killSwitchEngaged === true ||
          liveRuntime.centralLedgerConnected !== true ||
          liveRuntime.manifestMatches !== true ||
          !isSha256Hex(declaredManifestSha256) ||
          !isSha256Hex(runtimeManifestSha256) ||
          !fixedTimeHexEquals(declaredManifestSha256, runtimeManifestSha256)
        ) {
          return null;
        }

        const observedJournalHead = jsonString(liveRuntime, 'journalHeadHash');
        const observedJournalSequence = liveRuntime.journalSequence;
        if (
          !isSha256Hex(observedJournalHead) ||
          typeof observedJournalSequence !== 'number' ||
          !Number.isSafeInteger(observedJournalSequence) ||
          observedJournalSequence < 0
        ) {
          return null;
        }

        const anotherActiveAction = await tx.msaidiziHostAction.findFirst({
          where: {
            deviceId: action.deviceId,
            id: { not: action.id },
            status: {
              in: [MsaidiziHostActionStatus.DISPATCHED, MsaidiziHostActionStatus.RUNNING],
            },
          },
          select: { id: true },
        });
        if (anotherActiveAction) return null;

        const latestAcceptedJournal = await tx.msaidiziHostAction.findFirst({
          where: {
            deviceId: action.deviceId,
            journalAccepted: true,
            journalSequence: { not: null },
            journalHash: { not: null },
          },
          orderBy: [{ journalSequence: 'desc' }, { endedAt: 'desc' }],
          select: {
            journalPrepareSequence: true,
            journalPreparePreviousHash: true,
            journalPrepareHash: true,
            journalSequence: true,
            journalHash: true,
          },
        });
        let expectedJournalPreviousSequence: number;
        let expectedJournalPreviousHash: string;
        if (firstDispatch) {
          if (
            latestAcceptedJournal &&
            !heartbeatMatchesAcceptedJournal(
              observedJournalSequence,
              observedJournalHead,
              latestAcceptedJournal,
            )
          ) {
            return null;
          }
          expectedJournalPreviousSequence =
            latestAcceptedJournal?.journalSequence ?? observedJournalSequence;
          expectedJournalPreviousHash = (
            latestAcceptedJournal?.journalHash ?? observedJournalHead
          ).toUpperCase();
        } else {
          if (
            action.journalExpectedPreviousSequence == null ||
            action.journalPreviousHash == null ||
            (latestAcceptedJournal &&
              (latestAcceptedJournal.journalSequence !== action.journalExpectedPreviousSequence ||
                !fixedTimeHexEquals(
                  latestAcceptedJournal.journalHash!,
                  action.journalPreviousHash,
                ))) ||
            !(requiresTerminalJournal
              ? heartbeatMatchesRunningTerminalJournal(
                  observedJournalSequence,
                  observedJournalHead,
                  action.journalExpectedPreviousSequence,
                  action.journalPreviousHash,
                  action.journalSequence,
                  action.journalHash,
                )
              : heartbeatMatchesActiveActionJournal(
                  observedJournalSequence,
                  observedJournalHead,
                  action.journalExpectedPreviousSequence,
                  action.journalPreviousHash,
                ))
          ) {
            return null;
          }
          expectedJournalPreviousSequence = action.journalExpectedPreviousSequence;
          expectedJournalPreviousHash = action.journalPreviousHash.toUpperCase();
        }

        const authoritativeWallTime = await checkpointTaskWallTimeForAuthorization(
          tx,
          action.taskId,
          DISPATCHABLE_TASKS,
        );
        if (!authoritativeWallTime?.wallTimeCheckpointAt) return null;
        const databaseNow = authoritativeWallTime.wallTimeCheckpointAt;
        if (!freshRuntime(liveRuntime, this.config.leaseTtlSeconds * 2, databaseNow)) return null;

        // A live companion execution is not a failed delivery session. Burning
        // central redelivery credits while it is still running would leave no
        // credit for the eventual durable-result replay after a lost POST. The
        // idle observation must also postdate the last dispatch; a cached zero
        // from before that dispatch proves nothing about the current session.
        const runtimeReceivedAt =
          typeof liveRuntime.receivedAt === 'string'
            ? Date.parse(liveRuntime.receivedAt)
            : Number.NaN;
        const lastExecutionBoundary = Math.max(
          action.dispatchedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
          action.startedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
        );
        if (
          !firstDispatch &&
          (liveRuntime.runningActionCount !== 0 ||
            !action.dispatchedAt ||
            !Number.isFinite(runtimeReceivedAt) ||
            runtimeReceivedAt <= lastExecutionBoundary)
        ) {
          return null;
        }

        const liveTask = await tx.msaidiziTask.findUnique({
          where: { id: action.taskId },
          include: {
            mandate: true,
            principal: { select: { status: true } },
          },
        });
        if (!liveTask) return null;
        const authoritativeTask = { ...liveTask, ...authoritativeWallTime };
        if (
          !firstDispatch &&
          authoritativeTask.reservedExternalEgressBytes < action.reservedExternalEgressBytes
        ) {
          return null;
        }
        // The existing action reservation is already prepaid. Credit only that
        // exact reservation back while recomputing live task headroom, then keep
        // the persisted action envelope as the upper bound for this generation.
        // This neither reserves egress twice nor allows a concurrent reservation
        // to disappear from the hard-ceiling calculation.
        const budgetAuthorityTask = firstDispatch
          ? authoritativeTask
          : {
              ...authoritativeTask,
              reservedExternalEgressBytes:
                authoritativeTask.reservedExternalEgressBytes - action.reservedExternalEgressBytes,
            };
        const remainingBudgets = remainingActionBudgets(budgetAuthorityTask, databaseNow);
        const budgets = remainingBudgets
          ? minimumActionBudgets(persistedBudgets, remainingBudgets)
          : null;
        if (!budgets) return null;
        if (
          !liveTask.mandate ||
          liveTask.mandateId !== action.task.mandateId ||
          liveTask.activePlanVersion !== action.step.planVersion.version ||
          liveTask.principal.status !== MsaidiziPrincipalStatus.ACTIVE ||
          !isMandateValidForAction(
            liveTask.mandate,
            action.deviceId,
            action.capability,
            action.capabilityVersion,
            action.effect,
            action.dataClass,
            action.step.arguments,
            databaseNow,
          )
        ) {
          return null;
        }
        assertMandateBudgets(liveTask.mandate.budgets, budgets);
        const consentGrant = mandateConsentGrantForAction(
          liveTask.mandate,
          action.capability,
          action.capabilityVersion,
          action.effect,
          action.dataClass,
          action.consent,
          oneShotConsentGrantedForAction(action.task.events, action.task.initiatedByUserId, action),
        );
        if (
          new Set(['ActiveUser', 'OneShotApproval', 'EmergencyOperator']).has(action.consent) &&
          consentGrant === null
        ) {
          return null;
        }

        const reservation = BigInt(budgets.maxExternalEgressBytes);
        const nextDispatchCount = firstDispatch ? 1 : action.dispatchCount + 1;
        const taskWallTimeRemainingMs = remainingTaskWallTimeMs(authoritativeTask, databaseNow);
        const taskAuthorizationDeadline = databaseNow.getTime() + Number(taskWallTimeRemainingMs);
        const mandateAuthorizationDeadline = liveTask.mandate.expiresAt?.getTime();
        const existingAuthorizationDeadline = firstDispatch
          ? Number.POSITIVE_INFINITY
          : priorAuthorizationExpiresAt.getTime();
        const authorizationDeadline = Math.min(
          taskAuthorizationDeadline,
          mandateAuthorizationDeadline ?? Number.POSITIVE_INFINITY,
          existingAuthorizationDeadline,
        );
        if (authorizationDeadline <= databaseNow.getTime() + 1_000) return null;
        // The signed authorization remains stable for the task's bounded
        // execution window, while the live database lease still requires a
        // short periodic heartbeat. This lets long-running adapters deliver a
        // terminal result without turning the liveness lease into a two-hour
        // lease.
        const leaseAuthorizationExpiresAt = new Date(authorizationDeadline);
        const leaseHeartbeatExpiresAt = new Date(
          Math.min(
            authorizationDeadline,
            databaseNow.getTime() + this.config.leaseTtlSeconds * 1_000,
          ),
        );
        const brokerPrepaidEgressBytes =
          BigInt(budgets.brokerMaxDeliverySessions) *
          BigInt(budgets.brokerMaxRequestAttemptsPerSession) *
          BigInt(budgets.brokerSerializedResultUpperBoundBytes);
        if (
          brokerPrepaidEgressBytes > reservation ||
          (!firstDispatch &&
            (reservation !== action.reservedExternalEgressBytes ||
              action.brokerMaxDeliverySessions !== budgets.brokerMaxDeliverySessions ||
              action.brokerMaxRequestAttemptsPerSession !==
                budgets.brokerMaxRequestAttemptsPerSession ||
              action.brokerSerializedResultUpperBoundBytes !==
                budgets.brokerSerializedResultUpperBoundBytes ||
              action.dispatchCount >= action.brokerMaxDeliverySessions))
        )
          return null;
        const issued = this.signer.issue({
          executionMode: 'EXECUTE',
          actionId: request.actionId,
          taskId: request.taskId,
          planVersionId: request.planVersionId,
          stepId: request.stepId,
          deviceId: request.deviceId,
          mandateId: request.mandateId,
          capabilityId: request.capabilityId,
          capabilityVersion: request.capabilityVersion,
          argumentsSha256: request.argumentsSha256,
          expectedPreStateSha256: request.expectedPreStateSha256,
          inputProvenanceSha256: request.inputProvenanceSha256,
          idempotencyKey: request.idempotencyKey,
          leaseId: request.leaseId,
          fencingToken: request.fencingToken,
          leaseExpiresAt: leaseAuthorizationExpiresAt,
          dispatchCount: nextDispatchCount,
          consentGrant,
          budgets,
        });
        const actionTokenDigest = sha256Hex(issued.compactToken);
        const allowedTaskStatuses = firstDispatch
          ? [MsaidiziTaskStatus.RUNNING]
          : [...DISPATCHABLE_TASKS];
        const claimed = await tx.msaidiziHostAction.updateMany({
          where: {
            id: action.id,
            leaseId: lease.id,
            leaseFencingToken: lease.fencingToken,
            device: {
              is: {
                id: liveDevice.id,
                principalId: action.task.principalId,
                status: MsaidiziDeviceStatus.ACTIVE,
                updatedAt: liveDevice.updatedAt,
                certificateThumbprint: authenticatedIdentity.certificateThumbprint,
                publicKey: liveDevice.publicKey,
                capabilityManifest: {
                  equals: liveDevice.capabilityManifest as Prisma.InputJsonValue,
                },
              },
            },
            task: {
              status: { in: allowedTaskStatuses },
              principalId: action.task.principalId,
              principal: {
                is: {
                  id: action.task.principalId,
                  status: MsaidiziPrincipalStatus.ACTIVE,
                },
              },
              mandate: {
                is: {
                  id: action.task.mandateId!,
                  version: liveTask.mandate.version,
                  status: MsaidiziMandateStatus.ACTIVE,
                  OR: [{ startsAt: null }, { startsAt: { lte: databaseNow } }],
                  AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: databaseNow } }] }],
                },
              },
            },
            lease: {
              is: {
                status: MsaidiziDeviceLeaseStatus.ACTIVE,
                expiresAt: { gt: databaseNow },
              },
            },
            ...(firstDispatch
              ? {
                  status: MsaidiziHostActionStatus.QUEUED,
                  dispatchCount: 0,
                  brokerMaxDeliverySessions: 0,
                  brokerMaxRequestAttemptsPerSession: 0,
                  brokerSerializedResultUpperBoundBytes: 0,
                }
              : {
                  status: action.status,
                  dispatchedAt: { lte: staleBefore },
                  dispatchCount: action.dispatchCount,
                  ...(requiresTerminalJournal
                    ? {}
                    : {
                        // Bind the exact observed ACK snapshot. For an
                        // ambiguous initial poll this is deliberately 0/null;
                        // a concurrent progress receipt therefore wins the CAS
                        // and prevents this redelivery claim from overwriting
                        // its generation evidence.
                        acknowledgedDispatchCount: action.acknowledgedDispatchCount,
                        acknowledgedAt: action.acknowledgedAt,
                      }),
                  brokerMaxDeliverySessions: action.brokerMaxDeliverySessions,
                  brokerMaxRequestAttemptsPerSession: action.brokerMaxRequestAttemptsPerSession,
                  brokerSerializedResultUpperBoundBytes:
                    action.brokerSerializedResultUpperBoundBytes,
                }),
          },
          data: {
            status: requiresTerminalJournal
              ? MsaidiziHostActionStatus.RUNNING
              : MsaidiziHostActionStatus.DISPATCHED,
            dispatchedAt: databaseNow,
            actionTokenDigest,
            leaseFencingToken: lease.fencingToken,
            leaseAuthorizationExpiresAt,
            journalPreviousHash: expectedJournalPreviousHash,
            journalExpectedPreviousSequence: expectedJournalPreviousSequence,
            budgetSnapshot: budgets as unknown as Prisma.InputJsonValue,
            acknowledgedDispatchCount: 0,
            acknowledgedAt: null,
            ...(requiresTerminalJournal &&
            (action.journalHash == null ||
              (action.journalExpectedPreviousSequence != null &&
                action.journalSequence === action.journalExpectedPreviousSequence + 2 &&
                observedJournalSequence === action.journalExpectedPreviousSequence + 3))
              ? {
                  journalSequence: observedJournalSequence,
                  journalHash: observedJournalHead.toUpperCase(),
                }
              : {}),
            ...(firstDispatch
              ? {
                  reservedExternalEgressBytes: reservation,
                  brokerMaxDeliverySessions: budgets.brokerMaxDeliverySessions,
                  brokerMaxRequestAttemptsPerSession: budgets.brokerMaxRequestAttemptsPerSession,
                  brokerSerializedResultUpperBoundBytes:
                    budgets.brokerSerializedResultUpperBoundBytes,
                  dispatchCount: 1,
                }
              : { dispatchCount: { increment: 1 } }),
          },
        });
        if (claimed.count !== 1) return null;
        await tx.msaidiziHostActionDispatch.create({
          data: {
            hostActionId: action.id,
            dispatchCount: nextDispatchCount,
            actionTokenDigest,
            executionMode: 'EXECUTE',
            tokenId: issued.tokenId,
            tokenIssuedAt: new Date(issued.issuedAt * 1_000),
            tokenExpiresAt: new Date(issued.expiresAt * 1_000),
            leaseId: lease.id,
            leaseFencingToken: lease.fencingToken,
            leaseAuthorizationExpiresAt,
          },
        });
        if (firstDispatch) {
          const reserved = await tx.msaidiziTask.updateMany({
            where: {
              id: action.taskId,
              externalEgressBytes: liveTask.externalEgressBytes,
              reservedExternalEgressBytes: liveTask.reservedExternalEgressBytes,
              maxExternalEgressBytes: liveTask.maxExternalEgressBytes,
            },
            data: {
              reservedExternalEgressBytes: { increment: reservation },
              lastCheckpointAt: databaseNow,
            },
          });
          if (reserved.count !== 1) {
            throw new HostActionPolicyError('HOST_TASK_BUDGET_RESERVATION_RACE');
          }
        }
        const leaseRenewed = await tx.msaidiziDeviceLease.updateMany({
          where: {
            id: lease.id,
            fencingToken: lease.fencingToken,
            status: MsaidiziDeviceLeaseStatus.ACTIVE,
            expiresAt: { gt: databaseNow },
          },
          data: {
            heartbeatAt: databaseNow,
            expiresAt: leaseHeartbeatExpiresAt,
          },
        });
        if (leaseRenewed.count !== 1) {
          throw new HostActionPolicyError('HOST_LEASE_FENCE_CHANGED_BEFORE_DISPATCH');
        }
        await this.event(tx, action.taskId, 'host_action.dispatched', {
          actionId: action.actionId,
          stepId: action.stepId,
          deviceId: action.deviceId,
          tokenId: issued.tokenId,
          tokenExpiresAt: new Date(issued.expiresAt * 1_000).toISOString(),
          leaseId: lease.id,
          fencingToken: lease.fencingToken.toString(),
          leaseExpiresAt: leaseAuthorizationExpiresAt.toISOString(),
          reservedExternalEgressBytes: reservation.toString(),
          brokerMaxDeliverySessions: budgets.brokerMaxDeliverySessions,
          brokerMaxRequestAttemptsPerSession: budgets.brokerMaxRequestAttemptsPerSession,
          brokerSerializedResultUpperBoundBytes: budgets.brokerSerializedResultUpperBoundBytes,
          brokerPrepaidEgressBytes: brokerPrepaidEgressBytes.toString(),
          dispatchCount: nextDispatchCount,
          inputProvenanceSha256,
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_HOST_ACTION_DISPATCHED',
          entityType: 'MsaidiziHostAction',
          entityId: action.actionId,
          userId: action.task.initiatedByUserId ?? undefined,
          companyId: action.task.companyId,
          newValue: {
            capability: action.capability,
            argsDigest: action.argsDigest,
            actionTokenDigest,
            tokenId: issued.tokenId,
            tokenExpiresAt: new Date(issued.expiresAt * 1_000).toISOString(),
            leaseId: lease.id,
            fencingToken: lease.fencingToken.toString(),
            leaseExpiresAt: leaseAuthorizationExpiresAt.toISOString(),
            reservedExternalEgressBytes: reservation.toString(),
            brokerMaxDeliverySessions: budgets.brokerMaxDeliverySessions,
            brokerMaxRequestAttemptsPerSession: budgets.brokerMaxRequestAttemptsPerSession,
            brokerSerializedResultUpperBoundBytes: budgets.brokerSerializedResultUpperBoundBytes,
            brokerPrepaidEgressBytes: brokerPrepaidEgressBytes.toString(),
            dispatchCount: nextDispatchCount,
            inputProvenanceSha256,
          },
          severity: action.step.mutation ? AuditSeverity.HIGH : AuditSeverity.LOW,
          channel: AuditChannel.AGENT,
          agentSessionId: taskSessionId(action.taskId),
          principalType: 'MSAIDIZI',
          principalId: action.task.principalId,
          mandateId: action.task.mandateId ?? undefined,
          initiatedByUserId: action.task.initiatedByUserId ?? undefined,
          taskId: action.taskId,
          stepId: action.stepId,
          deviceId: action.deviceId,
        });
        return { issued, dispatchCount: nextDispatchCount, leaseAuthorizationExpiresAt };
      });
      if (!claim) continue;
      return {
        kind: 'execute',
        action: {
          request: {
            ...request,
            dispatchCount: claim.dispatchCount,
            leaseExpiresAt: claim.leaseAuthorizationExpiresAt.toISOString(),
          },
          compactToken: claim.issued.compactToken,
        },
      };
    }
    return null;
  }

  private async verifyEgressSettlement(
    action: EgressSettlementAction,
    dto: ActionResultDto,
    outcome: string,
    historicalTerminalReceipt = false,
  ): Promise<EgressSettlementVerification> {
    const required = METERED_EGRESS_CAPABILITIES.has(action.capability);
    // Execution may have completed under an earlier signed delivery generation
    // whose terminal POST was lost. Every issued digest is immutable history;
    // accepting one of those exact digests preserves replay without authorizing
    // any unissued token or rebinding independently metered evidence.
    const authorizedDispatch =
      action.dispatches?.find(
        (dispatch) =>
          dispatch.executionMode === 'EXECUTE' &&
          fixedTimeHexEquals(dto.actionTokenSha256, dispatch.actionTokenDigest),
      ) ?? null;
    const actionTokenMatches = authorizedDispatch !== null;
    if (!required) {
      return {
        required: false,
        valid: actionTokenMatches && dto.egressEvidence == null,
        errorCode: actionTokenMatches
          ? dto.egressEvidence == null
            ? null
            : 'EGRESS_RECEIPT_UNEXPECTED'
          : 'EGRESS_ACTION_TOKEN_BINDING_MISMATCH',
        proof: null,
        verified: null,
        authorizedDispatchCount: authorizedDispatch?.dispatchCount ?? null,
      };
    }

    let proof: EgressReceiptProof | null = null;
    try {
      if (!actionTokenMatches || dto.egressEvidence == null) {
        throw new EgressReceiptVerificationError(
          actionTokenMatches
            ? 'EGRESS_RECEIPT_PROOF_MISSING'
            : 'EGRESS_ACTION_TOKEN_BINDING_MISMATCH',
        );
      }
      const parsedProof = parseWireEgressReceiptProof(dto.actionTokenSha256, dto.egressEvidence);
      proof = parsedProof;
      const dispatch = authorizedDispatch!;
      const receiptStartedAt = parsedProof.receipt.startedAtUnixMilliseconds;
      const receiptEndedAt = parsedProof.receipt.endedAtUnixMilliseconds;
      if (
        (dispatch.tokenIssuedAt != null &&
          receiptStartedAt <
            dispatch.tokenIssuedAt.getTime() - EGRESS_MAX_CLOCK_SKEW_MILLISECONDS) ||
        (dispatch.tokenExpiresAt != null &&
          receiptEndedAt >
            dispatch.tokenExpiresAt.getTime() + EGRESS_MAX_CLOCK_SKEW_MILLISECONDS) ||
        receiptEndedAt >
          dispatch.leaseAuthorizationExpiresAt.getTime() + EGRESS_MAX_CLOCK_SKEW_MILLISECONDS
      ) {
        throw new EgressReceiptVerificationError('EGRESS_ACTION_AUTHORIZATION_TIME_MISMATCH');
      }
      const capabilityReservation =
        action.reservedExternalEgressBytes -
        BigInt(action.brokerMaxDeliverySessions) *
          BigInt(action.brokerMaxRequestAttemptsPerSession) *
          BigInt(action.brokerSerializedResultUpperBoundBytes);
      if (
        capabilityReservation < 0n ||
        capabilityReservation > BigInt(Number.MAX_SAFE_INTEGER) ||
        action.device.egressBoundaryKeyId == null ||
        action.device.egressBoundaryPublicKey == null ||
        action.device.egressBoundaryPublicKeySha256 == null ||
        action.device.egressDestinationPolicySha256 == null ||
        action.device.egressExecutionIdentitySha256 == null ||
        action.task.mode !== MsaidiziTaskMode.AUTOPILOT ||
        action.task.mandateId == null
      ) {
        throw new EgressReceiptVerificationError(
          action.task.mandateId == null || action.task.mode !== MsaidiziTaskMode.AUTOPILOT
            ? 'EGRESS_MANDATE_BINDING_MISSING'
            : 'EGRESS_BOUNDARY_ENROLLMENT_INCOMPLETE',
        );
      }

      const prior = await this.prisma.msaidiziHostAction.findMany({
        where: {
          id: { not: action.id },
          deviceId: action.deviceId,
          OR: [
            { egressReceiptId: parsedProof.receipt.receiptId },
            { egressAuthorizationLeaseId: parsedProof.authorization.lease.leaseId },
            { egressBoundaryBootId: parsedProof.authorization.attestation.bootId },
          ],
        },
        select: {
          egressReceiptId: true,
          egressAuthorizationLeaseId: true,
          egressBoundaryBootId: true,
          egressReceiptSequence: true,
        },
      });
      const sameBootSequences = prior
        .filter(
          (item) =>
            item.egressBoundaryBootId === parsedProof.authorization.attestation.bootId &&
            item.egressReceiptSequence != null,
        )
        .map((item) => item.egressReceiptSequence)
        .filter((sequence): sequence is number => sequence != null);
      const lastAcceptedReceiptSequence = sameBootSequences.length
        ? Math.max(...sameBootSequences)
        : undefined;
      const verified = verifyEgressReceiptProof(parsedProof, {
        enrolledBoundarySupervisor: {
          deviceId: action.deviceId,
          keyId: action.device.egressBoundaryKeyId,
          publicKey: action.device.egressBoundaryPublicKey,
          publicKeySpkiSha256: action.device.egressBoundaryPublicKeySha256,
        },
        expected: {
          actionTokenSha256: authorizedDispatch!.actionTokenDigest,
          actionId: action.actionId,
          taskId: action.taskId,
          planVersionId: action.step.planVersionId,
          stepId: action.stepId,
          deviceId: action.deviceId,
          mandateId: action.task.mandateId,
          capabilityId: action.capability,
          capabilityVersion: action.capabilityVersion,
          dispatchCount: authorizedDispatch!.dispatchCount,
          destinationPolicySha256: action.device.egressDestinationPolicySha256,
          executionIdentitySha256: action.device.egressExecutionIdentitySha256,
          argumentsSha256: action.argsDigest.toLowerCase(),
          expectedPreStateSha256:
            expectedPreStateDigest(action.expectedPreState)?.toLowerCase() ?? null,
          idempotencyKeySha256: sha256Hex(action.idempotencyKey).toLowerCase(),
          reservedCapabilityEgressBytes: Number(capabilityReservation),
        },
        nowUnixMilliseconds: Date.now(),
        maxClockSkewMilliseconds: EGRESS_MAX_CLOCK_SKEW_MILLISECONDS,
        maxAttestationLifetimeMilliseconds: EGRESS_MAX_ATTESTATION_LIFETIME_MILLISECONDS,
        maxLeaseLifetimeMilliseconds: EGRESS_MAX_LEASE_LIFETIME_MILLISECONDS,
        timeValidationMode: historicalTerminalReceipt ? 'HISTORICAL_TERMINAL_RECEIPT' : 'CURRENT',
        requireBrowserAttestation: BROWSER_EGRESS_CAPABILITIES.has(action.capability),
        replay: {
          acceptedReceiptIds: new Set(
            prior.flatMap((item) => (item.egressReceiptId ? [item.egressReceiptId] : [])),
          ),
          acceptedLeaseIds: new Set(
            prior.flatMap((item) =>
              item.egressAuthorizationLeaseId ? [item.egressAuthorizationLeaseId] : [],
            ),
          ),
          ...(lastAcceptedReceiptSequence === undefined
            ? {}
            : {
                lastAcceptedBootId: parsedProof.authorization.attestation.bootId,
                lastAcceptedReceiptSequence,
              }),
        },
      });
      const receipt = verified.proof.receipt;
      const completed = receipt.outcome === 'completed';
      if (
        receipt.measuredExternalEgressBytes !== dto.externalEgressBytes ||
        receipt.uncertainExternalEgressBytes !== dto.uncertainExternalEgressBytes ||
        (completed
          ? outcome !== 'Completed' || dto.outcomeUncertain
          : outcome !== 'NeedsAttention' || !dto.outcomeUncertain)
      ) {
        throw new EgressReceiptVerificationError('EGRESS_RESULT_RECEIPT_MISMATCH');
      }

      return {
        required: true,
        valid: true,
        errorCode: null,
        proof: parsedProof,
        verified,
        authorizedDispatchCount: authorizedDispatch!.dispatchCount,
      };
    } catch (error) {
      return {
        required: true,
        valid: false,
        errorCode:
          error instanceof EgressReceiptVerificationError
            ? error.code
            : 'EGRESS_RECEIPT_PROOF_INVALID',
        proof,
        verified: null,
        authorizedDispatchCount: authorizedDispatch?.dispatchCount ?? null,
      };
    }
  }

  private async settleResult(actionId: string, dto: ActionResultDto) {
    const action = await this.prisma.msaidiziHostAction.findUnique({
      where: { id: actionId },
      include: {
        step: true,
        task: true,
        lease: true,
        device: true,
        dispatches: {
          select: {
            actionTokenDigest: true,
            dispatchCount: true,
            executionMode: true,
            tokenIssuedAt: true,
            tokenExpiresAt: true,
            leaseAuthorizationExpiresAt: true,
          },
          orderBy: { dispatchCount: 'asc' },
        },
      },
    });
    if (!action) throw new NotFoundException('Host action not found');
    if (isUnavailableHostFileContentCapability(action.capability)) {
      const active = ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number]);
      this.assertActionLeaseReceipt(
        action,
        dto,
        !active && interruptedActionAcceptsLateEvidence(action),
      );
      await this.settleInterruptedAction(
        action.id,
        REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
        false,
        false,
        { bytesRead: 0n, bytesWritten: 0n },
        true,
        true,
      );
      return {
        accepted: true,
        replay: !active,
        status: MsaidiziHostActionStatus.FAILED,
        taskStatus: MsaidiziTaskStatus.NEEDS_ATTENTION,
      };
    }
    const outcome = actionOutcome(dto.outcome);
    const isActive = ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number]);
    const acceptsLateEvidence = !isActive && interruptedActionAcceptsLateEvidence(action);
    // The public entry point validates before this second read. Revalidate the
    // exact row used for settlement so a concurrent redelivery cannot replace
    // the lease generation between authentication and persistence.
    this.assertActionLeaseReceipt(action, dto, acceptsLateEvidence);
    const egressSettlement = await this.verifyEgressSettlement(
      action,
      dto,
      outcome,
      acceptsLateEvidence && action.step.mutation && outcome !== 'AlreadyRunning',
    );
    const egressEvidenceDigest = egressSettlement.proof
      ? egressEvidenceSha256(egressSettlement.proof)
      : dto.egressEvidence == null
        ? null
        : jsonSha256(dto.egressEvidence);
    const issuedBudgets = parseActionBudgets(action.budgetSnapshot);
    const issuedBudgetValid =
      issuedBudgets !== null &&
      BigInt(issuedBudgets.maxExternalEgressBytes) === action.reservedExternalEgressBytes &&
      issuedBudgets.brokerMaxDeliverySessions === action.brokerMaxDeliverySessions &&
      issuedBudgets.brokerMaxRequestAttemptsPerSession ===
        action.brokerMaxRequestAttemptsPerSession &&
      issuedBudgets.brokerSerializedResultUpperBoundBytes ===
        action.brokerSerializedResultUpperBoundBytes;
    const storedTerminalOutputSha256 = isActive
      ? null
      : jsonString(asJsonObject(action.resultSummary), 'outputSha256');
    const storedReportedOutputJsonSha256 = isActive
      ? null
      : jsonString(asJsonObject(action.resultSummary), 'reportedOutputJsonSha256');
    const digestOnlyReplayOutputBinding =
      !isActive &&
      dto.outputJson == null &&
      dto.isIdempotentReplay &&
      dto.outputSha256 != null &&
      storedTerminalOutputSha256 != null &&
      fixedTimeHexEquals(dto.outputSha256, storedTerminalOutputSha256) &&
      storedReportedOutputJsonSha256 != null &&
      isSha256Hex(storedReportedOutputJsonSha256)
        ? storedReportedOutputJsonSha256
        : undefined;
    const receiptDigest = resultReceiptDigest(
      dto,
      outcome,
      digestOnlyReplayOutputBinding === undefined
        ? undefined
        : { reportedOutputJsonSha256: digestOnlyReplayOutputBinding },
      egressEvidenceDigest,
    );
    const outputValidation = validateActionResultOutput(
      dto,
      action.reservedExternalEgressBytes,
      isActive ? undefined : { expectedOutputSha256: storedTerminalOutputSha256 },
    );
    const localUsage = validateLocalUsage(
      dto,
      issuedBudgets ? BigInt(issuedBudgets.maxLocalBytes) : 0n,
    );
    const journalRuntime =
      action.journalSequence != null && action.journalHash != null
        ? { journalSequence: action.journalSequence, journalHeadHash: action.journalHash }
        : manifestRuntime(action.device.capabilityManifest);
    const journalReceipt = validateJournalReceipt(
      dto,
      outcome,
      journalRuntime,
      isActive || acceptsLateEvidence
        ? action.journalPreviousHash
        : action.journalPreparePreviousHash,
      action.journalExpectedPreviousSequence,
    );
    const brokerContractMatchesAction =
      dto.brokerMaxDeliverySessions === action.brokerMaxDeliverySessions &&
      dto.brokerMaxRequestAttemptsPerSession === action.brokerMaxRequestAttemptsPerSession &&
      dto.brokerSerializedResultUpperBoundBytes === action.brokerSerializedResultUpperBoundBytes;
    const expectedMutationPreState = expectedPreStateDigest(action.expectedPreState);
    const preStateMatchesAction = action.step.mutation
      ? expectedMutationPreState != null &&
        dto.preStateSha256 != null &&
        fixedTimeHexEquals(dto.preStateSha256, expectedMutationPreState)
      : dto.preStateSha256 == null;
    const hostOutputEnvelopeValid = validateHostOutputEnvelope(action, dto.outputJson);
    const hostFileReceiptValid = validateHostFileReadReceipt(action, dto, outcome);
    const localSpeechReceiptValid = validateLocalSpeechReceipt(action, dto, outcome);
    const acceptedPreparedBindingMatchesResult =
      action.journalPrepareSequence == null &&
      action.journalPreparePreviousHash == null &&
      action.journalPrepareHash == null
        ? true
        : action.journalPrepareSequence != null &&
          action.journalPreparePreviousHash != null &&
          action.journalPrepareHash != null &&
          dto.journalPrepareSequence === action.journalPrepareSequence &&
          dto.journalPreparePreviousHash != null &&
          dto.journalPrepareEntryHash != null &&
          fixedTimeHexEquals(dto.journalPreparePreviousHash, action.journalPreparePreviousHash) &&
          fixedTimeHexEquals(dto.journalPrepareEntryHash, action.journalPrepareHash);
    const protocolInvalid =
      !issuedBudgetValid ||
      !outputValidation.valid ||
      !hostOutputEnvelopeValid ||
      !hostFileReceiptValid ||
      !localSpeechReceiptValid ||
      !brokerContractMatchesAction ||
      !preStateMatchesAction ||
      !localUsage.valid ||
      !journalReceipt.valid ||
      !acceptedPreparedBindingMatchesResult ||
      !egressSettlement.valid ||
      (!action.step.mutation && dto.mutationCommitted);

    // A terminal replay receives the same validation as the original result.
    // The immutable prepaid broker charge is part of the core receipt, so a
    // redelivery can neither smuggle different output/provenance nor spend a
    // second time.
    if (!isActive) {
      // Validation above is intentionally rerun even for an exact replay. An
      // invalid first receipt was already classified and conservatively
      // charged; an exact retry only acknowledges that immutable disposition.
      // The receipt binds both the claimed output digest and the independently
      // computed digest of the supplied output bytes.
      if (
        action.journalReceiptDigest === receiptDigest ||
        receiptDigestOf(action.resultSummary) === receiptDigest
      ) {
        return { accepted: true, replay: true, status: action.status };
      }
      const lateEvidenceValid =
        acceptsLateEvidence &&
        !protocolInvalid &&
        action.step.mutation &&
        outcome !== 'AlreadyRunning' &&
        dto.journalPrepareSequence != null &&
        dto.journalPrepareEntryHash != null &&
        dto.journalPreparePreviousHash != null &&
        dto.journalSequence != null &&
        dto.journalEntryHash != null &&
        dto.journalPreviousHash != null &&
        dto.preStateSha256 != null;
      if (lateEvidenceValid) {
        return this.acceptLateTerminalEvidence(
          action,
          dto,
          receiptDigest,
          outcome,
          journalReceipt.reconciliation,
          egressEvidenceDigest,
          egressSettlement.verified?.proof.receipt.outcome ?? null,
          egressSettlement.verified,
        );
      }
      if (acceptsLateEvidence) {
        const rejected = await this.rejectLateEvidence(
          action,
          dto,
          receiptDigest,
          outcome === 'AlreadyRunning'
            ? 'HOST_LATE_EVIDENCE_NONTERMINAL'
            : (egressSettlement.errorCode ?? 'HOST_LATE_EVIDENCE_PROTOCOL_INVALID'),
        );
        if (rejected) {
          throw new ConflictException('The cached late evidence was rejected and quarantined');
        }
        const current = await this.prisma.msaidiziHostAction.findUnique({
          where: { id: action.id },
          select: {
            status: true,
            errorCode: true,
            resultSummary: true,
            journalReceiptDigest: true,
            leaseId: true,
            leaseFencingToken: true,
            leaseAuthorizationExpiresAt: true,
          },
        });
        const acceptedReceiptDigest = current
          ? (current.journalReceiptDigest ?? receiptDigestOf(current.resultSummary))
          : null;
        if (current && acceptedReceiptDigest === receiptDigest) {
          return { accepted: true, replay: true, status: current.status, evidenceOnly: true };
        }
        if (acceptedReceiptDigest != null) {
          await this.markResultConflict(action);
          throw new ConflictException('A conflicting late journal receipt was received');
        }
        if (current?.errorCode === LATE_EVIDENCE_REJECTED_ERROR_CODE) {
          throw new ConflictException('Late evidence for this action was already rejected');
        }
        if (current && !hostActionLeaseGenerationMatchesReceipt(current, dto)) {
          throw new ConflictException('Late evidence belongs to a stale signed lease generation');
        }
        throw new ConflictException(
          'Late-evidence rejection eligibility changed before persistence',
        );
      }
      if (action.errorCode === LATE_EVIDENCE_REJECTED_ERROR_CODE) {
        throw new ConflictException('Late evidence for this action was already rejected');
      }
      await this.markResultConflict(action);
      throw new ConflictException('A conflicting terminal result was received for this action');
    }

    if (outcome === 'AlreadyRunning') {
      if (
        protocolInvalid ||
        egressSettlement.authorizedDispatchCount == null ||
        egressSettlement.authorizedDispatchCount !== action.dispatchCount
      ) {
        await this.settleInterruptedAction(
          action.id,
          'DEVICE_RUNNING_RESULT_INVALID',
          action.step.mutation,
          false,
        );
        throw new ConflictException('The running action result was invalid');
      }
      const running = await this.prisma.msaidiziHostAction.updateMany({
        where: {
          id: action.id,
          status: { in: [...ACTIVE_ACTIONS] },
          leaseId: dto.leaseId,
          leaseFencingToken: BigInt(dto.fencingToken),
          leaseAuthorizationExpiresAt: new Date(dto.leaseExpiresAt),
          dispatchCount: action.dispatchCount,
          journalExpectedPreviousSequence: action.journalExpectedPreviousSequence,
          journalPreviousHash: action.journalPreviousHash,
          journalSequence: action.journalSequence,
          journalHash: action.journalHash,
        },
        data: {
          status: MsaidiziHostActionStatus.RUNNING,
          startedAt: action.startedAt ?? new Date(),
        },
      });
      if (running.count !== 1) {
        const current = await this.prisma.msaidiziHostAction.findUnique({
          where: { id: action.id },
        });
        if (
          current &&
          !ACTIVE_ACTIONS.includes(current.status as (typeof ACTIVE_ACTIONS)[number])
        ) {
          return { accepted: true, replay: true, terminal: true, status: current.status };
        }
        if (current && !hostActionLeaseGenerationMatchesReceipt(current, dto)) {
          throw new ConflictException('Running receipt belongs to a stale signed lease generation');
        }
        throw new ConflictException('Running action generation changed before persistence');
      }
      return { accepted: true, replay: dto.isIdempotentReplay, terminal: false };
    }

    const classification = classifyHostResult({
      outcome,
      mutation: action.step.mutation,
      mutationCommitted: dto.mutationCommitted,
      outcomeUncertain: dto.outcomeUncertain,
      protocolInvalid,
      forceNeedsAttention:
        egressSettlement.required &&
        (!egressSettlement.valid ||
          egressSettlement.verified?.proof.receipt.outcome !== 'completed'),
    });
    const { needsAttention, nextAction, nextStep, nextAttempt } = classification;
    const forceFullEgressCharge =
      protocolInvalid ||
      (egressSettlement.required &&
        egressSettlement.verified?.proof.receipt.outcome !== 'completed');
    const chargedUsage = forceFullEgressCharge
      ? {
          capabilityExternalEgressBytes: 0n,
          brokerExternalEgressBytes: 0n,
          uncertainExternalEgressBytes: action.reservedExternalEgressBytes,
          totalExternalEgressBytes: action.reservedExternalEgressBytes,
        }
      : outputValidation;
    let persistedHostObservation: PersistedHostObservation | null = null;
    if (!protocolInvalid && dto.outputJson != null) {
      try {
        persistedHostObservation = await this.persistHostResultObservation(
          action,
          dto.outputJson,
          localUsage,
          true,
        );
      } catch (error) {
        this.logger.error(
          `Could not persist governed host observation for ${action.id}: ${(error as Error).message}`,
        );
        await this.settleInterruptedAction(
          action.id,
          'HOST_OBSERVATION_ACCOUNTING_FAILED',
          true,
          false,
          { bytesRead: 0n, bytesWritten: 0n },
          true,
        );
        return {
          accepted: true,
          replay: false,
          status: MsaidiziHostActionStatus.UNKNOWN,
        };
      }
    }
    const settlementLocalUsage = persistedHostObservation?.artifact?.localIoAccounted
      ? { bytesRead: 0n, bytesWritten: 0n }
      : localUsage;
    const now = new Date();
    const summary: Prisma.InputJsonObject = {
      receiptDigest,
      actionTokenSha256: dto.actionTokenSha256.toLowerCase(),
      egressEvidenceSha256: egressEvidenceDigest,
      egressReceiptOutcome: egressSettlement.verified?.proof.receipt.outcome ?? null,
      egressReservationDnsAnswerSetSha256:
        egressSettlement.verified?.reservationDnsAnswerSetSha256 ?? null,
      egressConnectionDnsAnswerSetSha256:
        egressSettlement.verified?.connectionDnsAnswerSetSha256 ?? null,
      egressSelectedAddressSha256: egressSettlement.verified?.selectedAddressSha256 ?? null,
      outcome,
      outputSha256: outputValidation.outputSha256,
      reportedOutputJsonSha256: dto.outputJson == null ? null : sha256Hex(dto.outputJson),
      outputBytes: Number(outputValidation.outputBytes),
      minimumBrokerPayloadBytes: outputValidation.minimumBrokerPayloadBytes.toString(),
      reservedExternalEgressBytes: action.reservedExternalEgressBytes.toString(),
      brokerMaxDeliverySessions: action.brokerMaxDeliverySessions,
      brokerMaxRequestAttemptsPerSession: action.brokerMaxRequestAttemptsPerSession,
      brokerSerializedResultUpperBoundBytes: action.brokerSerializedResultUpperBoundBytes,
      dispatchCount: egressSettlement.authorizedDispatchCount ?? action.dispatchCount,
      capabilityExternalEgressBytes: chargedUsage.capabilityExternalEgressBytes.toString(),
      brokerExternalEgressBytes: chargedUsage.brokerExternalEgressBytes.toString(),
      uncertainExternalEgressBytes: chargedUsage.uncertainExternalEgressBytes.toString(),
      totalExternalEgressBytes: chargedUsage.totalExternalEgressBytes.toString(),
      localBytesRead: localUsage.bytesRead.toString(),
      localBytesWritten: localUsage.bytesWritten.toString(),
      mutationCommitted: dto.mutationCommitted,
      outcomeUncertain: dto.outcomeUncertain,
      isIdempotentReplay: dto.isIdempotentReplay,
      provenanceCount: dto.provenance.length,
      provenance: dto.provenance.map((item) => ({
        sourceType: item.sourceType,
        sourceIdentifierHash: item.sourceIdentifierHash.toUpperCase(),
        contentSha256: item.contentSha256.toUpperCase(),
        trust: item.trust,
        observedAt: item.observedAt,
      })),
      ...(persistedHostObservation ? { observation: persistedHostObservation.observation } : {}),
      ...(dto.journalPrepareSequence ? { journalPrepareSequence: dto.journalPrepareSequence } : {}),
      ...(dto.journalPrepareEntryHash
        ? { journalPrepareEntryHash: dto.journalPrepareEntryHash.toUpperCase() }
        : {}),
      ...(dto.journalPreparePreviousHash
        ? { journalPreparePreviousHash: dto.journalPreparePreviousHash.toUpperCase() }
        : {}),
      ...(dto.journalRecoveryPreparedSequence
        ? { journalRecoveryPreparedSequence: dto.journalRecoveryPreparedSequence }
        : {}),
      ...(dto.journalRecoveryPreparedEntryHash
        ? {
            journalRecoveryPreparedEntryHash: dto.journalRecoveryPreparedEntryHash.toUpperCase(),
          }
        : {}),
      ...(dto.journalRecoveryPreparedPreviousHash
        ? {
            journalRecoveryPreparedPreviousHash:
              dto.journalRecoveryPreparedPreviousHash.toUpperCase(),
          }
        : {}),
      ...(dto.journalSequence ? { journalSequence: dto.journalSequence } : {}),
      ...(dto.journalEntryHash ? { journalEntryHash: dto.journalEntryHash.toUpperCase() } : {}),
      ...(dto.journalPreviousHash
        ? { journalPreviousHash: dto.journalPreviousHash.toUpperCase() }
        : {}),
      ...(dto.preStateSha256 ? { preStateSha256: dto.preStateSha256.toUpperCase() } : {}),
      ...(dto.recoveryProvenanceSha256
        ? { recoveryProvenanceSha256: dto.recoveryProvenanceSha256.toUpperCase() }
        : {}),
      ...(dto.recoveryHandleSha256
        ? { recoveryHandleSha256: dto.recoveryHandleSha256.toUpperCase() }
        : {}),
      journalReconciliation: journalReceipt.reconciliation,
    };
    const acceptedRecoveryCheckpoint =
      !protocolInvalid &&
      dto.journalRecoveryPreparedSequence != null &&
      dto.journalRecoveryPreparedEntryHash != null &&
      dto.journalRecoveryPreparedPreviousHash != null;
    const acceptedRecoveryBinding =
      acceptedRecoveryCheckpoint &&
      action.step.mutation &&
      expectedMutationPreState != null &&
      dto.recoveryProvenanceSha256 != null &&
      dto.recoveryHandleSha256 != null;
    const settlementErrorCode =
      egressSettlement.required && !egressSettlement.valid
        ? (egressSettlement.errorCode ?? 'EGRESS_RECEIPT_PROOF_INVALID')
        : protocolInvalid
          ? 'DEVICE_RESULT_INVALID'
          : (dto.errorCode ?? undefined);
    const auditSummary = hostResultAuditSummary(action.capability, summary);
    const preparedArtifact = persistedHostObservation?.preparedArtifact;

    let settled: boolean;
    let transactionCommitted = false;
    let artifactCommitFailed = false;
    try {
      try {
        settled = await this.prisma.$transaction(async (tx) => {
          const won = await tx.msaidiziHostAction.updateMany({
            where: {
              id: action.id,
              status: { in: [...ACTIVE_ACTIONS] },
              reservedExternalEgressBytes: action.reservedExternalEgressBytes,
              leaseId: dto.leaseId,
              leaseFencingToken: BigInt(dto.fencingToken),
              leaseAuthorizationExpiresAt: new Date(dto.leaseExpiresAt),
              dispatchCount: action.dispatchCount,
              journalExpectedPreviousSequence: action.journalExpectedPreviousSequence,
              journalPreviousHash: action.journalPreviousHash,
              journalPrepareSequence: action.journalPrepareSequence,
              journalPreparePreviousHash: action.journalPreparePreviousHash,
              journalPrepareHash: action.journalPrepareHash,
              journalSequence: action.journalSequence,
              journalHash: action.journalHash,
            },
            data: {
              status: nextAction,
              uncertainOutcome: needsAttention,
              resultSummary: summary,
              errorCode: settlementErrorCode,
              journalPrepareSequence: dto.journalPrepareSequence,
              journalPreparePreviousHash: dto.journalPreparePreviousHash?.toUpperCase(),
              journalPrepareHash: dto.journalPrepareEntryHash?.toUpperCase(),
              ...(acceptedRecoveryCheckpoint
                ? {
                    journalRecoveryPreparedSequence: dto.journalRecoveryPreparedSequence,
                    journalRecoveryPreparedPreviousHash:
                      dto.journalRecoveryPreparedPreviousHash!.toUpperCase(),
                    journalRecoveryPreparedHash:
                      dto.journalRecoveryPreparedEntryHash!.toUpperCase(),
                  }
                : {}),
              journalSequence: dto.journalSequence,
              journalPreviousHash: dto.journalPreviousHash?.toUpperCase(),
              journalHash: dto.journalEntryHash?.toUpperCase(),
              journalAccepted: !protocolInvalid,
              capabilityExternalEgressBytes: chargedUsage.capabilityExternalEgressBytes,
              brokerExternalEgressBytes: chargedUsage.brokerExternalEgressBytes,
              uncertainExternalEgressBytes: chargedUsage.uncertainExternalEgressBytes,
              ...(egressSettlement.verified
                ? {
                    egressEvidenceSha256: egressSettlement.verified.egressEvidenceSha256,
                    egressReceiptId: egressSettlement.verified.proof.receipt.receiptId,
                    egressAuthorizationLeaseId:
                      egressSettlement.verified.proof.authorization.lease.leaseId,
                    egressBoundaryBootId:
                      egressSettlement.verified.proof.authorization.attestation.bootId,
                    egressReceiptSequence: egressSettlement.verified.proof.receipt.sequence,
                    egressReservationDnsAnswerSetSha256:
                      egressSettlement.verified.reservationDnsAnswerSetSha256,
                    egressConnectionDnsAnswerSetSha256:
                      egressSettlement.verified.connectionDnsAnswerSetSha256,
                    egressSelectedAddressSha256: egressSettlement.verified.selectedAddressSha256,
                  }
                : {}),
              endedAt: now,
            },
          });
          if (won.count !== 1) return false;
          if (dto.journalSequence != null) {
            // The terminal record advances the device's local append-only
            // chain beyond the last centrally reconciled head. Revoke exact
            // dispatch authorization in the same transaction that accepts the
            // receipt; a later reconciliation must explicitly restore it.
            await tx.$executeRaw`
              UPDATE "msaidizi_device_journal_heads"
              SET "exactAcknowledgedAt" = NULL
              WHERE "deviceId" = ${action.deviceId}
                AND "exactAcknowledgedAt" IS NOT NULL
            `;
          }
          if (preparedArtifact) {
            try {
              await this.artifacts!.commitPreparedToolObservation(tx, preparedArtifact);
            } catch (error) {
              artifactCommitFailed = true;
              throw error;
            }
          }
          const latestAttempt = await tx.msaidiziToolAttempt.findFirst({
            where: { taskId: action.taskId, stepId: action.stepId },
            orderBy: { attemptNumber: 'desc' },
            select: { id: true },
          });
          if (latestAttempt) {
            await tx.msaidiziToolAttempt.update({
              where: { id: latestAttempt.id },
              data: {
                status: nextAttempt,
                uncertainOutcome: needsAttention,
                resultSummary: summary,
                errorCode: settlementErrorCode,
                endedAt: now,
              },
            });
          }
          await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${action.taskId} FOR UPDATE`;
          const liveTask = await tx.msaidiziTask.findUnique({
            where: { id: action.taskId },
            select: {
              bytesRead: true,
              bytesWritten: true,
              maxLocalBytes: true,
              reservedExternalEgressBytes: true,
            },
          });
          if (!liveTask) throw new HostActionPolicyError('HOST_TASK_ACCOUNTING_UNAVAILABLE');
          if (liveTask.reservedExternalEgressBytes < action.reservedExternalEgressBytes) {
            throw new HostActionPolicyError('HOST_TASK_BUDGET_SETTLEMENT_RACE');
          }
          if (
            liveTask.bytesRead +
              liveTask.bytesWritten +
              settlementLocalUsage.bytesRead +
              settlementLocalUsage.bytesWritten >
            liveTask.maxLocalBytes
          ) {
            throw new HostActionPolicyError('HOST_TASK_LOCAL_IO_BUDGET_EXHAUSTED');
          }
          const liveStep = await tx.msaidiziTaskStep.findUnique({
            where: { id: action.stepId },
            select: {
              id: true,
              taskId: true,
              budgets: true,
              bytesRead: true,
              bytesWritten: true,
              localIoAccountingValid: true,
            },
          });
          if (!liveStep) throw new HostActionPolicyError('HOST_STEP_ACCOUNTING_UNAVAILABLE');
          const stepIo = stepLocalIoState(liveStep);
          if (!stepIo.ok) throw new HostActionPolicyError(stepIo.code);
          if (
            stepIo.remaining !== null &&
            settlementLocalUsage.bytesRead + settlementLocalUsage.bytesWritten > stepIo.remaining
          ) {
            throw new HostActionPolicyError('HOST_STEP_LOCAL_IO_BUDGET_EXHAUSTED');
          }
          const stepSettled = await tx.msaidiziTaskStep.updateMany({
            where: {
              id: action.stepId,
              status: { in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING] },
              localIoAccountingValid: true,
              bytesRead: liveStep.bytesRead,
              bytesWritten: liveStep.bytesWritten,
            },
            data: {
              status: nextStep,
              bytesRead: { increment: settlementLocalUsage.bytesRead },
              bytesWritten: { increment: settlementLocalUsage.bytesWritten },
              checkpointedAt: now,
              endedAt: now,
            },
          });
          if (stepSettled.count !== 1) {
            throw new HostActionPolicyError('HOST_STEP_BUDGET_SETTLEMENT_RACE');
          }
          const budgetSettled = await tx.msaidiziTask.updateMany({
            where: {
              id: action.taskId,
              bytesRead: liveTask.bytesRead,
              bytesWritten: liveTask.bytesWritten,
              reservedExternalEgressBytes: liveTask.reservedExternalEgressBytes,
            },
            data: {
              reservedExternalEgressBytes: { decrement: action.reservedExternalEgressBytes },
              externalEgressBytes: { increment: chargedUsage.totalExternalEgressBytes },
              bytesRead: { increment: settlementLocalUsage.bytesRead },
              bytesWritten: { increment: settlementLocalUsage.bytesWritten },
              lastCheckpointAt: now,
            },
          });
          if (budgetSettled.count !== 1) {
            throw new HostActionPolicyError('HOST_TASK_BUDGET_SETTLEMENT_RACE');
          }
          if (needsAttention) {
            const taskWon = await tx.msaidiziTask.updateMany({
              where: {
                id: action.taskId,
                status: {
                  in: [
                    MsaidiziTaskStatus.RUNNING,
                    MsaidiziTaskStatus.PAUSING,
                    MsaidiziTaskStatus.CANCELLING,
                  ],
                },
              },
              data: {
                status: MsaidiziTaskStatus.NEEDS_ATTENTION,
                failureCode: egressSettlement.required
                  ? 'UNKNOWN_HOST_EXTERNAL_OUTCOME'
                  : 'UNKNOWN_HOST_MUTATION_OUTCOME',
                statusDetail: protocolInvalid
                  ? egressSettlement.required
                    ? 'The device returned missing, invalid, replayed, or mismatched signed egress evidence'
                    : 'The device returned an invalid result after a host mutation'
                  : egressSettlement.required
                    ? 'The signed external action did not attest deterministic completion'
                    : 'The host mutation outcome is uncertain and requires reconciliation',
                lastCheckpointAt: now,
                endedAt: now,
                stateVersion: { increment: 1 },
              },
            });
            if (taskWon.count === 1) {
              await this.notifications?.notifyMsaidiziTaskTerminal(
                tx,
                action.taskId,
                MsaidiziTaskStatus.NEEDS_ATTENTION,
              );
            }
            await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
              kind: 'UNKNOWN_ACTION',
              deviceId: action.deviceId,
              taskId: action.taskId,
              actionId: action.actionId,
            });
          }
          if (action.leaseId) {
            await tx.msaidiziDeviceLease.updateMany({
              where: {
                id: action.leaseId,
                ...(action.leaseFencingToken != null
                  ? { fencingToken: action.leaseFencingToken }
                  : {}),
                status: MsaidiziDeviceLeaseStatus.ACTIVE,
              },
              data: { status: MsaidiziDeviceLeaseStatus.RELEASED, releasedAt: now },
            });
          }
          const settlementEvent = await this.event(
            tx,
            action.taskId,
            needsAttention ? 'host_action.outcome_unknown' : 'host_action.settled',
            {
              actionId: action.actionId,
              stepId: action.stepId,
              deviceId: action.deviceId,
              outcome,
              status: nextAction,
              receiptDigest,
              mutationCommitted: dto.mutationCommitted,
              outcomeUncertain: dto.outcomeUncertain,
              outputSha256: outputValidation.outputSha256,
              preStateSha256: dto.preStateSha256,
              recoveryProvenanceSha256: dto.recoveryProvenanceSha256,
              recoveryHandleSha256: dto.recoveryHandleSha256,
              localBytesRead: localUsage.bytesRead.toString(),
              localBytesWritten: localUsage.bytesWritten.toString(),
              reservedExternalEgressBytes: action.reservedExternalEgressBytes.toString(),
              capabilityExternalEgressBytes: chargedUsage.capabilityExternalEgressBytes.toString(),
              brokerExternalEgressBytes: chargedUsage.brokerExternalEgressBytes.toString(),
              brokerMaxDeliverySessions: action.brokerMaxDeliverySessions,
              brokerMaxRequestAttemptsPerSession: action.brokerMaxRequestAttemptsPerSession,
              brokerSerializedResultUpperBoundBytes: action.brokerSerializedResultUpperBoundBytes,
              dispatchCount: egressSettlement.authorizedDispatchCount ?? action.dispatchCount,
              uncertainExternalEgressBytes: chargedUsage.uncertainExternalEgressBytes.toString(),
              totalExternalEgressBytes: chargedUsage.totalExternalEgressBytes.toString(),
              journalPrepareSequence: dto.journalPrepareSequence,
              journalPrepareEntryHash: dto.journalPrepareEntryHash,
              journalPreparePreviousHash: dto.journalPreparePreviousHash,
              journalSequence: dto.journalSequence,
              journalEntryHash: dto.journalEntryHash,
              journalPreviousHash: dto.journalPreviousHash,
              journalRecoveryPreparedSequence: dto.journalRecoveryPreparedSequence,
              journalRecoveryPreparedEntryHash: dto.journalRecoveryPreparedEntryHash,
              journalRecoveryPreparedPreviousHash: dto.journalRecoveryPreparedPreviousHash,
              journalReconciliation: journalReceipt.reconciliation,
              egressEvidenceSha256: egressEvidenceDigest,
              egressReceiptOutcome: egressSettlement.verified?.proof.receipt.outcome ?? null,
              egressReservationDnsAnswerSetSha256:
                egressSettlement.verified?.reservationDnsAnswerSetSha256 ?? null,
              egressConnectionDnsAnswerSetSha256:
                egressSettlement.verified?.connectionDnsAnswerSetSha256 ?? null,
              egressSelectedAddressSha256: egressSettlement.verified?.selectedAddressSha256 ?? null,
              ...(persistedHostObservation?.artifact
                ? { artifact: persistedHostObservation.artifact }
                : {}),
            },
          );
          if (acceptedRecoveryCheckpoint) {
            const evidenceLinked = await tx.msaidiziHostAction.updateMany({
              where: {
                id: action.id,
                status: nextAction,
                journalAccepted: true,
                journalReceiptDigest: null,
                journalEvidenceEventCursor: null,
                journalEvidenceAcceptedAt: null,
              },
              data: {
                journalReceiptDigest: receiptDigest,
                journalEvidenceEventCursor: settlementEvent.cursor,
                journalEvidenceAcceptedAt: now,
                ...(acceptedRecoveryBinding
                  ? {
                      recoveryRecordSha256: dto.recoveryProvenanceSha256!.toLowerCase(),
                      expectedRestoredStateSha256: expectedMutationPreState!.toLowerCase(),
                    }
                  : {}),
              },
            });
            if (evidenceLinked.count !== 1) {
              throw new HostActionPolicyError('HOST_JOURNAL_EVIDENCE_LINK_RACE');
            }
          }
          await this.audit.logStrictInTransaction(tx, {
            action: needsAttention
              ? 'MSAIDIZI_HOST_ACTION_OUTCOME_UNKNOWN'
              : 'MSAIDIZI_HOST_ACTION_SETTLED',
            entityType: 'MsaidiziHostAction',
            entityId: action.actionId,
            userId: action.task.initiatedByUserId ?? undefined,
            companyId: action.task.companyId,
            newValue: auditSummary,
            severity: needsAttention ? AuditSeverity.CRITICAL : AuditSeverity.LOW,
            channel: AuditChannel.AGENT,
            agentSessionId: taskSessionId(action.taskId),
            principalType: 'MSAIDIZI',
            principalId: action.task.principalId,
            mandateId: action.task.mandateId ?? undefined,
            initiatedByUserId: action.task.initiatedByUserId ?? undefined,
            taskId: action.taskId,
            stepId: action.stepId,
            deviceId: action.deviceId,
          });
          return true;
        });
        transactionCommitted = settled;
      } finally {
        if (preparedArtifact) {
          await this.artifacts!.finishPreparedToolObservation(
            preparedArtifact,
            transactionCommitted,
          );
        }
      }
    } catch (error) {
      if (artifactCommitFailed) {
        await this.settleInterruptedAction(
          action.id,
          'HOST_OBSERVATION_ACCOUNTING_FAILED',
          true,
          false,
          { bytesRead: 0n, bytesWritten: 0n },
          true,
        );
        return {
          accepted: true,
          replay: false,
          status: MsaidiziHostActionStatus.UNKNOWN,
        };
      }
      if (
        egressSettlement.verified &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        await this.settleInterruptedAction(action.id, 'EGRESS_RECEIPT_REPLAY_RACE', true, false);
        return {
          accepted: true,
          replay: false,
          status: MsaidiziHostActionStatus.UNKNOWN,
        };
      }
      if (
        error instanceof HostActionPolicyError &&
        (error.code.includes('LOCAL_IO') || error.code.includes('ACCOUNTING'))
      ) {
        await this.settleInterruptedAction(
          action.id,
          error.code,
          true,
          false,
          settlementLocalUsage,
        );
        return {
          accepted: true,
          replay: false,
          status: MsaidiziHostActionStatus.UNKNOWN,
        };
      }
      throw error;
    }

    if (!settled) {
      const current = await this.prisma.msaidiziHostAction.findUnique({
        where: { id: action.id },
      });
      const acceptedReceiptDigest = current
        ? (current.journalReceiptDigest ?? receiptDigestOf(current.resultSummary))
        : null;
      if (current && acceptedReceiptDigest === receiptDigest) {
        return { accepted: true, replay: true, status: current.status };
      }
      if (acceptedReceiptDigest != null) {
        await this.markResultConflict(action);
        throw new ConflictException('A conflicting terminal result was received for this action');
      }
      if (current && !hostActionLeaseGenerationMatchesReceipt(current, dto)) {
        throw new ConflictException('Action receipt belongs to a stale signed lease generation');
      }
      throw new ConflictException('Action settlement eligibility changed before persistence');
    }
    return { accepted: true, replay: dto.isIdempotentReplay, status: nextAction };
  }

  private async rejectLateEvidence(
    action: {
      id: string;
      actionId: string;
      taskId: string;
      stepId: string;
      deviceId: string;
      dispatchCount: number;
      journalExpectedPreviousSequence: number | null;
      journalPreviousHash: string | null;
      journalSequence: number | null;
      journalHash: string | null;
      errorCode: string | null;
      resultSummary: Prisma.JsonValue | null;
      task: {
        initiatedByUserId: string | null;
        companyId: string | null;
        principalId: string;
        mandateId: string | null;
      };
    },
    dto: ActionResultDto,
    receiptDigest: string,
    rejectionCode: string,
  ): Promise<boolean> {
    const now = new Date();
    const summary = persistedJsonObject({
      ...asJsonObject(action.resultSummary ?? {}),
      lateEvidenceRejectedAt: now.toISOString(),
      lateEvidenceRejectionCode: rejectionCode,
      rejectedReceiptDigest: receiptDigest,
    });
    return this.prisma.$transaction(async (tx) => {
      const rejected = await tx.msaidiziHostAction.updateMany({
        where: {
          id: action.id,
          status: MsaidiziHostActionStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: action.errorCode,
          journalAccepted: false,
          journalReceiptDigest: null,
          journalEvidenceEventCursor: null,
          lateEvidenceAcceptedAt: null,
          leaseId: dto.leaseId,
          leaseFencingToken: BigInt(dto.fencingToken),
          leaseAuthorizationExpiresAt: new Date(dto.leaseExpiresAt),
          dispatchCount: action.dispatchCount,
          journalExpectedPreviousSequence: action.journalExpectedPreviousSequence,
          journalPreviousHash: action.journalPreviousHash,
          journalSequence: action.journalSequence,
          journalHash: action.journalHash,
        },
        data: {
          errorCode: LATE_EVIDENCE_REJECTED_ERROR_CODE,
          resultSummary: summary,
        },
      });
      if (rejected.count !== 1) return false;
      await tx.msaidiziDeviceLease.updateMany({
        where: {
          id: dto.leaseId,
          deviceId: action.deviceId,
          taskId: action.taskId,
          stepId: action.stepId,
          fencingToken: BigInt(dto.fencingToken),
          status: MsaidiziDeviceLeaseStatus.ACTIVE,
        },
        data: { status: MsaidiziDeviceLeaseStatus.RELEASED, releasedAt: now },
      });
      await this.event(tx, action.taskId, 'host_action.late_evidence_rejected', {
        actionId: action.actionId,
        stepId: action.stepId,
        deviceId: action.deviceId,
        rejectionCode,
        receiptDigest,
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MSAIDIZI_HOST_ACTION_LATE_EVIDENCE_REJECTED',
        entityType: 'MsaidiziHostAction',
        entityId: action.actionId,
        userId: action.task.initiatedByUserId ?? undefined,
        companyId: action.task.companyId,
        newValue: summary,
        severity: AuditSeverity.CRITICAL,
        channel: AuditChannel.AGENT,
        agentSessionId: taskSessionId(action.taskId),
        principalType: 'MSAIDIZI',
        principalId: action.task.principalId,
        mandateId: action.task.mandateId ?? undefined,
        initiatedByUserId: action.task.initiatedByUserId ?? undefined,
        taskId: action.taskId,
        stepId: action.stepId,
        deviceId: action.deviceId,
      });
      await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
        kind: 'UNKNOWN_ACTION',
        deviceId: action.deviceId,
        taskId: action.taskId,
        actionId: `${action.actionId}-LATE-EVIDENCE-REJECTED`,
      });
      return true;
    });
  }

  /**
   * Attach a device's durable RecoveryPrepared proof after the lease sweeper
   * already conservatively terminalized the action. This is evidence transport
   * only: it never changes task status, accounting, budgets, or retry state.
   * The exact replay transport lease is released after the evidence is linked.
   */
  private async acceptLateTerminalEvidence(
    action: {
      id: string;
      actionId: string;
      taskId: string;
      stepId: string;
      deviceId: string;
      dispatchCount: number;
      journalExpectedPreviousSequence: number | null;
      journalPreviousHash: string | null;
      journalSequence: number | null;
      journalHash: string | null;
      errorCode: string | null;
      resultSummary: Prisma.JsonValue | null;
      task: {
        initiatedByUserId: string | null;
        companyId: string | null;
        principalId: string;
        mandateId: string | null;
      };
    },
    dto: ActionResultDto,
    receiptDigest: string,
    outcome: string,
    journalReconciliation: string,
    egressEvidenceDigest: string | null,
    egressReceiptOutcome: string | null,
    verifiedEgressReceipt: VerifiedEgressReceiptProof | null,
  ) {
    const now = new Date();
    const acceptedRecoveryBinding =
      dto.journalRecoveryPreparedSequence != null &&
      dto.journalRecoveryPreparedEntryHash != null &&
      dto.journalRecoveryPreparedPreviousHash != null &&
      dto.recoveryProvenanceSha256 != null &&
      dto.recoveryHandleSha256 != null;
    const evidencePayload = persistedJsonObject({
      actionId: action.actionId,
      taskId: action.taskId,
      stepId: action.stepId,
      deviceId: action.deviceId,
      sourceInterruptionReason: action.errorCode,
      receiptDigest,
      actionTokenSha256: dto.actionTokenSha256.toLowerCase(),
      egressEvidenceSha256: egressEvidenceDigest,
      egressReceiptOutcome,
      egressReceiptId: verifiedEgressReceipt?.proof.receipt.receiptId ?? null,
      egressAuthorizationLeaseId: verifiedEgressReceipt?.proof.authorization.lease.leaseId ?? null,
      egressBoundaryBootId: verifiedEgressReceipt?.proof.authorization.attestation.bootId ?? null,
      egressReceiptSequence: verifiedEgressReceipt?.proof.receipt.sequence ?? null,
      egressReservationDnsAnswerSetSha256:
        verifiedEgressReceipt?.reservationDnsAnswerSetSha256 ?? null,
      egressConnectionDnsAnswerSetSha256:
        verifiedEgressReceipt?.connectionDnsAnswerSetSha256 ?? null,
      egressSelectedAddressSha256: verifiedEgressReceipt?.selectedAddressSha256 ?? null,
      outcome,
      outputSha256: dto.outputSha256?.toUpperCase() ?? null,
      reportedOutputJsonSha256: dto.outputJson == null ? null : sha256Hex(dto.outputJson),
      mutationCommitted: dto.mutationCommitted,
      outcomeUncertain: dto.outcomeUncertain,
      errorCode: dto.errorCode ?? null,
      isIdempotentReplay: dto.isIdempotentReplay,
      preStateSha256: dto.preStateSha256!.toUpperCase(),
      ...(dto.recoveryProvenanceSha256
        ? { recoveryProvenanceSha256: dto.recoveryProvenanceSha256.toUpperCase() }
        : {}),
      ...(dto.recoveryHandleSha256
        ? { recoveryHandleSha256: dto.recoveryHandleSha256.toUpperCase() }
        : {}),
      journalPrepareSequence: dto.journalPrepareSequence!,
      journalPreparePreviousHash: dto.journalPreparePreviousHash!.toUpperCase(),
      journalPrepareEntryHash: dto.journalPrepareEntryHash!.toUpperCase(),
      ...(dto.journalRecoveryPreparedSequence != null
        ? {
            journalRecoveryPreparedSequence: dto.journalRecoveryPreparedSequence,
            journalRecoveryPreparedPreviousHash:
              dto.journalRecoveryPreparedPreviousHash!.toUpperCase(),
            journalRecoveryPreparedEntryHash: dto.journalRecoveryPreparedEntryHash!.toUpperCase(),
          }
        : {}),
      journalSequence: dto.journalSequence!,
      journalPreviousHash: dto.journalPreviousHash!.toUpperCase(),
      journalEntryHash: dto.journalEntryHash!.toUpperCase(),
      journalReconciliation,
      brokerMaxDeliverySessions: dto.brokerMaxDeliverySessions,
      brokerMaxRequestAttemptsPerSession: dto.brokerMaxRequestAttemptsPerSession,
      brokerSerializedResultUpperBoundBytes: dto.brokerSerializedResultUpperBoundBytes,
      reportedLocalBytesRead: dto.localBytesRead,
      reportedLocalBytesWritten: dto.localBytesWritten,
      reportedExternalEgressBytes: dto.externalEgressBytes,
      reportedBrokerExternalEgressBytes: dto.brokerExternalEgressBytes,
      reportedUncertainExternalEgressBytes: dto.uncertainExternalEgressBytes,
      provenance: dto.provenance.map((item) => ({
        sourceType: item.sourceType,
        sourceIdentifierHash: item.sourceIdentifierHash.toUpperCase(),
        contentSha256: item.contentSha256.toUpperCase(),
        trust: item.trust,
        observedAt: item.observedAt,
      })),
      acceptedAt: now.toISOString(),
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        const competingFence = await tx.msaidiziHostActionFence.findUnique({
          where: { hostActionId: action.id },
          select: {
            fenceId: true,
            hostActionId: true,
            deviceId: true,
            status: true,
            oldLeaseId: true,
            oldLeaseFencingToken: true,
            oldActionTokenDigest: true,
            journalPreviousSequence: true,
            journalPreviousHash: true,
            receiptDigest: true,
          },
        });
        if (
          competingFence &&
          (!new Set<MsaidiziHostActionFenceStatus>([
            MsaidiziHostActionFenceStatus.PENDING,
            MsaidiziHostActionFenceStatus.DISPATCHED,
          ]).has(competingFence.status) ||
            competingFence.hostActionId !== action.id ||
            competingFence.deviceId !== action.deviceId ||
            competingFence.oldLeaseId !== dto.leaseId ||
            competingFence.oldLeaseFencingToken !== BigInt(dto.fencingToken) ||
            !fixedTimeHexEquals(competingFence.oldActionTokenDigest, dto.actionTokenSha256) ||
            competingFence.journalPreviousSequence !== action.journalExpectedPreviousSequence ||
            action.journalPreviousHash == null ||
            !fixedTimeHexEquals(competingFence.journalPreviousHash, action.journalPreviousHash) ||
            competingFence.receiptDigest != null)
        ) {
          throw new HostActionPolicyError('HOST_LATE_EVIDENCE_CAS_LOST');
        }
        const event = await tx.msaidiziTaskEvent.create({
          data: {
            taskId: action.taskId,
            type: 'host_action.late_evidence_reconciled',
            actorType: 'DEVICE_BROKER',
            actorId: action.deviceId,
            payload: evidencePayload,
          },
        });
        const existingSummary = asJsonObject(action.resultSummary ?? {});
        const summary = persistedJsonObject({
          ...existingSummary,
          ...evidencePayload,
          lateEvidenceOnly: true,
          journalEvidenceEventCursor: event.cursor.toString(),
        });
        const won = await tx.msaidiziHostAction.updateMany({
          where: {
            id: action.id,
            status: MsaidiziHostActionStatus.UNKNOWN,
            uncertainOutcome: true,
            errorCode: action.errorCode,
            journalAccepted: false,
            journalReceiptDigest: null,
            journalEvidenceEventCursor: null,
            lateEvidenceAcceptedAt: null,
            leaseId: dto.leaseId,
            leaseFencingToken: BigInt(dto.fencingToken),
            leaseAuthorizationExpiresAt: new Date(dto.leaseExpiresAt),
            dispatchCount: action.dispatchCount,
            journalExpectedPreviousSequence: action.journalExpectedPreviousSequence,
            journalPreviousHash: action.journalPreviousHash,
            journalSequence: action.journalSequence,
            journalHash: action.journalHash,
          },
          data: {
            journalPrepareSequence: dto.journalPrepareSequence,
            journalPreparePreviousHash: dto.journalPreparePreviousHash!.toUpperCase(),
            journalPrepareHash: dto.journalPrepareEntryHash!.toUpperCase(),
            ...(dto.journalRecoveryPreparedSequence != null
              ? {
                  journalRecoveryPreparedSequence: dto.journalRecoveryPreparedSequence,
                  journalRecoveryPreparedPreviousHash:
                    dto.journalRecoveryPreparedPreviousHash!.toUpperCase(),
                  journalRecoveryPreparedHash: dto.journalRecoveryPreparedEntryHash!.toUpperCase(),
                }
              : {}),
            journalSequence: dto.journalSequence,
            journalPreviousHash: dto.journalPreviousHash!.toUpperCase(),
            journalHash: dto.journalEntryHash!.toUpperCase(),
            journalAccepted: true,
            journalReceiptDigest: receiptDigest,
            journalEvidenceEventCursor: event.cursor,
            journalEvidenceAcceptedAt: now,
            lateEvidenceAcceptedAt: now,
            ...(verifiedEgressReceipt
              ? {
                  egressEvidenceSha256: verifiedEgressReceipt.egressEvidenceSha256,
                  egressReceiptId: verifiedEgressReceipt.proof.receipt.receiptId,
                  egressAuthorizationLeaseId:
                    verifiedEgressReceipt.proof.authorization.lease.leaseId,
                  egressBoundaryBootId:
                    verifiedEgressReceipt.proof.authorization.attestation.bootId,
                  egressReceiptSequence: verifiedEgressReceipt.proof.receipt.sequence,
                  egressReservationDnsAnswerSetSha256:
                    verifiedEgressReceipt.reservationDnsAnswerSetSha256,
                  egressConnectionDnsAnswerSetSha256:
                    verifiedEgressReceipt.connectionDnsAnswerSetSha256,
                  egressSelectedAddressSha256: verifiedEgressReceipt.selectedAddressSha256,
                }
              : {}),
            ...(acceptedRecoveryBinding
              ? {
                  recoveryRecordSha256: dto.recoveryProvenanceSha256!.toLowerCase(),
                  expectedRestoredStateSha256: dto.preStateSha256!.toLowerCase(),
                }
              : {}),
            resultSummary: summary,
          },
        });
        if (won.count !== 1) {
          throw new HostActionPolicyError('HOST_LATE_EVIDENCE_CAS_LOST');
        }
        if (competingFence) {
          const fenceWon = await tx.msaidiziHostActionFence.updateMany({
            where: {
              fenceId: competingFence.fenceId,
              hostActionId: action.id,
              deviceId: action.deviceId,
              status: {
                in: [
                  MsaidiziHostActionFenceStatus.PENDING,
                  MsaidiziHostActionFenceStatus.DISPATCHED,
                ],
              },
              oldLeaseId: dto.leaseId,
              oldLeaseFencingToken: BigInt(dto.fencingToken),
              oldActionTokenDigest: competingFence.oldActionTokenDigest,
              journalPreviousSequence: competingFence.journalPreviousSequence,
              journalPreviousHash: competingFence.journalPreviousHash,
              receiptDigest: null,
            },
            data: { status: MsaidiziHostActionFenceStatus.CONFLICTED },
          });
          if (fenceWon.count !== 1) {
            throw new HostActionPolicyError('HOST_LATE_EVIDENCE_CAS_LOST');
          }
          await this.event(tx, action.taskId, 'host_action.fence_superseded_by_terminal_evidence', {
            fenceId: competingFence.fenceId,
            actionId: action.actionId,
            stepId: action.stepId,
            deviceId: action.deviceId,
            receiptDigest,
            oldLeaseId: competingFence.oldLeaseId,
            oldFencingToken: competingFence.oldLeaseFencingToken.toString(),
            oldActionTokenSha256: competingFence.oldActionTokenDigest,
          });
        }
        await tx.msaidiziDeviceLease.updateMany({
          where: {
            id: dto.leaseId,
            deviceId: action.deviceId,
            taskId: action.taskId,
            stepId: action.stepId,
            fencingToken: BigInt(dto.fencingToken),
            status: MsaidiziDeviceLeaseStatus.ACTIVE,
          },
          data: { status: MsaidiziDeviceLeaseStatus.RELEASED, releasedAt: now },
        });
        await this.audit.logStrictInTransaction(tx, {
          action: 'MSAIDIZI_HOST_ACTION_LATE_EVIDENCE_ACCEPTED',
          entityType: 'MsaidiziHostAction',
          entityId: action.actionId,
          userId: action.task.initiatedByUserId ?? undefined,
          companyId: action.task.companyId,
          newValue: summary,
          severity: AuditSeverity.CRITICAL,
          channel: AuditChannel.AGENT,
          agentSessionId: taskSessionId(action.taskId),
          principalType: 'MSAIDIZI',
          principalId: action.task.principalId,
          mandateId: action.task.mandateId ?? undefined,
          initiatedByUserId: action.task.initiatedByUserId ?? undefined,
          taskId: action.taskId,
          stepId: action.stepId,
          deviceId: action.deviceId,
        });
      });
    } catch (error) {
      if (
        (error instanceof HostActionPolicyError && error.code === 'HOST_LATE_EVIDENCE_CAS_LOST') ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      ) {
        const current = await this.prisma.msaidiziHostAction.findUnique({
          where: { id: action.id },
          select: {
            status: true,
            resultSummary: true,
            journalReceiptDigest: true,
            leaseId: true,
            leaseFencingToken: true,
            leaseAuthorizationExpiresAt: true,
          },
        });
        const acceptedReceiptDigest = current
          ? (current.journalReceiptDigest ?? receiptDigestOf(current.resultSummary))
          : null;
        if (current && acceptedReceiptDigest === receiptDigest) {
          return { accepted: true, replay: true, status: current.status, evidenceOnly: true };
        }
        if (acceptedReceiptDigest != null) {
          await this.markResultConflict(action);
          throw new ConflictException('A conflicting late journal receipt was received');
        }
        if (current && !hostActionLeaseGenerationMatchesReceipt(current, dto)) {
          throw new ConflictException('Late evidence belongs to a stale signed lease generation');
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          await this.rejectLateEvidence(
            action,
            dto,
            receiptDigest,
            'HOST_LATE_EVIDENCE_UNIQUE_REPLAY',
          );
          throw new ConflictException('The late evidence reused an accepted immutable identity');
        }
        throw new ConflictException(
          'Late-evidence settlement eligibility changed before persistence',
        );
      }
      throw error;
    }
    return {
      accepted: true,
      replay: dto.isIdempotentReplay,
      status: MsaidiziHostActionStatus.UNKNOWN,
      evidenceOnly: true,
    };
  }

  private async persistHostResultObservation(
    action: {
      actionId: string;
      taskId: string;
      stepId: string;
      deviceId: string;
      capability: string;
      argsDigest: string;
      dataClass: string;
      step: { arguments: Prisma.JsonValue; planVersionId: string };
    },
    outputJson: string,
    localUsage: { valid: boolean; bytesRead: bigint; bytesWritten: bigint } = {
      valid: true,
      bytesRead: 0n,
      bytesWritten: 0n,
    },
    deferArtifactCommit = false,
  ): Promise<PersistedHostObservation> {
    if (isUnavailableHostFileContentCapability(action.capability)) {
      throw new BadRequestException(REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY);
    }
    const value = JSON.parse(outputJson) as unknown;
    if (action.capability === RAW_MICROPHONE_CAPABILITY) {
      throw new BadRequestException('Raw microphone audio cannot be persisted');
    }
    const transcript = decodeBoundLocalSpeechTranscript(action, value);
    if (transcript) {
      const prepared = preparePersistedUntrustedObservation(value, 'HOST_RESULT');
      if (prepared.artifact || prepared.observation.available !== true) {
        prepared.artifact?.content.fill(0);
        throw new BadRequestException('Local transcript could not cross the persistence boundary');
      }
      return {
        observation: {
          ...prepared.observation,
          contentKind: 'LOCAL_TRANSCRIPT',
          instructionAuthority: 'NONE',
          sideEffectAuthority: 'NONE',
          audioRetained: false,
          audioSha256: transcript.audioSha256,
          audioBytes: transcript.audioBytes,
          audioBindingSha256: transcript.audioBindingSha256,
          transcriptSha256: transcript.transcriptSha256,
        },
      };
    }
    const media = decodeBoundHostMedia(action, value);
    if (media) {
      try {
        return await this.persistHostObservationArtifact(
          action,
          {
            content: media.content,
            sourceSha256: sha256Hex(outputJson).toLowerCase(),
            sourceBytes: Buffer.byteLength(outputJson, 'utf8'),
            persistedSha256: media.contentSha256,
            persistedBytes: media.content.length,
            redactionsApplied: false,
            media: media.binding,
            accountedLocalBytesRead: localUsage.bytesRead,
            accountedLocalBytesWritten: localUsage.bytesWritten,
          },
          deferArtifactCommit,
        );
      } finally {
        media.content.fill(0);
      }
    }

    const file = decodeBoundHostFileRead(action, value);
    if (file) {
      try {
        if (!file.binding) {
          return {
            observation: {
              available: false,
              trustLevel: 'UNTRUSTED',
              sourceType: 'HOST_RESULT',
              reason: file.refusalReason ?? 'UNSUPPORTED_FILE_CONTENT',
              sourceSha256: sha256Hex(outputJson),
              sourceBytes: Buffer.byteLength(outputJson, 'utf8'),
              contentSha256: file.contentSha256,
              contentBytes: file.byteSize,
              argumentsSha256: file.argumentsSha256,
              sourceIdentifierSha256: file.sourceIdentifierHash,
            },
          };
        }
        return await this.persistHostObservationArtifact(
          action,
          {
            content: file.content,
            sourceSha256: sha256Hex(outputJson).toLowerCase(),
            sourceBytes: Buffer.byteLength(outputJson, 'utf8'),
            persistedSha256: file.contentSha256,
            persistedBytes: file.byteSize,
            redactionsApplied: false,
            file: file.binding,
            accountedLocalBytesRead: localUsage.bytesRead,
            accountedLocalBytesWritten: localUsage.bytesWritten,
          },
          deferArtifactCommit,
        );
      } finally {
        file.content.fill(0);
      }
    }

    const prepared = preparePersistedUntrustedObservation(value, 'HOST_RESULT');
    if (hasOwnString(value, 'contentBase64')) {
      prepared.artifact?.content.fill(0);
      return {
        observation: {
          available: false,
          trustLevel: 'UNTRUSTED',
          sourceType: 'HOST_RESULT',
          reason: 'UNBOUND_BINARY_CONTENT_REFUSED',
          sourceSha256: sha256Hex(outputJson),
          sourceBytes: Buffer.byteLength(outputJson, 'utf8'),
        },
      };
    }
    if (!prepared.artifact) return { observation: prepared.observation };
    try {
      return await this.persistHostObservationArtifact(
        action,
        {
          ...prepared.artifact,
          accountedLocalBytesRead: localUsage.bytesRead,
          accountedLocalBytesWritten: localUsage.bytesWritten,
        },
        deferArtifactCommit,
      );
    } finally {
      prepared.artifact.content.fill(0);
    }
  }

  private async persistHostObservationArtifact(
    action: {
      taskId: string;
      stepId: string;
      capability: string;
      dataClass: string;
    },
    artifact: {
      content: Buffer;
      sourceSha256: string;
      sourceBytes: number;
      persistedSha256: string;
      persistedBytes: number;
      redactionsApplied: boolean;
      media?: HostObservationMediaBinding;
      file?: HostFileObservationBinding;
      accountedLocalBytesRead?: bigint;
      accountedLocalBytesWritten?: bigint;
    },
    deferCommit = false,
  ): Promise<PersistedHostObservation> {
    if (!this.artifacts) {
      throw new ServiceUnavailableException('Encrypted host observation storage is unavailable');
    }
    const attempt = await this.prisma.msaidiziToolAttempt.findFirst({
      where: {
        taskId: action.taskId,
        stepId: action.stepId,
        status: MsaidiziToolAttemptStatus.RUNNING,
      },
      orderBy: { attemptNumber: 'desc' },
      select: { id: true },
    });
    if (!attempt) {
      throw new ConflictException('The host observation attempt is no longer running');
    }
    const { media, file, ...artifactBase } = artifact;
    const observationInput = {
      taskId: action.taskId,
      stepId: action.stepId,
      attemptId: attempt.id,
      dataClass: action.dataClass,
      sourceType: 'HOST_RESULT',
      ...artifactBase,
      ...(media ? { media } : file ? { file } : {}),
    } as ToolObservationArtifactInput;
    const preparedArtifact = deferCommit
      ? await this.artifacts.prepareToolObservation(observationInput)
      : undefined;
    const stored = (preparedArtifact ??
      (await this.artifacts.ingestToolObservation(observationInput))) as {
      artifact?: {
        id?: unknown;
        sha256?: unknown;
        mimeType?: unknown;
        kind?: unknown;
        trustLevel?: unknown;
      };
      replay?: unknown;
    };
    const expectedMimeType =
      artifact.file?.mimeType ?? artifact.media?.mimeType ?? 'application/json';
    const expectedKind = artifact.file
      ? MsaidiziArtifactKind.FILE
      : artifact.media
        ? artifact.media.mimeType.startsWith('image/')
          ? MsaidiziArtifactKind.SCREENSHOT
          : MsaidiziArtifactKind.AUDIO
        : MsaidiziArtifactKind.OTHER;
    const artifactId = stored.artifact?.id;
    if (
      typeof artifactId !== 'string' ||
      stored.artifact?.sha256 !== artifact.persistedSha256 ||
      stored.artifact?.mimeType !== expectedMimeType ||
      stored.artifact?.kind !== expectedKind ||
      stored.artifact?.trustLevel !== MsaidiziTrustLevel.UNTRUSTED
    ) {
      if (preparedArtifact) {
        await this.artifacts.finishPreparedToolObservation(preparedArtifact, false);
      }
      throw new Error('Encrypted host observation artifact response did not match its binding');
    }
    const capability = artifact.file?.capability ?? artifact.media?.capability ?? action.capability;
    const provenance = artifact.file
      ? {
          sourceType: 'HOST_RESULT' as const,
          capability: artifact.file.capability,
          mediaType: expectedMimeType,
          contentSha256: artifact.persistedSha256,
          argumentsSha256: artifact.file.argumentsSha256,
          sourceIdentifierSha256: artifact.file.sourceIdentifierHash,
          extension: artifact.file.extension,
        }
      : {
          sourceType: 'HOST_RESULT' as const,
          capability,
          mediaType: expectedMimeType,
          contentSha256: artifact.persistedSha256,
        };
    const reference: HostObservationArtifactReference = {
      artifactId,
      artifactSha256: artifact.persistedSha256,
      artifactBytes: artifact.persistedBytes,
      artifactMimeType: expectedMimeType,
      artifactKind: expectedKind,
      trustLevel: 'UNTRUSTED',
      provenance,
      replay: stored.replay === true,
      localIoAccounted: true,
    };
    return {
      observation: {
        available: false,
        trustLevel: 'UNTRUSTED',
        sourceType: 'HOST_RESULT',
        reason: 'ARTIFACT_STORED',
        sourceSha256: artifact.sourceSha256,
        sourceBytes: artifact.sourceBytes,
        artifactId: reference.artifactId,
        artifactSha256: reference.artifactSha256,
        artifactBytes: reference.artifactBytes,
        artifactMimeType: reference.artifactMimeType,
        artifactKind: reference.artifactKind,
        provenance: reference.provenance,
        replay: reference.replay,
      },
      artifact: reference,
      ...(preparedArtifact ? { preparedArtifact } : {}),
    };
  }

  private async markResultConflict(action: {
    id: string;
    actionId: string;
    taskId: string;
    stepId: string;
    deviceId: string;
  }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.msaidiziTaskStep.updateMany({
        where: { id: action.stepId, status: { not: MsaidiziTaskStepStatus.SUCCEEDED } },
        data: { status: MsaidiziTaskStepStatus.NEEDS_ATTENTION, endedAt: new Date() },
      });
      const taskWon = await tx.msaidiziTask.updateMany({
        where: {
          id: action.taskId,
          status: { not: MsaidiziTaskStatus.NEEDS_ATTENTION },
        },
        data: {
          status: MsaidiziTaskStatus.NEEDS_ATTENTION,
          failureCode: 'CONFLICTING_DEVICE_RESULT',
          statusDetail: 'The device supplied conflicting terminal receipts',
          endedAt: new Date(),
          lastCheckpointAt: new Date(),
          stateVersion: { increment: 1 },
        },
      });
      if (taskWon.count === 1) {
        await this.notifications?.notifyMsaidiziTaskTerminal(
          tx,
          action.taskId,
          MsaidiziTaskStatus.NEEDS_ATTENTION,
        );
        await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
          kind: 'UNKNOWN_ACTION',
          deviceId: action.deviceId,
          taskId: action.taskId,
          actionId: `${action.actionId}-RESULT-CONFLICT`,
        });
      }
      await this.event(tx, action.taskId, 'host_action.result_conflict', {
        actionId: action.actionId,
        stepId: action.stepId,
      });
    });
  }

  private async expireDeviceLeases(deviceId: string) {
    const cutoff = new Date();
    const expired = await this.prisma.msaidiziDeviceLease.findMany({
      where: {
        deviceId,
        status: MsaidiziDeviceLeaseStatus.ACTIVE,
        expiresAt: { lte: cutoff },
      },
      include: {
        hostActions: { where: { status: { in: [...ACTIVE_ACTIONS] } }, include: { step: true } },
      },
    });
    for (const lease of expired) {
      const expiredAt = new Date();
      const won = await this.prisma.msaidiziDeviceLease.updateMany({
        where: {
          id: lease.id,
          fencingToken: lease.fencingToken,
          status: MsaidiziDeviceLeaseStatus.ACTIVE,
          expiresAt: { lte: cutoff },
        },
        data: { status: MsaidiziDeviceLeaseStatus.EXPIRED, releasedAt: expiredAt },
      });
      // A receipt may have renewed the same lease after the initial read. Only
      // the winner of the expiry CAS is allowed to settle its actions.
      if (won.count !== 1) continue;
      for (const action of lease.hostActions) {
        const unknown = action.step.mutation && action.status !== MsaidiziHostActionStatus.QUEUED;
        await this.settleInterruptedAction(
          action.id,
          unknown ? 'DEVICE_LEASE_EXPIRED_WRITE_OUTCOME_UNKNOWN' : 'DEVICE_LEASE_EXPIRED',
          unknown,
          action.status === MsaidiziHostActionStatus.QUEUED,
        );
      }
    }
  }

  private async expireAllLeases() {
    const cutoff = new Date();
    const expired = await this.prisma.msaidiziDeviceLease.findMany({
      where: { status: MsaidiziDeviceLeaseStatus.ACTIVE, expiresAt: { lte: cutoff } },
      select: { deviceId: true },
      distinct: ['deviceId'],
    });
    for (const lease of expired) await this.expireDeviceLeases(lease.deviceId);
  }

  private async settleInterruptedAction(
    actionId: string,
    reason: string,
    unknown: boolean,
    cancelled: boolean,
    localUsage: { bytesRead: bigint; bytesWritten: bigint } = {
      bytesRead: 0n,
      bytesWritten: 0n,
    },
    invalidateLocalIoAccounting = false,
    forceNeedsAttention = false,
  ) {
    const action = await this.prisma.msaidiziHostAction.findUnique({
      where: { id: actionId },
      include: { step: true, task: true },
    });
    if (!action || !ACTIVE_ACTIONS.includes(action.status as (typeof ACTIVE_ACTIONS)[number]))
      return;
    const now = new Date();
    const crossedDeviceBoundary = action.status !== MsaidiziHostActionStatus.QUEUED;
    const uncertaintyCharge = crossedDeviceBoundary ? action.reservedExternalEgressBytes : 0n;
    const interruptionSummary: Prisma.InputJsonObject = {
      reason,
      crossedDeviceBoundary,
      reservedExternalEgressBytes: action.reservedExternalEgressBytes.toString(),
      capabilityExternalEgressBytes: '0',
      brokerExternalEgressBytes: '0',
      uncertainExternalEgressBytes: uncertaintyCharge.toString(),
      totalExternalEgressBytes: uncertaintyCharge.toString(),
      brokerMaxDeliverySessions: action.brokerMaxDeliverySessions,
      brokerMaxRequestAttemptsPerSession: action.brokerMaxRequestAttemptsPerSession,
      brokerSerializedResultUpperBoundBytes: action.brokerSerializedResultUpperBoundBytes,
      dispatchCount: action.dispatchCount,
      localBytesRead: localUsage.bytesRead.toString(),
      localBytesWritten: localUsage.bytesWritten.toString(),
    };
    const actionStatus = unknown
      ? MsaidiziHostActionStatus.UNKNOWN
      : cancelled
        ? MsaidiziHostActionStatus.CANCELLED
        : MsaidiziHostActionStatus.FAILED;
    const stepStatus =
      unknown || forceNeedsAttention
        ? MsaidiziTaskStepStatus.NEEDS_ATTENTION
        : cancelled
          ? MsaidiziTaskStepStatus.CANCELLED
          : MsaidiziTaskStepStatus.FAILED;
    const attemptStatus = unknown
      ? MsaidiziToolAttemptStatus.UNKNOWN
      : cancelled
        ? MsaidiziToolAttemptStatus.CANCELLED
        : MsaidiziToolAttemptStatus.FAILED;
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziHostAction.updateMany({
        where: { id: action.id, status: { in: [...ACTIVE_ACTIONS] } },
        data: {
          status: actionStatus,
          uncertainOutcome: unknown,
          errorCode: reason,
          resultSummary: interruptionSummary,
          capabilityExternalEgressBytes: 0n,
          brokerExternalEgressBytes: 0n,
          uncertainExternalEgressBytes: uncertaintyCharge,
          endedAt: now,
        },
      });
      if (won.count !== 1) return;
      const latestAttempt = await tx.msaidiziToolAttempt.findFirst({
        where: { taskId: action.taskId, stepId: action.stepId },
        orderBy: { attemptNumber: 'desc' },
        select: { id: true },
      });
      if (latestAttempt) {
        await tx.msaidiziToolAttempt.update({
          where: { id: latestAttempt.id },
          data: {
            status: attemptStatus,
            uncertainOutcome: unknown,
            errorCode: reason,
            endedAt: now,
          },
        });
      }
      await tx.msaidiziTaskStep.updateMany({
        where: {
          id: action.stepId,
          status: { in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING] },
        },
        data: {
          status: stepStatus,
          bytesRead: { increment: localUsage.bytesRead },
          bytesWritten: { increment: localUsage.bytesWritten },
          ...(invalidateLocalIoAccounting || unknown ? { localIoAccountingValid: false } : {}),
          endedAt: now,
        },
      });
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${action.taskId} FOR UPDATE`;
      const budgetSettled = await tx.msaidiziTask.updateMany({
        where: {
          id: action.taskId,
          reservedExternalEgressBytes: { gte: action.reservedExternalEgressBytes },
        },
        data: {
          reservedExternalEgressBytes: { decrement: action.reservedExternalEgressBytes },
          externalEgressBytes: { increment: uncertaintyCharge },
          bytesRead: { increment: localUsage.bytesRead },
          bytesWritten: { increment: localUsage.bytesWritten },
          lastCheckpointAt: now,
        },
      });
      if (budgetSettled.count !== 1) {
        throw new HostActionPolicyError('HOST_TASK_BUDGET_SETTLEMENT_RACE');
      }
      if (action.leaseId) {
        await tx.msaidiziDeviceLease.updateMany({
          where: {
            id: action.leaseId,
            ...(action.leaseFencingToken != null ? { fencingToken: action.leaseFencingToken } : {}),
            status: MsaidiziDeviceLeaseStatus.ACTIVE,
          },
          data: { status: MsaidiziDeviceLeaseStatus.RELEASED, releasedAt: now },
        });
      }
      if (unknown || forceNeedsAttention) {
        const taskWon = await tx.msaidiziTask.updateMany({
          where: {
            id: action.taskId,
            status: {
              in: [
                MsaidiziTaskStatus.RUNNING,
                MsaidiziTaskStatus.PAUSING,
                MsaidiziTaskStatus.CANCELLING,
              ],
            },
          },
          data: {
            status: MsaidiziTaskStatus.NEEDS_ATTENTION,
            failureCode: forceNeedsAttention ? reason : 'UNKNOWN_HOST_MUTATION_OUTCOME',
            statusDetail: reason,
            endedAt: now,
            lastCheckpointAt: now,
            stateVersion: { increment: 1 },
          },
        });
        if (taskWon.count === 1) {
          await this.notifications?.notifyMsaidiziTaskTerminal(
            tx,
            action.taskId,
            MsaidiziTaskStatus.NEEDS_ATTENTION,
          );
        }
        if (unknown) {
          await this.notifications?.notifyMsaidiziDeviceIncident(tx, {
            kind: 'UNKNOWN_ACTION',
            deviceId: action.deviceId,
            taskId: action.taskId,
            actionId: action.actionId,
          });
        }
      }
      await this.event(
        tx,
        action.taskId,
        unknown ? 'host_action.outcome_unknown' : 'host_action.interrupted',
        {
          actionId: action.actionId,
          stepId: action.stepId,
          deviceId: action.deviceId,
          reason,
          ...interruptionSummary,
        },
      );
      await this.audit.logStrictInTransaction(tx, {
        action: unknown
          ? 'MSAIDIZI_HOST_ACTION_OUTCOME_UNKNOWN'
          : 'MSAIDIZI_HOST_ACTION_INTERRUPTED',
        entityType: 'MsaidiziHostAction',
        entityId: action.actionId,
        userId: action.task.initiatedByUserId ?? undefined,
        companyId: action.task.companyId,
        newValue: {
          status: actionStatus,
          uncertainOutcome: unknown,
          ...interruptionSummary,
        },
        severity: unknown ? AuditSeverity.CRITICAL : AuditSeverity.HIGH,
        channel: AuditChannel.AGENT,
        agentSessionId: taskSessionId(action.taskId),
        principalType: 'MSAIDIZI',
        principalId: action.task.principalId,
        mandateId: action.task.mandateId ?? undefined,
        initiatedByUserId: action.task.initiatedByUserId ?? undefined,
        taskId: action.taskId,
        stepId: action.stepId,
        deviceId: action.deviceId,
      });
    });
  }

  private assertActiveMandate(
    mandate: {
      status: MsaidiziMandateStatus;
      startsAt: Date | null;
      expiresAt: Date | null;
      capabilities: Prisma.JsonValue;
    },
    capability: string,
    capabilityVersion: string,
    effect: MsaidiziEffect,
    dataClass: string,
    argumentsValue: Prisma.JsonValue,
  ) {
    if (
      !isMandateValidForAction(
        mandate,
        null,
        capability,
        capabilityVersion,
        effect,
        dataClass,
        argumentsValue,
      )
    ) {
      throw new HostActionPolicyError('HOST_MANDATE_CAPABILITY_DENIED');
    }
  }

  private async event(
    tx: Prisma.TransactionClient,
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    return tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type,
        actorType: 'DEVICE_BROKER',
        actorId: typeof payload.deviceId === 'string' ? payload.deviceId : undefined,
        payload: persistedJsonObject(payload),
      },
    });
  }
}

type HostMediaCapability = HostObservationMediaBinding['capability'];

interface HostMediaActionContext {
  actionId: string;
  taskId: string;
  stepId: string;
  deviceId: string;
  capability: string;
  argsDigest: string;
  step: { arguments: Prisma.JsonValue; planVersionId: string };
}

interface DecodedHostMedia {
  binding: HostObservationMediaBinding;
  content: Buffer;
  contentSha256: string;
}

/**
 * Delivery-generation fields are intentionally excluded. A fence JWT may be
 * redelivered under generation N+1 after the generation-N receipt response is
 * lost, while both deliveries refer to the same durable tombstone.
 */
function fenceReceiptDigest(dto: ActionFencedReceiptDto): string {
  return jsonSha256({
    protocol: 'msaidizi-action-fence/v3',
    outcome: dto.outcome,
    fenceId: dto.fenceId,
    deviceId: dto.deviceId,
    actionId: dto.actionId,
    taskId: dto.taskId,
    stepId: dto.stepId,
    oldLeaseId: dto.oldLeaseId,
    oldFencingToken: dto.oldFencingToken,
    oldActionTokenSha256: dto.oldActionTokenSha256.toUpperCase(),
    journalPreviousSequence: dto.journalPreviousSequence,
    journalPreviousHash: dto.journalPreviousHash.toUpperCase(),
    tombstoneSequence: dto.tombstoneSequence,
    tombstonePreviousHash: dto.tombstonePreviousHash.toUpperCase(),
    tombstoneEntryHash: dto.tombstoneEntryHash.toUpperCase(),
  });
}

interface DecodedLocalSpeechTranscript {
  audioSha256: string;
  audioBytes: number;
  audioBindingSha256: string;
  transcriptSha256: string;
}

type GovernedHostMediaCapability = Exclude<HostMediaCapability, 'audio.microphone.capture'>;

const HOST_MEDIA_TYPES: Record<
  GovernedHostMediaCapability,
  HostObservationMediaBinding['mimeType']
> = {
  'screen.primary.capture': 'image/png',
  'camera.photo.capture': 'image/jpeg',
  'speech.text.synthesize': 'audio/wav',
};

/** Revalidate the untrusted companion envelope at the central trust boundary. */
export function validateHostOutputEnvelope(
  action: HostMediaActionContext,
  outputJson: string | null | undefined,
): boolean {
  if (action.capability === RAW_MICROPHONE_CAPABILITY) return false;
  if (isUnavailableHostFileContentCapability(action.capability)) return false;
  if (outputJson == null) return true;
  let content: Buffer | undefined;
  try {
    const value = JSON.parse(outputJson) as unknown;
    const media = decodeBoundHostMedia(action, value);
    const file = media ? null : decodeBoundHostFileRead(action, value);
    if (!media && !file) decodeBoundLocalSpeechTranscript(action, value);
    content = media?.content ?? file?.content;
    return true;
  } catch {
    return false;
  } finally {
    content?.fill(0);
  }
}

/** Local transcript text is useful to the bounded checkpoint, never to the audit ledger. */
export function hostResultAuditSummary(
  capability: string,
  summary: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  if (capability !== LOCAL_STT_CAPABILITY) return summary;
  const { observation, ...digestOnlySummary } = summary;
  void observation;
  return digestOnlySummary;
}

export function validateLocalSpeechReceipt(
  action: HostMediaActionContext,
  dto: Pick<
    ActionResultDto,
    'localBytesRead' | 'localBytesWritten' | 'externalEgressBytes' | 'outputJson' | 'provenance'
  >,
  outcome: string,
): boolean {
  if (action.capability !== LOCAL_STT_CAPABILITY) return true;
  if (dto.externalEgressBytes !== 0 || dto.localBytesRead !== dto.localBytesWritten) return false;
  if (dto.outputJson == null) {
    return (
      outcome !== 'Completed' &&
      dto.provenance.length === 0 &&
      (dto.localBytesRead === 0 || dto.localBytesRead >= 44)
    );
  }
  if (outcome !== 'Completed') return false;
  try {
    const decoded = decodeBoundLocalSpeechTranscript(action, JSON.parse(dto.outputJson) as unknown);
    if (!decoded || dto.localBytesRead !== decoded.audioBytes || dto.provenance.length !== 2) {
      return false;
    }
    const audio = dto.provenance.find((item) => item.sourceType === 'speech-input-audio');
    const recognizer = dto.provenance.find(
      (item) => item.sourceType === 'windows-installed-speech-recognizer',
    );
    return (
      audio !== undefined &&
      recognizer !== undefined &&
      trustName(audio.trust) === 'UntrustedContent' &&
      trustName(recognizer.trust) === 'TrustedSystem' &&
      fixedTimeHexEquals(audio.sourceIdentifierHash, decoded.audioBindingSha256) &&
      fixedTimeHexEquals(audio.contentSha256, decoded.audioSha256) &&
      isSha256Hex(recognizer.sourceIdentifierHash) &&
      fixedTimeHexEquals(recognizer.contentSha256, decoded.transcriptSha256)
    );
  } catch {
    return false;
  }
}

function decodeBoundLocalSpeechTranscript(
  action: HostMediaActionContext,
  value: unknown,
): DecodedLocalSpeechTranscript | null {
  if (action.capability !== LOCAL_STT_CAPABILITY) return null;
  const result = strictObject(value, 'Local speech result is not an object');
  const argumentsValue = strictObject(
    action.step.arguments,
    'Local speech arguments are not an object',
  );
  if (
    !hasExactKeys(result, [
      'actionId',
      'audioBindingSha256',
      'audioBytes',
      'audioSha256',
      'confidence',
      'deviceId',
      'durationMilliseconds',
      'instructionAuthority',
      'planVersionId',
      'protocol',
      'recognizerId',
      'redactionsApplied',
      'stepId',
      'taskId',
      'transcript',
      'transcriptSha256',
      'trustLevel',
    ]) ||
    !hasExactKeys(argumentsValue, ['durationMilliseconds', 'maxCharacters', 'recognizerId']) ||
    result.protocol !== LOCAL_STT_PROTOCOL ||
    result.taskId !== action.taskId ||
    result.planVersionId !== action.step.planVersionId ||
    result.stepId !== action.stepId ||
    result.deviceId !== action.deviceId ||
    result.actionId !== action.actionId ||
    result.recognizerId !== argumentsValue.recognizerId ||
    result.trustLevel !== 'UNTRUSTED' ||
    result.instructionAuthority !== 'NONE' ||
    typeof result.redactionsApplied !== 'boolean' ||
    typeof result.transcript !== 'string' ||
    !positiveInteger(result.audioBytes) ||
    result.audioBytes < 44 ||
    result.audioBytes > 16_777_216 ||
    !positiveInteger(result.durationMilliseconds) ||
    !positiveInteger(argumentsValue.durationMilliseconds) ||
    argumentsValue.durationMilliseconds < 100 ||
    argumentsValue.durationMilliseconds > 30_000 ||
    !positiveInteger(argumentsValue.maxCharacters) ||
    argumentsValue.maxCharacters > 32_768 ||
    typeof argumentsValue.recognizerId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(argumentsValue.recognizerId) ||
    result.durationMilliseconds > Math.min(30_000, argumentsValue.durationMilliseconds + 2_000) ||
    result.transcript.length > argumentsValue.maxCharacters ||
    typeof result.confidence !== 'number' ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1 ||
    typeof result.audioSha256 !== 'string' ||
    typeof result.transcriptSha256 !== 'string' ||
    typeof result.audioBindingSha256 !== 'string' ||
    !isSha256Hex(result.audioSha256) ||
    !isSha256Hex(result.transcriptSha256) ||
    !isSha256Hex(result.audioBindingSha256)
  ) {
    throw new BadRequestException('Local speech result does not match its governed action');
  }
  const transcriptDlp = sanitizePersistedValue(result.transcript);
  if (transcriptDlp.redactionsApplied || transcriptDlp.value !== result.transcript) {
    throw new BadRequestException('Local speech result contains secret material');
  }
  const transcriptSha256 = sha256Hex(result.transcript);
  if (!fixedTimeHexEquals(transcriptSha256, result.transcriptSha256)) {
    throw new BadRequestException('Local speech transcript digest does not match its content');
  }
  const audioBindingSha256 = sha256Hex(
    [
      LOCAL_STT_PROTOCOL,
      action.taskId,
      action.step.planVersionId,
      action.stepId,
      action.deviceId,
      action.actionId,
      result.audioSha256,
    ].join('\0'),
  );
  if (!fixedTimeHexEquals(audioBindingSha256, result.audioBindingSha256)) {
    throw new BadRequestException('Local speech audio digest is not bound to this action');
  }
  return {
    audioSha256: result.audioSha256,
    audioBytes: result.audioBytes,
    audioBindingSha256: result.audioBindingSha256,
    transcriptSha256: result.transcriptSha256,
  };
}

function localSpeechArgumentsValid(value: Prisma.JsonValue): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const argumentsValue = value as Prisma.JsonObject;
  const keys = Object.keys(argumentsValue).sort();
  return (
    keys.length === 3 &&
    keys[0] === 'durationMilliseconds' &&
    keys[1] === 'maxCharacters' &&
    keys[2] === 'recognizerId' &&
    positiveInteger(argumentsValue.durationMilliseconds) &&
    Number(argumentsValue.durationMilliseconds) >= 100 &&
    Number(argumentsValue.durationMilliseconds) <= 30_000 &&
    positiveInteger(argumentsValue.maxCharacters) &&
    Number(argumentsValue.maxCharacters) <= 32_768 &&
    typeof argumentsValue.recognizerId === 'string' &&
    /^[A-Za-z0-9._-]{1,80}$/.test(argumentsValue.recognizerId)
  );
}

function trustName(value: string | number): string | null {
  if (typeof value === 'string') return value;
  return (
    ['TrustedSystem', 'AuthenticatedRemote', 'UserSupplied', 'UntrustedContent'][value] ?? null
  );
}

function validateHostFileReadReceipt(
  action: HostMediaActionContext,
  dto: Pick<ActionResultDto, 'localBytesRead' | 'localBytesWritten' | 'outputJson' | 'provenance'>,
  outcome: string,
): boolean {
  if (isUnavailableHostFileContentCapability(action.capability)) return false;
  if (action.capability !== 'filesystem.file.read') return true;
  if (dto.outputJson == null) {
    return outcome !== 'Completed' && dto.localBytesWritten === 0;
  }
  let content: Buffer | undefined;
  try {
    const decoded = decodeBoundHostFileRead(action, JSON.parse(dto.outputJson) as unknown);
    if (!decoded) return false;
    content = decoded.content;
    return hostFileReceiptMatches(decoded, dto);
  } catch {
    return false;
  } finally {
    content?.fill(0);
  }
}

function decodeBoundHostMedia(
  action: HostMediaActionContext,
  value: unknown,
): DecodedHostMedia | null {
  if (!Object.prototype.hasOwnProperty.call(HOST_MEDIA_TYPES, action.capability)) return null;
  const capability = action.capability as GovernedHostMediaCapability;
  const mimeType = HOST_MEDIA_TYPES[capability];
  const result = strictObject(value, 'Host media result is not an object');
  const argumentsValue = strictObject(
    action.step.arguments,
    'Host media arguments are not an object',
  );
  const expectedKeys =
    capability === 'screen.primary.capture'
      ? ['contentBase64', 'contentSha256', 'height', 'mediaType', 'width']
      : capability === 'camera.photo.capture'
        ? ['cameraId', 'contentBase64', 'contentSha256', 'height', 'mediaType', 'width']
        : ['contentBase64', 'contentSha256', 'durationMilliseconds', 'mediaType', 'voiceId'];
  if (!hasExactKeys(result, expectedKeys) || result.mediaType !== mimeType) {
    throw new BadRequestException('Host media result does not match its capability');
  }
  const encoded = result.contentBase64;
  const declaredSha256 = result.contentSha256;
  if (
    typeof encoded !== 'string' ||
    typeof declaredSha256 !== 'string' ||
    !isSha256Hex(declaredSha256)
  ) {
    throw new BadRequestException('Host media content metadata is invalid');
  }
  const content = decodeCanonicalBase64(encoded);
  try {
    const actualSha256 = sha256Hex(content).toLowerCase();
    if (!fixedTimeHexEquals(actualSha256, declaredSha256)) {
      throw new BadRequestException('Host media content digest does not match its declaration');
    }
    if (capability === 'screen.primary.capture') {
      const dimensions = pngDimensions(content);
      if (
        !dimensions ||
        !positiveInteger(result.width) ||
        !positiveInteger(result.height) ||
        result.width !== dimensions.width ||
        result.height !== dimensions.height ||
        !boundedByArguments(result, argumentsValue)
      ) {
        throw new BadRequestException('Screen image metadata does not match the PNG payload');
      }
    } else if (capability === 'camera.photo.capture') {
      const dimensions = jpegDimensions(content);
      if (
        !dimensions ||
        !positiveInteger(result.width) ||
        !positiveInteger(result.height) ||
        result.width !== dimensions.width ||
        result.height !== dimensions.height ||
        typeof result.cameraId !== 'string' ||
        result.cameraId !== argumentsValue.cameraId ||
        !boundedByArguments(result, argumentsValue)
      ) {
        throw new BadRequestException('Camera metadata does not match the JPEG payload');
      }
    } else {
      if (
        !wavPayloadValid(content) ||
        !positiveInteger(result.durationMilliseconds) ||
        (capability === 'speech.text.synthesize' &&
          (typeof result.voiceId !== 'string' || result.voiceId !== argumentsValue.voiceId))
      ) {
        throw new BadRequestException('Audio metadata does not match the WAV payload');
      }
    }
    return {
      binding: { capability, mimeType } as HostObservationMediaBinding,
      content,
      contentSha256: actualSha256,
    };
  } catch (error) {
    content.fill(0);
    throw error;
  }
}

function strictObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(message);
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasOwnString(value: unknown, key: string): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key) &&
    typeof (value as Record<string, unknown>)[key] === 'string'
  );
}

function decodeCanonicalBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new BadRequestException('Host media content is not canonical Base64');
  }
  const content = Buffer.from(value, 'base64');
  if (content.length === 0 || content.toString('base64') !== value) {
    content.fill(0);
    throw new BadRequestException('Host media content is not canonical Base64');
  }
  return content;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function boundedByArguments(
  result: Record<string, unknown>,
  argumentsValue: Record<string, unknown>,
): boolean {
  return (
    positiveInteger(argumentsValue.maxWidth) &&
    positiveInteger(argumentsValue.maxHeight) &&
    Number(result.width) <= argumentsValue.maxWidth &&
    Number(result.height) <= argumentsValue.maxHeight
  );
}

function pngDimensions(content: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    content.length < 45 ||
    !content.subarray(0, 8).equals(signature) ||
    content.readUInt32BE(8) !== 13 ||
    content.subarray(12, 16).toString('ascii') !== 'IHDR' ||
    content.readUInt32BE(content.length - 12) !== 0 ||
    content.subarray(content.length - 8, content.length - 4).toString('ascii') !== 'IEND'
  ) {
    return null;
  }
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(content: Buffer): { width: number; height: number } | null {
  if (
    content.length < 4 ||
    content[0] !== 0xff ||
    content[1] !== 0xd8 ||
    content[content.length - 2] !== 0xff ||
    content[content.length - 1] !== 0xd9
  ) {
    return null;
  }
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < content.length) {
    while (offset < content.length && content[offset] !== 0xff) offset += 1;
    while (offset < content.length && content[offset] === 0xff) offset += 1;
    if (offset >= content.length) break;
    const marker = content[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= content.length) return null;
    const length = content.readUInt16BE(offset);
    if (length < 2 || offset + length > content.length) return null;
    if (startOfFrame.has(marker)) {
      if (length < 7) return null;
      const height = content.readUInt16BE(offset + 3);
      const width = content.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function wavPayloadValid(content: Buffer): boolean {
  return (
    content.length >= 44 &&
    content.subarray(0, 4).toString('ascii') === 'RIFF' &&
    content.subarray(8, 12).toString('ascii') === 'WAVE' &&
    content.readUInt32LE(4) + 8 === content.length
  );
}

function actionBudgets(task: {
  maxWallTimeSeconds: number;
  maxModelTurns: number;
  maxAttemptedToolCalls: number;
  maxMutations: number;
  maxLocalBytes: bigint;
  maxExternalEgressBytes: bigint;
  maxModelCostUsd: Prisma.Decimal;
}): ActionBudgetClaims {
  const base = {
    maxWallTimeSeconds: task.maxWallTimeSeconds,
    maxModelTurns: task.maxModelTurns,
    maxAttemptedToolCalls: task.maxAttemptedToolCalls,
    maxMutations: task.maxMutations,
    maxLocalBytes: safeNumber(task.maxLocalBytes),
    maxExternalEgressBytes: safeNumber(task.maxExternalEgressBytes),
    maxModelSpendUsd: task.maxModelCostUsd.toNumber(),
  };
  return (
    withBrokerDeliveryBudget(base) ?? {
      ...base,
      brokerMaxDeliverySessions: 0,
      brokerMaxRequestAttemptsPerSession: 0,
      brokerSerializedResultUpperBoundBytes: 0,
    }
  );
}

export function remainingActionBudgets(
  task: {
    maxWallTimeSeconds: number;
    maxModelTurns: number;
    maxAttemptedToolCalls: number;
    maxMutations: number;
    maxLocalBytes: bigint;
    maxExternalEgressBytes: bigint;
    maxModelCostUsd: Prisma.Decimal;
    consumedWallTimeMs: bigint;
    wallTimeCheckpointAt: Date | null;
    modelTurns: number;
    attemptedToolCalls: number;
    mutations: number;
    bytesRead: bigint;
    bytesWritten: bigint;
    externalEgressBytes: bigint;
    reservedExternalEgressBytes: bigint;
    modelCostUsd: Prisma.Decimal;
  },
  wallTimeObservedAt: Date | number = Date.now(),
): ActionBudgetClaims | null {
  const remainingWallTimeMilliseconds = remainingTaskWallTimeMs(task, wallTimeObservedAt);
  const remainingWallTimeSeconds = Number(remainingWallTimeMilliseconds / 1_000n);
  const localUsed = task.bytesRead + task.bytesWritten;
  if (
    remainingWallTimeSeconds < 1 ||
    task.attemptedToolCalls > task.maxAttemptedToolCalls ||
    task.mutations > task.maxMutations ||
    localUsed > task.maxLocalBytes ||
    task.externalEgressBytes + task.reservedExternalEgressBytes > task.maxExternalEgressBytes ||
    task.modelCostUsd.greaterThan(task.maxModelCostUsd)
  ) {
    return null;
  }
  return withBrokerDeliveryBudget({
    maxWallTimeSeconds: remainingWallTimeSeconds,
    // The current step was already reserved centrally. These counters remain
    // present in the signed contract, but the companion may not spend them.
    maxModelTurns: Math.max(1, task.maxModelTurns - task.modelTurns),
    maxAttemptedToolCalls: Math.max(1, task.maxAttemptedToolCalls - task.attemptedToolCalls + 1),
    maxMutations: Math.max(0, task.maxMutations - task.mutations),
    maxLocalBytes: safeNumber(task.maxLocalBytes - localUsed),
    maxExternalEgressBytes: safeNumber(
      task.maxExternalEgressBytes - task.externalEgressBytes - task.reservedExternalEgressBytes,
    ),
    maxModelSpendUsd: Math.max(0, task.maxModelCostUsd.minus(task.modelCostUsd).toNumber()),
  });
}

function minimumActionBudgets(
  left: ActionBudgetClaims,
  right: ActionBudgetClaims,
): ActionBudgetClaims | null {
  return withBrokerDeliveryBudget({
    maxWallTimeSeconds: Math.min(left.maxWallTimeSeconds, right.maxWallTimeSeconds),
    maxModelTurns: Math.min(left.maxModelTurns, right.maxModelTurns),
    maxAttemptedToolCalls: Math.min(left.maxAttemptedToolCalls, right.maxAttemptedToolCalls),
    maxMutations: Math.min(left.maxMutations, right.maxMutations),
    maxLocalBytes: Math.min(left.maxLocalBytes, right.maxLocalBytes),
    maxExternalEgressBytes: Math.min(left.maxExternalEgressBytes, right.maxExternalEgressBytes),
    maxModelSpendUsd: Math.min(left.maxModelSpendUsd, right.maxModelSpendUsd),
  });
}

export function constrainActionBudgetsToStep(
  taskRemaining: ActionBudgetClaims,
  step: {
    budgets: Prisma.JsonValue;
    startedAt: Date | null;
    bytesRead?: bigint;
    bytesWritten?: bigint;
    localIoAccountingValid?: boolean;
  },
): ActionBudgetClaims | null {
  const parsed = parseStepBudgets(step.budgets);
  if (!parsed.ok) return null;
  const localIo = stepLocalIoState(step);
  if (!localIo.ok) return null;
  const budget = parsed.limits;
  const elapsedSeconds = step.startedAt
    ? Math.max(0, Math.floor((Date.now() - step.startedAt.getTime()) / 1_000))
    : 0;
  const stepWallRemaining =
    budget.maxWallTimeSeconds === undefined
      ? taskRemaining.maxWallTimeSeconds
      : budget.maxWallTimeSeconds - elapsedSeconds;
  if (stepWallRemaining <= 0) return null;
  const constrained = withBrokerDeliveryBudget({
    maxWallTimeSeconds: Math.min(taskRemaining.maxWallTimeSeconds, stepWallRemaining),
    // These counters are reserved and settled centrally; the companion cannot
    // spend them. Preserve the already-tight task remainder in the signed
    // protocol while applying step limits to host-consumable resources.
    maxModelTurns: taskRemaining.maxModelTurns,
    maxAttemptedToolCalls: taskRemaining.maxAttemptedToolCalls,
    maxMutations: taskRemaining.maxMutations,
    maxLocalBytes: Math.min(
      taskRemaining.maxLocalBytes,
      localIo.remaining === null ? taskRemaining.maxLocalBytes : safeNumber(localIo.remaining),
    ),
    maxExternalEgressBytes: Math.min(
      taskRemaining.maxExternalEgressBytes,
      budget.maxExternalEgressBytes ?? taskRemaining.maxExternalEgressBytes,
    ),
    maxModelSpendUsd: taskRemaining.maxModelSpendUsd,
  });
  return constrained ? minimumActionBudgets(taskRemaining, constrained) : null;
}

export function withBrokerDeliveryBudget(
  budget: Omit<
    ActionBudgetClaims,
    | 'brokerMaxDeliverySessions'
    | 'brokerMaxRequestAttemptsPerSession'
    | 'brokerSerializedResultUpperBoundBytes'
  >,
): ActionBudgetClaims | null {
  const aggregateBrokerCeiling = Math.min(
    BROKER_MAX_AGGREGATE_EGRESS_BYTES,
    Math.floor(budget.maxExternalEgressBytes / 4),
  );
  const brokerSerializedResultUpperBoundBytes = Math.floor(
    aggregateBrokerCeiling /
      (BROKER_MAX_DELIVERY_SESSIONS * BROKER_MAX_REQUEST_ATTEMPTS_PER_SESSION),
  );
  if (
    !Number.isSafeInteger(brokerSerializedResultUpperBoundBytes) ||
    brokerSerializedResultUpperBoundBytes < BROKER_MIN_SERIALIZED_RESULT_UPPER_BOUND_BYTES
  ) {
    return null;
  }
  return {
    ...budget,
    brokerMaxDeliverySessions: BROKER_MAX_DELIVERY_SESSIONS,
    brokerMaxRequestAttemptsPerSession: BROKER_MAX_REQUEST_ATTEMPTS_PER_SESSION,
    brokerSerializedResultUpperBoundBytes,
  };
}

function assertMandateBudgets(value: Prisma.JsonValue, budget: ActionBudgetClaims): void {
  const limits = asJsonObject(value);
  const comparisons: Array<[string, number]> = [
    ['maxWallTimeSeconds', budget.maxWallTimeSeconds],
    ['maxModelTurns', budget.maxModelTurns],
    ['maxAttemptedToolCalls', budget.maxAttemptedToolCalls],
    ['maxMutations', budget.maxMutations],
    ['maxLocalBytes', budget.maxLocalBytes],
    ['maxExternalEgressBytes', budget.maxExternalEgressBytes],
    ['maxModelCostUsd', budget.maxModelSpendUsd],
  ];
  for (const [key, requested] of comparisons) {
    const limit = limits[key];
    if (
      limit !== undefined &&
      (typeof limit !== 'number' || !Number.isFinite(limit) || requested > limit)
    ) {
      throw new HostActionPolicyError('HOST_MANDATE_BUDGET_EXCEEDED');
    }
  }
}

function isMandateValidForAction(
  mandate: {
    status: MsaidiziMandateStatus;
    startsAt: Date | null;
    expiresAt: Date | null;
    capabilities: Prisma.JsonValue;
    deviceIds?: Prisma.JsonValue;
  } | null,
  deviceId: string | null,
  capability: string,
  capabilityVersion: string,
  effect: MsaidiziEffect,
  dataClass: string,
  argumentsValue?: Prisma.JsonValue,
  authorizationClock: Date | number = Date.now(),
): boolean {
  const now =
    authorizationClock instanceof Date ? authorizationClock.getTime() : authorizationClock;
  if (
    !Number.isFinite(now) ||
    !mandate ||
    mandate.status !== MsaidiziMandateStatus.ACTIVE ||
    (mandate.startsAt && mandate.startsAt.getTime() > now) ||
    (mandate.expiresAt && mandate.expiresAt.getTime() <= now) ||
    (deviceId !== null && !stringArray(mandate.deviceIds).includes(deviceId))
  ) {
    return false;
  }
  const grants = Array.isArray(mandate.capabilities) ? mandate.capabilities : [];
  const destinationAuthority = requestedExternalDestinationAuthority(
    capability,
    argumentsValue ?? {},
  );
  if (destinationAuthority === 'invalid') return false;
  return grants.some((grant) => {
    if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return false;
    const value = grant as Prisma.JsonObject;
    return (
      value.capability === capability &&
      (value.version === undefined || value.version === capabilityVersion) &&
      stringArray(value.effects).includes(effect) &&
      (stringArray(value.dataClasses).includes('*') ||
        stringArray(value.dataClasses).includes(dataClass)) &&
      grantAllowsExternalDestinationAuthority(
        value as Record<string, unknown>,
        destinationAuthority,
      )
    );
  });
}

export function mandateConsentGrantForAction(
  mandate: {
    capabilities: Prisma.JsonValue;
  } | null,
  capability: string,
  capabilityVersion: string,
  effect: MsaidiziEffect,
  dataClass: string,
  consent: string,
  oneShotConsentGranted = false,
): 'one_shot_approval' | 'emergency_operator' | null {
  if (consent === 'None' || consent === 'SignedMandate') return null;
  if (consent === 'OneShotApproval') {
    return oneShotConsentGranted ? 'one_shot_approval' : null;
  }
  if (!mandate || consent !== 'EmergencyOperator') return null;
  const grants = Array.isArray(mandate.capabilities) ? mandate.capabilities : [];
  const grant = grants.find((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const value = candidate as Prisma.JsonObject;
    return (
      value.capability === capability &&
      (value.version === undefined || value.version === capabilityVersion) &&
      stringArray(value.effects).includes(effect) &&
      (stringArray(value.dataClasses).includes('*') ||
        stringArray(value.dataClasses).includes(dataClass))
    );
  });
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return null;
  return stringArray((grant as Prisma.JsonObject).consentGrants).includes('emergency_operator')
    ? 'emergency_operator'
    : null;
}

export function oneShotConsentGrantedForAction(
  events: Array<{
    actorType: string;
    actorId: string | null;
    payload: Prisma.JsonValue;
  }>,
  initiatedByUserId: string | null,
  action: {
    stepId: string;
    argsDigest: string;
    capability: string;
    capabilityVersion: string;
    step: { planVersionId: string };
  },
): boolean {
  if (
    !ONE_SHOT_CONSENT_CAPABILITIES.has(action.capability) ||
    !initiatedByUserId ||
    !isSha256Hex(action.argsDigest)
  ) {
    return false;
  }
  return events.some((event) => {
    const payload = asJsonObject(event.payload);
    return (
      event.actorType === 'HUMAN' &&
      event.actorId === initiatedByUserId &&
      payload.protocol === ONE_SHOT_CONSENT_PROTOCOL &&
      payload.planVersionId === action.step.planVersionId &&
      payload.stepId === action.stepId &&
      payload.capability === action.capability &&
      payload.capabilityVersion === action.capabilityVersion &&
      payload.consentGrant === 'one_shot_approval' &&
      payload.instructionAuthority === 'NONE' &&
      typeof payload.argumentsSha256 === 'string' &&
      fixedTimeHexEquals(payload.argumentsSha256, action.argsDigest)
    );
  });
}

function parseActionBudgets(value: Prisma.JsonValue): ActionBudgetClaims | null {
  const object = asJsonObject(value);
  const keys = [
    'maxWallTimeSeconds',
    'maxModelTurns',
    'maxAttemptedToolCalls',
    'maxMutations',
    'maxLocalBytes',
    'maxExternalEgressBytes',
    'maxModelSpendUsd',
    'brokerMaxDeliverySessions',
    'brokerMaxRequestAttemptsPerSession',
    'brokerSerializedResultUpperBoundBytes',
  ] as const;
  if (
    Object.keys(object).length !== keys.length ||
    keys.some((key) => typeof object[key] !== 'number')
  ) {
    return null;
  }
  const result = Object.fromEntries(
    keys.map((key) => [key, object[key]]),
  ) as unknown as ActionBudgetClaims;
  if (
    !Number.isSafeInteger(result.maxWallTimeSeconds) ||
    result.maxWallTimeSeconds <= 0 ||
    !Number.isSafeInteger(result.maxModelTurns) ||
    result.maxModelTurns <= 0 ||
    !Number.isSafeInteger(result.maxAttemptedToolCalls) ||
    result.maxAttemptedToolCalls <= 0 ||
    !Number.isSafeInteger(result.maxMutations) ||
    result.maxMutations < 0 ||
    !Number.isSafeInteger(result.maxLocalBytes) ||
    result.maxLocalBytes < 0 ||
    !Number.isSafeInteger(result.maxExternalEgressBytes) ||
    result.maxExternalEgressBytes < 0 ||
    !Number.isFinite(result.maxModelSpendUsd) ||
    result.maxModelSpendUsd < 0 ||
    !Number.isSafeInteger(result.brokerMaxDeliverySessions) ||
    result.brokerMaxDeliverySessions < 1 ||
    result.brokerMaxDeliverySessions > BROKER_MAX_DELIVERY_SESSIONS ||
    !Number.isSafeInteger(result.brokerMaxRequestAttemptsPerSession) ||
    result.brokerMaxRequestAttemptsPerSession < 1 ||
    result.brokerMaxRequestAttemptsPerSession > BROKER_MAX_REQUEST_ATTEMPTS_PER_SESSION ||
    !Number.isSafeInteger(result.brokerSerializedResultUpperBoundBytes) ||
    result.brokerSerializedResultUpperBoundBytes < BROKER_MIN_SERIALIZED_RESULT_UPPER_BOUND_BYTES ||
    BigInt(result.brokerMaxDeliverySessions) *
      BigInt(result.brokerMaxRequestAttemptsPerSession) *
      BigInt(result.brokerSerializedResultUpperBoundBytes) >
      BigInt(
        Math.min(BROKER_MAX_AGGREGATE_EGRESS_BYTES, Math.floor(result.maxExternalEgressBytes / 4)),
      )
  ) {
    return null;
  }
  return result;
}

export function validateActionResultOutput(
  dto: ActionResultDto,
  maximumEgress: bigint,
  terminalReplay?: { expectedOutputSha256: string | null },
): {
  valid: boolean;
  outputBytes: bigint;
  outputSha256: string | null;
  capabilityExternalEgressBytes: bigint;
  brokerExternalEgressBytes: bigint;
  uncertainExternalEgressBytes: bigint;
  minimumBrokerPayloadBytes: bigint;
  brokerContractValid: boolean;
  totalExternalEgressBytes: bigint;
} {
  const capabilityEgressValid =
    Number.isSafeInteger(dto.externalEgressBytes) && dto.externalEgressBytes >= 0;
  const brokerEgressValid =
    Number.isSafeInteger(dto.brokerExternalEgressBytes) && dto.brokerExternalEgressBytes >= 0;
  const uncertainEgressValid =
    Number.isSafeInteger(dto.uncertainExternalEgressBytes) && dto.uncertainExternalEgressBytes >= 0;
  const brokerFactorsValid =
    Number.isSafeInteger(dto.brokerMaxDeliverySessions) &&
    dto.brokerMaxDeliverySessions >= 1 &&
    dto.brokerMaxDeliverySessions <= BROKER_MAX_DELIVERY_SESSIONS &&
    Number.isSafeInteger(dto.brokerMaxRequestAttemptsPerSession) &&
    dto.brokerMaxRequestAttemptsPerSession >= 1 &&
    dto.brokerMaxRequestAttemptsPerSession <= BROKER_MAX_REQUEST_ATTEMPTS_PER_SESSION &&
    Number.isSafeInteger(dto.brokerSerializedResultUpperBoundBytes) &&
    dto.brokerSerializedResultUpperBoundBytes >= BROKER_MIN_SERIALIZED_RESULT_UPPER_BOUND_BYTES;
  const capabilityExternalEgressBytes = capabilityEgressValid
    ? BigInt(dto.externalEgressBytes)
    : 0n;
  const brokerExternalEgressBytes = brokerEgressValid ? BigInt(dto.brokerExternalEgressBytes) : 0n;
  const uncertainExternalEgressBytes = uncertainEgressValid
    ? BigInt(dto.uncertainExternalEgressBytes)
    : 0n;
  // Re-serializing a validated DTO without transport whitespace is a sound
  // lower bound for the JSON bytes the device had to send. It deliberately
  // includes brokerExternalEgressBytes itself.
  const minimumBrokerPayloadBytes = BigInt(Buffer.byteLength(JSON.stringify(dto), 'utf8'));
  const prepaidBrokerExternalEgressBytes = brokerFactorsValid
    ? BigInt(dto.brokerMaxDeliverySessions) *
      BigInt(dto.brokerMaxRequestAttemptsPerSession) *
      BigInt(dto.brokerSerializedResultUpperBoundBytes)
    : 0n;
  const brokerContractValid =
    brokerFactorsValid &&
    brokerExternalEgressBytes === prepaidBrokerExternalEgressBytes &&
    BigInt(dto.brokerSerializedResultUpperBoundBytes) >= minimumBrokerPayloadBytes;
  const totalExternalEgressBytes =
    capabilityExternalEgressBytes + brokerExternalEgressBytes + uncertainExternalEgressBytes;
  if (dto.outputJson == null) {
    const digestOnlyTerminalReplay =
      terminalReplay?.expectedOutputSha256 != null &&
      dto.isIdempotentReplay &&
      dto.outputSha256 != null &&
      fixedTimeHexEquals(dto.outputSha256, terminalReplay.expectedOutputSha256);
    return {
      valid:
        capabilityEgressValid &&
        brokerEgressValid &&
        brokerContractValid &&
        uncertainEgressValid &&
        (dto.outputSha256 == null || digestOnlyTerminalReplay) &&
        brokerExternalEgressBytes >= minimumBrokerPayloadBytes &&
        totalExternalEgressBytes <= maximumEgress,
      outputBytes: 0n,
      outputSha256: dto.outputSha256?.toUpperCase() ?? null,
      capabilityExternalEgressBytes,
      brokerExternalEgressBytes,
      uncertainExternalEgressBytes,
      minimumBrokerPayloadBytes,
      brokerContractValid,
      totalExternalEgressBytes,
    };
  }
  const outputBytes = BigInt(Buffer.byteLength(dto.outputJson, 'utf8'));
  const digest = sha256Hex(dto.outputJson);
  let jsonValid = true;
  try {
    JSON.parse(dto.outputJson);
  } catch {
    jsonValid = false;
  }
  return {
    valid:
      jsonValid &&
      capabilityEgressValid &&
      brokerEgressValid &&
      brokerContractValid &&
      uncertainEgressValid &&
      dto.outputSha256 != null &&
      fixedTimeHexEquals(digest, dto.outputSha256) &&
      brokerExternalEgressBytes >= minimumBrokerPayloadBytes &&
      totalExternalEgressBytes <= maximumEgress,
    outputBytes,
    outputSha256: digest,
    capabilityExternalEgressBytes,
    brokerExternalEgressBytes,
    uncertainExternalEgressBytes,
    minimumBrokerPayloadBytes,
    brokerContractValid,
    totalExternalEgressBytes,
  };
}

export function resultReceiptDigest(
  dto: ActionResultDto,
  outcome: string,
  replayBinding?: { reportedOutputJsonSha256: string },
  egressEvidenceDigest?: string | null,
): string {
  return jsonSha256({
    actionId: dto.actionId,
    taskId: dto.taskId,
    stepId: dto.stepId,
    actionTokenSha256: dto.actionTokenSha256.toLowerCase(),
    egressEvidenceSha256: egressEvidenceDigest ?? null,
    outcome,
    outputSha256: dto.outputSha256?.toUpperCase() ?? null,
    reportedOutputJsonSha256:
      replayBinding?.reportedOutputJsonSha256 ??
      (dto.outputJson == null ? null : sha256Hex(dto.outputJson)),
    mutationCommitted: dto.mutationCommitted,
    outcomeUncertain: dto.outcomeUncertain,
    errorCode: dto.errorCode ?? null,
    journalPrepareSequence: dto.journalPrepareSequence ?? null,
    journalPrepareEntryHash: dto.journalPrepareEntryHash?.toUpperCase() ?? null,
    journalPreparePreviousHash: dto.journalPreparePreviousHash?.toUpperCase() ?? null,
    ...(dto.journalRecoveryPreparedSequence != null
      ? { journalRecoveryPreparedSequence: dto.journalRecoveryPreparedSequence }
      : {}),
    ...(dto.journalRecoveryPreparedEntryHash != null
      ? {
          journalRecoveryPreparedEntryHash: dto.journalRecoveryPreparedEntryHash.toUpperCase(),
        }
      : {}),
    ...(dto.journalRecoveryPreparedPreviousHash != null
      ? {
          journalRecoveryPreparedPreviousHash:
            dto.journalRecoveryPreparedPreviousHash.toUpperCase(),
        }
      : {}),
    journalSequence: dto.journalSequence ?? null,
    journalEntryHash: dto.journalEntryHash?.toUpperCase() ?? null,
    journalPreviousHash: dto.journalPreviousHash?.toUpperCase() ?? null,
    preStateSha256: dto.preStateSha256?.toUpperCase() ?? null,
    recoveryProvenanceSha256: dto.recoveryProvenanceSha256?.toUpperCase() ?? null,
    recoveryHandleSha256: dto.recoveryHandleSha256?.toUpperCase() ?? null,
    localBytesRead: dto.localBytesRead,
    localBytesWritten: dto.localBytesWritten,
    externalEgressBytes: dto.externalEgressBytes,
    brokerExternalEgressBytes: dto.brokerExternalEgressBytes,
    brokerMaxDeliverySessions: dto.brokerMaxDeliverySessions,
    brokerMaxRequestAttemptsPerSession: dto.brokerMaxRequestAttemptsPerSession,
    brokerSerializedResultUpperBoundBytes: dto.brokerSerializedResultUpperBoundBytes,
    uncertainExternalEgressBytes: dto.uncertainExternalEgressBytes,
    provenance: dto.provenance.map((item) => ({
      sourceType: item.sourceType,
      sourceIdentifierHash: item.sourceIdentifierHash.toUpperCase(),
      contentSha256: item.contentSha256.toUpperCase(),
      trust: item.trust,
      observedAt: item.observedAt,
    })),
  });
}

function validateLocalUsage(
  dto: ActionResultDto,
  maximumLocalBytes: bigint,
): { valid: boolean; bytesRead: bigint; bytesWritten: bigint } {
  if (
    !Number.isSafeInteger(dto.localBytesRead) ||
    dto.localBytesRead < 0 ||
    !Number.isSafeInteger(dto.localBytesWritten) ||
    dto.localBytesWritten < 0
  ) {
    return { valid: false, bytesRead: 0n, bytesWritten: 0n };
  }
  const bytesRead = BigInt(dto.localBytesRead);
  const bytesWritten = BigInt(dto.localBytesWritten);
  return {
    valid: bytesRead + bytesWritten <= maximumLocalBytes,
    bytesRead,
    bytesWritten,
  };
}

/**
 * A new action may start only from the exact highest terminal head already
 * accepted centrally. A stale predecessor is useful reconciliation evidence,
 * but it is not authority to extend the chain with another action.
 */
export function heartbeatMatchesAcceptedJournal(
  runtimeSequence: number,
  runtimeHead: string,
  accepted: {
    journalPrepareSequence: number | null;
    journalPreparePreviousHash: string | null;
    journalPrepareHash: string | null;
    journalSequence: number | null;
    journalHash: string | null;
  },
): boolean {
  if (
    !Number.isSafeInteger(runtimeSequence) ||
    runtimeSequence < 0 ||
    !isSha256Hex(runtimeHead) ||
    accepted.journalSequence == null ||
    accepted.journalHash == null
  ) {
    return false;
  }
  return (
    runtimeSequence === accepted.journalSequence &&
    fixedTimeHexEquals(runtimeHead, accepted.journalHash)
  );
}

/**
 * Same-action redelivery may observe the predecessor, prepared, optional
 * recovery-prepared, or terminal slot.
 */
export function heartbeatMatchesActiveActionJournal(
  runtimeSequence: number,
  runtimeHead: string,
  expectedPreviousSequence: number,
  expectedPreviousHash: string,
): boolean {
  if (
    !Number.isSafeInteger(runtimeSequence) ||
    !Number.isSafeInteger(expectedPreviousSequence) ||
    runtimeSequence < 0 ||
    expectedPreviousSequence < 0 ||
    !isSha256Hex(runtimeHead) ||
    !isSha256Hex(expectedPreviousHash)
  ) {
    return false;
  }
  if (runtimeSequence === expectedPreviousSequence) {
    return fixedTimeHexEquals(runtimeHead, expectedPreviousHash);
  }
  return (
    (runtimeSequence === expectedPreviousSequence + 1 ||
      runtimeSequence === expectedPreviousSequence + 2 ||
      runtimeSequence === expectedPreviousSequence + 3) &&
    !fixedTimeHexEquals(runtimeHead, expectedPreviousHash)
  );
}

/**
 * Once Started progress crossed the broker, an idle companion may receive a
 * new generation only after its journal proves that execution reached the
 * terminal slot. The first observed head is pinned on the active row. A pinned
 * +2 head may be a RecoveryPrepared checkpoint, so it may advance exactly once
 * to the +3 terminal head. All other later sessions must report the pinned head.
 */
export function heartbeatMatchesRunningTerminalJournal(
  runtimeSequence: number,
  runtimeHead: string,
  expectedPreviousSequence: number,
  expectedPreviousHash: string,
  observedTerminalSequence?: number | null,
  observedTerminalHash?: string | null,
): boolean {
  if (
    !Number.isSafeInteger(runtimeSequence) ||
    !Number.isSafeInteger(expectedPreviousSequence) ||
    expectedPreviousSequence < 0 ||
    (runtimeSequence !== expectedPreviousSequence + 2 &&
      runtimeSequence !== expectedPreviousSequence + 3) ||
    !isSha256Hex(runtimeHead) ||
    !isSha256Hex(expectedPreviousHash) ||
    fixedTimeHexEquals(runtimeHead, expectedPreviousHash)
  ) {
    return false;
  }
  if ((observedTerminalSequence == null) !== (observedTerminalHash == null)) return false;
  if (observedTerminalSequence == null || observedTerminalHash == null) return true;
  if (
    observedTerminalSequence === runtimeSequence &&
    isSha256Hex(observedTerminalHash) &&
    fixedTimeHexEquals(runtimeHead, observedTerminalHash)
  ) {
    return true;
  }
  return (
    observedTerminalSequence === expectedPreviousSequence + 2 &&
    runtimeSequence === expectedPreviousSequence + 3 &&
    isSha256Hex(observedTerminalHash) &&
    !fixedTimeHexEquals(observedTerminalHash, expectedPreviousHash) &&
    !fixedTimeHexEquals(runtimeHead, observedTerminalHash)
  );
}

export function validateJournalReceipt(
  dto: ActionResultDto,
  outcome: string,
  runtime: Record<string, unknown> | null,
  expectedPreviousHash?: string | null,
  expectedPreviousSequence?: number | null,
): { valid: boolean; reconciliation: string } {
  const parts = [
    dto.journalPrepareSequence,
    dto.journalPrepareEntryHash,
    dto.journalPreparePreviousHash,
    dto.journalSequence,
    dto.journalEntryHash,
    dto.journalPreviousHash,
  ];
  const recoveryPreparedParts = [
    dto.journalRecoveryPreparedSequence,
    dto.journalRecoveryPreparedEntryHash,
    dto.journalRecoveryPreparedPreviousHash,
  ];
  const present = parts.filter((part) => part != null).length;
  const recoveryPreparedPresent = recoveryPreparedParts.filter((part) => part != null).length;
  if (present === 0 && recoveryPreparedPresent === 0) {
    return outcome === 'AlreadyRunning'
      ? { valid: true, reconciliation: 'NOT_APPLICABLE' }
      : { valid: false, reconciliation: 'MISSING' };
  }
  if (
    present !== parts.length ||
    (recoveryPreparedPresent !== 0 && recoveryPreparedPresent !== recoveryPreparedParts.length)
  ) {
    return { valid: false, reconciliation: 'INCOMPLETE' };
  }

  const prepareSequence = dto.journalPrepareSequence!;
  const prepareHash = dto.journalPrepareEntryHash!;
  const preparePreviousHash = dto.journalPreparePreviousHash!;
  const sequence = dto.journalSequence!;
  const entryHash = dto.journalEntryHash!;
  const previousHash = dto.journalPreviousHash!;
  const hasRecoveryPrepared = recoveryPreparedPresent === recoveryPreparedParts.length;
  const recoveryPreparedSequence = dto.journalRecoveryPreparedSequence;
  const recoveryPreparedHash = dto.journalRecoveryPreparedEntryHash;
  const recoveryPreparedPreviousHash = dto.journalRecoveryPreparedPreviousHash;
  const chainHeads = [
    preparePreviousHash,
    prepareHash,
    ...(hasRecoveryPrepared ? [recoveryPreparedHash!] : []),
    entryHash,
  ];
  if (
    !Number.isSafeInteger(prepareSequence) ||
    prepareSequence < 1 ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence !== prepareSequence + (hasRecoveryPrepared ? 2 : 1) ||
    !(hasRecoveryPrepared
      ? Number.isSafeInteger(recoveryPreparedSequence) &&
        recoveryPreparedSequence === prepareSequence + 1 &&
        fixedTimeHexEquals(recoveryPreparedPreviousHash!, prepareHash) &&
        fixedTimeHexEquals(previousHash, recoveryPreparedHash!) &&
        !fixedTimeHexEquals(recoveryPreparedHash!, recoveryPreparedPreviousHash!)
      : fixedTimeHexEquals(previousHash, prepareHash)) ||
    fixedTimeHexEquals(prepareHash, preparePreviousHash) ||
    fixedTimeHexEquals(entryHash, previousHash) ||
    !pairwiseDistinctSha256(chainHeads) ||
    (expectedPreviousSequence != null && prepareSequence !== expectedPreviousSequence + 1) ||
    (expectedPreviousHash != null && !fixedTimeHexEquals(expectedPreviousHash, preparePreviousHash))
  ) {
    return { valid: false, reconciliation: 'INVALID' };
  }

  const runtimeSequence = runtime?.journalSequence;
  const runtimeHead = runtime?.journalHeadHash;
  if (
    typeof runtimeSequence !== 'number' ||
    !Number.isSafeInteger(runtimeSequence) ||
    typeof runtimeHead !== 'string'
  ) {
    return { valid: false, reconciliation: 'HEARTBEAT_MISSING' };
  }
  if (runtimeSequence === prepareSequence - 1) {
    return fixedTimeHexEquals(runtimeHead, preparePreviousHash)
      ? { valid: true, reconciliation: 'PREPARE_PREDECESSOR_CONFIRMED' }
      : { valid: false, reconciliation: 'PREDECESSOR_MISMATCH' };
  }
  if (runtimeSequence === prepareSequence) {
    return fixedTimeHexEquals(runtimeHead, prepareHash)
      ? { valid: true, reconciliation: 'PREPARE_CONFIRMED' }
      : { valid: false, reconciliation: 'PREPARE_MISMATCH' };
  }
  if (hasRecoveryPrepared && runtimeSequence === recoveryPreparedSequence) {
    return fixedTimeHexEquals(runtimeHead, recoveryPreparedHash!)
      ? { valid: true, reconciliation: 'RECOVERY_PREPARE_CONFIRMED' }
      : { valid: false, reconciliation: 'RECOVERY_PREPARE_MISMATCH' };
  }
  if (runtimeSequence === sequence) {
    return fixedTimeHexEquals(runtimeHead, entryHash)
      ? { valid: true, reconciliation: 'ENTRY_CONFIRMED' }
      : { valid: false, reconciliation: 'ENTRY_MISMATCH' };
  }
  return runtimeSequence > sequence
    ? { valid: false, reconciliation: 'LATER_HEAD_UNPROVEN' }
    : { valid: false, reconciliation: 'JOURNAL_GAP' };
}

function pairwiseDistinctSha256(values: readonly string[]): boolean {
  return (
    values.every(isSha256Hex) &&
    new Set(values.map((value) => value.toUpperCase())).size === values.length
  );
}

export function classifyHostResult(input: {
  outcome: string;
  mutation: boolean;
  mutationCommitted: boolean;
  outcomeUncertain: boolean;
  protocolInvalid: boolean;
  forceNeedsAttention?: boolean;
}): {
  needsAttention: boolean;
  nextAction: MsaidiziHostActionStatus;
  nextStep: MsaidiziTaskStepStatus;
  nextAttempt: MsaidiziToolAttemptStatus;
} {
  const needsAttention =
    input.outcome === 'NeedsAttention' ||
    input.outcomeUncertain ||
    input.forceNeedsAttention === true ||
    (input.mutation && input.protocolInvalid) ||
    (input.mutation && input.mutationCommitted && input.outcome !== 'Completed');
  const effectiveOutcome = input.protocolInvalid && !input.mutation ? 'Failed' : input.outcome;
  return {
    needsAttention,
    nextAction: needsAttention
      ? MsaidiziHostActionStatus.UNKNOWN
      : effectiveOutcome === 'Completed'
        ? MsaidiziHostActionStatus.SUCCEEDED
        : effectiveOutcome === 'Cancelled'
          ? MsaidiziHostActionStatus.CANCELLED
          : MsaidiziHostActionStatus.FAILED,
    nextStep: needsAttention
      ? MsaidiziTaskStepStatus.NEEDS_ATTENTION
      : effectiveOutcome === 'Completed'
        ? MsaidiziTaskStepStatus.SUCCEEDED
        : effectiveOutcome === 'Cancelled'
          ? MsaidiziTaskStepStatus.CANCELLED
          : MsaidiziTaskStepStatus.FAILED,
    nextAttempt: needsAttention
      ? MsaidiziToolAttemptStatus.UNKNOWN
      : effectiveOutcome === 'Completed'
        ? MsaidiziToolAttemptStatus.SUCCEEDED
        : effectiveOutcome === 'Cancelled'
          ? MsaidiziToolAttemptStatus.CANCELLED
          : MsaidiziToolAttemptStatus.FAILED,
  };
}

function receiptDigestOf(value: Prisma.JsonValue | null): string | null {
  return jsonString(asJsonObject(value), 'receiptDigest');
}

function hostActionLeaseGenerationMatchesReceipt(
  action: {
    leaseId: string | null;
    leaseFencingToken: bigint | null;
    leaseAuthorizationExpiresAt: Date | null;
  },
  receipt: { leaseId?: string; fencingToken?: string; leaseExpiresAt?: string },
): boolean {
  const receiptExpiry = receipt.leaseExpiresAt ? Date.parse(receipt.leaseExpiresAt) : Number.NaN;
  return (
    action.leaseId != null &&
    action.leaseFencingToken != null &&
    action.leaseAuthorizationExpiresAt != null &&
    receipt.leaseId === action.leaseId &&
    receipt.fencingToken === action.leaseFencingToken.toString() &&
    Number.isFinite(receiptExpiry) &&
    receiptExpiry === action.leaseAuthorizationExpiresAt.getTime()
  );
}

function interruptedActionAcceptsLateEvidence(action: {
  status: MsaidiziHostActionStatus;
  uncertainOutcome: boolean;
  errorCode: string | null;
  resultSummary: Prisma.JsonValue | null;
}): boolean {
  const summary = asJsonObject(action.resultSummary);
  return (
    action.status === MsaidiziHostActionStatus.UNKNOWN &&
    action.uncertainOutcome &&
    action.errorCode != null &&
    LATE_RECOVERY_EVIDENCE_ERROR_CODES.has(action.errorCode) &&
    summary.crossedDeviceBoundary === true &&
    receiptDigestOf(action.resultSummary) === null
  );
}

function manifestRuntime(value: Prisma.JsonValue): Record<string, unknown> | null {
  const runtime = asJsonObject(value).runtime;
  return runtime && typeof runtime === 'object' && !Array.isArray(runtime)
    ? (runtime as Record<string, unknown>)
    : null;
}

function manifestCommandProtocolVersion(value: Prisma.JsonValue): number {
  const candidate = asJsonObject(value).commandProtocolVersion;
  return typeof candidate === 'number' && Number.isSafeInteger(candidate) ? candidate : 1;
}

function freshRuntime(
  runtime: Record<string, unknown>,
  maximumAgeSeconds: number,
  observedAt: Date | number = Date.now(),
): boolean {
  const receivedAt = runtime.receivedAt;
  if (typeof receivedAt !== 'string') return false;
  const timestamp = Date.parse(receivedAt);
  const observedAtMs = observedAt instanceof Date ? observedAt.getTime() : observedAt;
  if (!Number.isFinite(timestamp) || !Number.isFinite(observedAtMs)) return false;
  const ageMilliseconds = observedAtMs - timestamp;
  return ageMilliseconds >= 0 && ageMilliseconds <= maximumAgeSeconds * 1_000;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function persistedJsonObject(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(sanitizePersistedValue(value).value)) as Prisma.InputJsonObject;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function jsonString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : null;
}

function isSha256Hex(value: string | null): value is string {
  return value !== null && /^[0-9a-fA-F]{64}$/.test(value);
}

function expectedPreStateDigest(value: Prisma.JsonValue): string | null {
  const digest = jsonString(asJsonObject(value), 'sha256');
  return isSha256Hex(digest) ? digest.toUpperCase() : null;
}

function pairingInitiator(value: Prisma.JsonValue): string | null {
  const pairing = asJsonObject(value).pairing;
  return pairing && typeof pairing === 'object' && !Array.isArray(pairing)
    ? jsonString(pairing as Record<string, unknown>, 'initiatedByUserId')
    : null;
}

function fixedTimeStringEquals(left: string, right: string): boolean {
  const leftDigest = sha256Hex(left);
  const rightDigest = sha256Hex(right);
  return fixedTimeHexEquals(leftDigest, rightDigest);
}

function taskSessionId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '')}`;
}

function formatPairingCode(hex: string): string {
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function formatEnrollmentCode(hex: string): string {
  return hex.match(/.{1,4}/g)?.join('-') ?? hex;
}

async function lockSupervisorEnrollment(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(815739224016733114)`;
}

function supervisorIdentityForRole(
  device: {
    updateSupervisorCertificateSha256: string | null;
    updateSupervisorPublicKeySpkiSha256: string | null;
    recoverySupervisorCertificateSha256: string | null;
    recoverySupervisorPublicKeySpkiSha256: string | null;
  },
  role: 'UPDATE' | 'RECOVERY',
): { certificateSha256: string | null; publicKeySpkiSha256: string | null } {
  return role === 'UPDATE'
    ? {
        certificateSha256: device.updateSupervisorCertificateSha256,
        publicKeySpkiSha256: device.updateSupervisorPublicKeySpkiSha256,
      }
    : {
        certificateSha256: device.recoverySupervisorCertificateSha256,
        publicKeySpkiSha256: device.recoverySupervisorPublicKeySpkiSha256,
      };
}

function publicKeySpkiDigest(publicKeyPem: string): string | null {
  try {
    const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return sha256Hex(der);
  } catch {
    // PENDING devices store an HMAC marker instead of a public key.
    return null;
  }
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new HostActionPolicyError('HOST_BUDGET_NOT_JSON_SAFE');
  }
  return result;
}

function normalisePublicKey(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function authenticatedDeviceIdentity(device: {
  certificateThumbprint: string | null;
  publicKey: string;
}): AuthenticatedDeviceIdentity | null {
  if (!isSha256Hex(device.certificateThumbprint) || typeof device.publicKey !== 'string')
    return null;
  return {
    certificateThumbprint: device.certificateThumbprint,
    publicKeySha256: sha256Hex(normalisePublicKey(device.publicKey)),
  };
}

function peerMatchesStoredDevice(
  device: { certificateThumbprint: string | null; publicKey: string },
  peer: { certificateSha256: string; publicKeySha256: string },
): boolean {
  return (
    typeof device.certificateThumbprint === 'string' &&
    fixedTimeHexEquals(device.certificateThumbprint, peer.certificateSha256) &&
    fixedTimeHexEquals(sha256Hex(normalisePublicKey(device.publicKey)), peer.publicKeySha256)
  );
}

function pingCommand(): DeviceCommand {
  return { kind: 'ping', correlationId: randomUUID(), sentAt: new Date().toISOString() };
}

function safeDevice(device: {
  id: string;
  name: string;
  status: MsaidiziDeviceStatus;
  platform: string;
  osVersion: string | null;
  architecture: string | null;
  certificateThumbprint: string | null;
  pairedAt: Date | null;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  killedAt: Date | null;
}) {
  return {
    id: device.id,
    name: device.name,
    status: device.status,
    platform: device.platform,
    osVersion: device.osVersion,
    architecture: device.architecture,
    certificateThumbprint: device.certificateThumbprint,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    killedAt: device.killedAt,
  };
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
