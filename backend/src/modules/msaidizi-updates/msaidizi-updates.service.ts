import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuditChannel,
  AuditSeverity,
  MsaidiziDeviceStatus,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateDeploymentOperation,
  MsaidiziUpdateDeploymentStatus,
  MsaidiziUpdateEvaluationAttestationKind,
  MsaidiziUpdateEvaluationRunStatus,
  MsaidiziUpdateEvaluationVerdict,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  companyWhereForUser,
  isGroupScopedUser,
} from '../../common/services/company-scope.service';
import {
  redactPersistedSecrets,
  sanitizePersistedValue,
} from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { directMtlsPeer } from '../msaidizi-devices/direct-mtls-peer';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import {
  AckMsaidiziUpdateDeploymentDto,
  CreateMsaidiziUpdateCandidateDto,
  MsaidiziUpdateProgressDto,
  MsaidiziUpdateResultDto,
  PollMsaidiziUpdateDeploymentsDto,
  QueryMsaidiziUpdateCandidateDto,
  ReportMsaidiziUpdateHealthDto,
  RolloutMsaidiziUpdateDto,
  SubmitMsaidiziUpdateEvaluationDto,
} from './dto/msaidizi-update.dto';
import { MsaidiziUpdateManifestSigner } from './msaidizi-update-manifest-signer.service';
import {
  assertUpdateCandidateProposalStep,
  isGeneratedUpdateCandidateProposal,
  mandateAuthorizesUpdateCandidateProposal,
} from './update-candidate-proposal.port';
import {
  attestationBundleDigest,
  canonicalAttestationJson,
  parseEvaluationRunnerAttestation,
  parseModelReviewAttestation,
} from './msaidizi-evaluator-attestation.protocol';

const PROTECTED_SUPERVISOR_SCOPE =
  /(?:bootstrap|trust.?key|kill.?switch|audit.?signer|recovery.?vault|update.?verif|device.?identity|hardware.?key)/i;

const UPDATE_INCLUDE = {
  proposedByTask: {
    select: { id: true, initiatedByUserId: true, companyId: true, mandateId: true },
  },
  sourceArtifact: { select: { id: true, taskId: true, sha256: true, encrypted: true } },
  rollbackArtifact: { select: { id: true, taskId: true, sha256: true, encrypted: true } },
} satisfies Prisma.MsaidiziUpdateCandidateInclude;

type UpdateDetail = Prisma.MsaidiziUpdateCandidateGetPayload<{ include: typeof UPDATE_INCLUDE }>;

type SupervisorDeployment = Prisma.MsaidiziUpdateDeploymentGetPayload<{
  include: {
    candidate: {
      include: {
        proposedByTask: {
          select: { initiatedByUserId: true; companyId: true; mandateId: true };
        };
      };
    };
  };
}>;

type SignedDeploymentTarget = {
  targetId: string;
  version: string;
  rollbackVersion: string;
  sourceArtifactSha256: string;
  rollbackArtifactSha256: string;
  healthTimeoutSeconds: number;
  minimumHealthySoakSeconds: number;
  minimumRingDwellSeconds: number;
};

type SignedHealthPolicy = Pick<
  SignedDeploymentTarget,
  'healthTimeoutSeconds' | 'minimumHealthySoakSeconds'
>;

type AutomaticEvaluationEvidenceRow = {
  candidateId: string;
  taskId: string;
  planVersionId: string;
  stepId: string;
  kind: MsaidiziUpdateEvaluationAttestationKind;
  signerKeyId: string;
  claimsDigest: string;
  canonicalClaims: Prisma.JsonValue;
  signature: string;
  verdict: MsaidiziUpdateEvaluationVerdict;
  evaluationRunId: string;
  cleanSnapshotId: string;
  sourceArtifactId: string;
  sourceArtifactSha256: string;
  rollbackArtifactId: string;
  rollbackArtifactSha256: string;
  reportArtifactId: string;
  reportArtifactSha256: string;
  runnerClaimsDigest: string | null;
  reviewerId: string | null;
  modelId: string | null;
};

const NEXT_AUTOMATIC_RING = new Map<number, 5 | 25 | 100>([
  [0, 5],
  [5, 25],
  [25, 100],
]);

const RETRYABLE_RECOVERY_ERROR_CODES = [
  'TRUSTED_SIGNER_UNAVAILABLE',
  'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED',
] as const;

export type AutomaticRolloutSweepResult = {
  scanned: number;
  queued: number;
  skippedEmpty: number;
  pending: number;
  disabled: boolean;
};

export type UpdateRecoverySweepResult = {
  scanned: number;
  queued: number;
  pending: number;
  disabled: boolean;
};

/**
 * Ledger/state boundary for autonomous improvement candidates.
 *
 * This service never deploys bytes itself. A separately trusted rollout runner
 * consumes APPROVED/CANARY records, verifies the artifact digests, and reports
 * health here. Keeping deployment out of this process prevents a candidate from
 * replacing its own verifier or fabricating a successful rollback.
 */
@Injectable()
export class MsaidiziUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly signer: MsaidiziUpdateManifestSigner,
    @Optional() private readonly autonomy?: AutonomyConfig,
  ) {}

  async create(dto: CreateMsaidiziUpdateCandidateDto, user: AuthUser) {
    if (PROTECTED_SUPERVISOR_SCOPE.test(dto.scope) || PROTECTED_SUPERVISOR_SCOPE.test(dto.name)) {
      throw new BadRequestException('Candidate scope intersects the trusted supervisor boundary');
    }
    if (dto.sourceArtifactId === dto.rollbackArtifactId) {
      throw new BadRequestException('Source and rollback artifacts must be distinct');
    }
    const task = await this.prisma.msaidiziTask.findFirst({
      where: {
        id: dto.proposedByTaskId,
        initiatedByUserId: user.id,
        ...taskCompanyScope(user),
      },
      select: { id: true, principalId: true, companyId: true },
    });
    if (!task) throw new NotFoundException('Proposing task not found');
    const artifacts = await this.prisma.msaidiziArtifact.findMany({
      where: {
        id: { in: [dto.sourceArtifactId, dto.rollbackArtifactId] },
        taskId: task.id,
        encrypted: true,
      },
      select: { id: true },
    });
    if (new Set(artifacts.map((artifact) => artifact.id)).size !== 2) {
      throw new BadRequestException(
        'Source and rollback artifacts must be encrypted task artifacts',
      );
    }

    const candidate = await this.prisma.msaidiziUpdateCandidate.create({
      data: {
        principalId: task.principalId,
        proposedByTaskId: task.id,
        sourceArtifactId: dto.sourceArtifactId,
        rollbackArtifactId: dto.rollbackArtifactId,
        name: redactPersistedSecrets(dto.name.trim()),
        version: redactPersistedSecrets(dto.version.trim()),
        rollbackVersion: redactPersistedSecrets(dto.rollbackVersion.trim()),
        scope: redactPersistedSecrets(dto.scope.trim()),
        evaluationSummary: {},
        reviewerDecisions: [],
      },
      include: UPDATE_INCLUDE,
    });
    await this.writeAudit('MSAIDIZI_UPDATE_CANDIDATE_CREATE', candidate, user, task.companyId);
    return jsonSafe(candidate);
  }

  async list(query: QueryMsaidiziUpdateCandidateDto, user: AuthUser) {
    return jsonSafe(
      await this.prisma.msaidiziUpdateCandidate.findMany({
        where: {
          proposedByTask: {
            initiatedByUserId: user.id,
            ...taskCompanyScope(user),
          },
          ...(query.status ? { status: query.status } : {}),
        },
        include: UPDATE_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async findOne(id: string, user: AuthUser) {
    return jsonSafe(await this.findScoped(id, user));
  }

  async submitEvaluation(id: string, dto: SubmitMsaidiziUpdateEvaluationDto, user: AuthUser) {
    await this.findScoped(id, user);
    void dto;
    throw new ServiceUnavailableException(
      'Update evaluation is disabled until signed, verifier-bound evaluator attestations are implemented',
    );
  }

  async rollout(id: string, dto: RolloutMsaidiziUpdateDto, user: AuthUser) {
    const candidate = await this.findScoped(id, user);
    // The persisted mandate plus deployment-owned policy are the authority.
    // Keep the legacy flag as a compatible request hint, but never require it
    // and never let it enable progression when external policy is closed.
    if (
      dto.ring === 0 &&
      (dto.automaticProgression === true || this.automaticProgressionAvailable)
    ) {
      return this.armAutomaticRollout(candidate, dto);
    }
    if (candidate.automaticProgressionEnabled) {
      throw new ConflictException(
        'Manual rollout is unavailable while automatic progression is armed',
      );
    }
    const allowed =
      (candidate.status === MsaidiziUpdateCandidateStatus.APPROVED && dto.ring === 0) ||
      (candidate.status === MsaidiziUpdateCandidateStatus.CANARY &&
        dto.ring > candidate.rolloutRing &&
        [5, 25, 100].includes(dto.ring));
    if (!allowed) throw new ConflictException('Invalid or non-monotonic rollout ring transition');
    if (dto.ring > 0) await this.assertSupervisorRingSucceeded(candidate.id, candidate.rolloutRing);

    this.signer.assertReady();
    const devices = await this.selectRingDevices(candidate.id, dto.ring, dto.deviceIds);
    const deployments = await this.queueDeployments(
      candidate,
      devices,
      dto.ring as 0 | 5 | 25 | 100,
      MsaidiziUpdateDeploymentOperation.APPLY,
    );
    await this.writeAudit('MSAIDIZI_UPDATE_ROLLOUT_QUEUED', candidate, user);
    return jsonSafe({ candidate, deployments });
  }

  /**
   * Restart-safe, bounded sweep used only by the deployment-owned coordinator.
   * A candidate row lock plus the immutable deployment uniqueness key makes
   * concurrent backend instances converge without issuing duplicate commands.
   */
  async advanceAutomaticRollouts(limit = 10): Promise<AutomaticRolloutSweepResult> {
    const result: AutomaticRolloutSweepResult = {
      scanned: 0,
      queued: 0,
      skippedEmpty: 0,
      pending: 0,
      disabled: !this.automaticProgressionAvailable,
    };
    if (result.disabled) return result;
    this.signer.assertReady();

    const candidates = await this.prisma.msaidiziUpdateCandidate.findMany({
      where: {
        principal: { status: MsaidiziPrincipalStatus.ACTIVE },
        OR: [
          {
            automaticProgressionEnabled: false,
            status: MsaidiziUpdateCandidateStatus.APPROVED,
            rolloutRing: 0,
          },
          {
            automaticProgressionEnabled: true,
            status: MsaidiziUpdateCandidateStatus.CANARY,
            rolloutRing: { in: [...NEXT_AUTOMATIC_RING.keys(), 100] },
          },
        ],
      },
      select: { id: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: Math.max(1, Math.min(limit, 100)),
    });
    result.scanned = candidates.length;

    for (const { id: candidateId } of candidates) {
      const outcome = await this.advanceAutomaticCandidate(candidateId);
      if (outcome === 'queued') result.queued += 1;
      else if (outcome === 'skipped-empty') result.skippedEmpty += 1;
      else result.pending += 1;
    }
    return result;
  }

  /**
   * Drains only the durable rollback-signing outbox. It may retry command
   * creation because no host mutation exists before a signed deployment is
   * committed; existing/uncertain deployment commands are always reused.
   */
  async advancePendingRecoveries(limit = 10): Promise<UpdateRecoverySweepResult> {
    const result: UpdateRecoverySweepResult = {
      scanned: 0,
      queued: 0,
      pending: 0,
      disabled: false,
    };
    try {
      this.signer.assertReady();
    } catch {
      result.disabled = true;
      return result;
    }
    const candidates = await this.prisma.msaidiziUpdateCandidate.findMany({
      where: {
        recoveryPending: true,
        recoveryLastErrorCode: { in: [...RETRYABLE_RECOVERY_ERROR_CODES] },
        status: MsaidiziUpdateCandidateStatus.FAILED,
        principal: { status: MsaidiziPrincipalStatus.ACTIVE },
      },
      select: { id: true },
      orderBy: [{ recoveryRequestedAt: 'asc' }, { id: 'asc' }],
      take: Math.max(1, Math.min(limit, 100)),
    });
    result.scanned = candidates.length;
    for (const { id } of candidates) {
      try {
        const queued = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${id} FOR UPDATE`;
          const candidate = await tx.msaidiziUpdateCandidate.findUnique({
            where: { id },
            include: UPDATE_INCLUDE,
          });
          if (
            !candidate ||
            !candidate.recoveryPending ||
            candidate.status !== MsaidiziUpdateCandidateStatus.FAILED
          ) {
            return false;
          }
          const recoverSucceededPeers =
            candidate.recoveryLastErrorCode === 'DEVICE_DISABLED_APPLY_PEER_RECOVERY_REQUIRED';
          const source = await tx.msaidiziUpdateDeployment.findFirst({
            where: {
              candidateId: id,
              operation: MsaidiziUpdateDeploymentOperation.APPLY,
              resultDigest: { not: null },
              status: recoverSucceededPeers
                ? MsaidiziUpdateDeploymentStatus.SUCCEEDED
                : {
                    in: [
                      MsaidiziUpdateDeploymentStatus.FAILED,
                      MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
                      MsaidiziUpdateDeploymentStatus.ROLLED_BACK,
                    ],
                  },
            },
            include: {
              candidate: {
                include: {
                  proposedByTask: {
                    select: { initiatedByUserId: true, companyId: true, mandateId: true },
                  },
                },
              },
            },
            orderBy: [{ ring: 'desc' }, { completedAt: 'desc' }, { id: 'asc' }],
          });
          if (!source) {
            throw new ConflictException('Recovery outbox has no terminal APPLY evidence');
          }
          const wave = await this.queueAutomaticRollbackDeployments(
            tx,
            source,
            source.status === MsaidiziUpdateDeploymentStatus.ROLLED_BACK
              ? source.deviceId
              : undefined,
          );
          const now = new Date();
          const rollbackProved = wave.unprovenDeviceCount === 0;
          await tx.msaidiziUpdateCandidate.update({
            where: { id },
            data: {
              status: rollbackProved
                ? MsaidiziUpdateCandidateStatus.ROLLED_BACK
                : MsaidiziUpdateCandidateStatus.FAILED,
              recoveryPending: wave.unavailableDeviceCount > 0,
              recoveryRequestedAt: wave.unavailableDeviceCount > 0 ? now : null,
              recoveryLastAttemptAt: now,
              recoveryLastErrorCode:
                wave.unavailableDeviceCount > 0 ? 'RECOVERY_TARGET_UNAVAILABLE' : null,
              healthSummary: persistedJson({
                ...jsonObject(candidate.healthSummary),
                rollbackDispatchPending: false,
                rollbackInProgress: !rollbackProved,
                requiredRollbackDevices: wave.requiredDeviceCount,
                queuedRollbackDeployments: wave.newlyQueuedCount,
                remainingRollbackDevices: wave.unprovenDeviceCount,
                unavailableRollbackDevices: wave.unavailableDeviceCount,
                unavailableRollbackDeviceSetSha256: wave.unavailableDeviceSetSha256,
                recoveryDispatchedAt: now.toISOString(),
              }),
              ...(rollbackProved ? { rolledBackAt: now } : {}),
            },
          });
          await this.writeAutomaticProgressionAudit(
            tx,
            candidate,
            'MSAIDIZI_UPDATE_RECOVERY_DISPATCHED',
            {
              sourceDeploymentId: source.id,
              requiredDeviceCount: wave.requiredDeviceCount,
              newlyQueuedCount: wave.newlyQueuedCount,
              unprovenDeviceCount: wave.unprovenDeviceCount,
              dispatchedAt: now.toISOString(),
            },
          );
          return true;
        });
        if (queued) result.queued += 1;
        else result.pending += 1;
      } catch (error) {
        result.pending += 1;
        const now = new Date();
        await this.prisma.msaidiziUpdateCandidate.updateMany({
          where: { id, recoveryPending: true },
          data: {
            recoveryLastAttemptAt: now,
            recoveryLastErrorCode: recoveryErrorCode(error),
          },
        });
      }
    }
    return result;
  }

  async reportHealth(id: string, dto: ReportMsaidiziUpdateHealthDto, user: AuthUser) {
    await this.findScoped(id, user);
    void dto;
    throw new BadRequestException(
      'Deployment health is accepted only from the mTLS-bound trusted update supervisor',
    );
  }

  private get automaticProgressionAvailable(): boolean {
    return (
      this.signer.automaticRolloutEnabled === true &&
      this.signer.automaticRolloutMaximumRing >= 0 &&
      this.autonomy?.enabled === true &&
      this.autonomy.autopilotEnabled === true &&
      this.autonomy.globalKillSwitchActive === false
    );
  }

  private async armAutomaticRollout(scopedCandidate: UpdateDetail, dto: RolloutMsaidiziUpdateDto) {
    if (dto.ring !== 0) {
      throw new BadRequestException('Automatic progression can be armed only with ring 0');
    }
    if ((dto.deviceIds?.length ?? 0) > 1) {
      throw new BadRequestException('Automatic ring 0 must contain exactly one workstation');
    }
    if (!this.automaticProgressionAvailable) {
      throw new ServiceUnavailableException(
        'Deployment policy does not permit automatic update progression',
      );
    }
    this.signer.assertReady();

    const armed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${scopedCandidate.id} FOR UPDATE`;
      const candidate = await tx.msaidiziUpdateCandidate.findUnique({
        where: { id: scopedCandidate.id },
        include: UPDATE_INCLUDE,
      });
      if (!candidate) throw new NotFoundException('Update candidate not found');
      const result = await this.armAutomaticCandidateInTransaction(
        tx,
        candidate,
        dto.deviceIds,
        true,
      );
      if (!result) {
        throw new ServiceUnavailableException(
          'Automatic rollout authority became unavailable before ring 0 was queued',
        );
      }
      return result;
    });
    return jsonSafe(armed);
  }

  private async armAutomaticCandidateInTransaction(
    tx: Prisma.TransactionClient,
    candidate: UpdateDetail,
    requestedDeviceIds: readonly string[] | undefined,
    throwOnAuthorityDenied: boolean,
  ): Promise<{ candidate: UpdateDetail; deployments: unknown[] } | null> {
    if (
      candidate.status !== MsaidiziUpdateCandidateStatus.APPROVED ||
      candidate.rolloutRing !== 0 ||
      candidate.automaticProgressionEnabled
    ) {
      if (throwOnAuthorityDenied) {
        throw new ConflictException(
          'Automatic rollout must start from one unarmed approved ring 0',
        );
      }
      return null;
    }
    if (!(await this.lockAndAssertAutomaticQueueAuthority(tx, candidate))) {
      if (throwOnAuthorityDenied) {
        throw new ServiceUnavailableException(
          'Automatic rollout requires current mandate, evaluation, and deployment authority',
        );
      }
      return null;
    }
    const existing = await tx.msaidiziUpdateDeployment.count({
      where: {
        candidateId: candidate.id,
        operation: MsaidiziUpdateDeploymentOperation.APPLY,
      },
    });
    if (existing !== 0) {
      if (throwOnAuthorityDenied) {
        throw new ConflictException('Automatic rollout cannot adopt existing deployment commands');
      }
      return null;
    }

    const cohortObserved = await tx.msaidiziDevice.findMany({
      where: {
        status: { in: [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE] },
      },
      select: { id: true },
    });
    const cohortIds = cohortObserved.map(({ id }) => id).sort();
    if (cohortIds.length === 0) {
      if (throwOnAuthorityDenied) {
        throw new ConflictException('No enrolled update workstation exists');
      }
      return null;
    }
    const cohort = await this.lockAndLoadEligibleDevices(tx, cohortIds, [
      MsaidiziDeviceStatus.ACTIVE,
      MsaidiziDeviceStatus.OFFLINE,
    ]);
    if (!cohort || cohort.length !== cohortIds.length) {
      if (throwOnAuthorityDenied) {
        throw new ConflictException('The update cohort changed while ring 0 was armed');
      }
      return null;
    }

    const requested = requestedDeviceIds ? [...new Set(requestedDeviceIds)] : undefined;
    const active = cohort.filter(({ status }) => status === MsaidiziDeviceStatus.ACTIVE);
    const activeById = new Map(active.map((device) => [device.id, device]));
    if (requested && requested.some((id) => !activeById.has(id))) {
      if (throwOnAuthorityDenied) {
        throw new BadRequestException('The ring-0 workstation must be actively enrolled');
      }
      return null;
    }
    if (active.length === 0) {
      if (throwOnAuthorityDenied) {
        throw new ConflictException('No active enrolled update workstation exists');
      }
      return null;
    }
    const devices = (requested ? requested.map((id) => activeById.get(id)!) : active)
      .sort((left, right) =>
        stableDeviceRank(candidate.id, left.id).localeCompare(
          stableDeviceRank(candidate.id, right.id),
        ),
      )
      .slice(0, 1);
    const healthPolicy: SignedHealthPolicy = {
      healthTimeoutSeconds: this.signer.healthTimeoutSeconds,
      minimumHealthySoakSeconds: this.signer.minimumHealthySoakSeconds,
    };
    const ringDwellPolicy = {
      ring0: this.signer.minimumRingDwellSeconds(0),
      ring5: this.signer.minimumRingDwellSeconds(5),
      ring25: this.signer.minimumRingDwellSeconds(25),
      ring100: this.signer.minimumRingDwellSeconds(100),
    };
    const deployments = await this.queueDeploymentsInTransaction(
      tx,
      candidate,
      devices,
      0,
      MsaidiziUpdateDeploymentOperation.APPLY,
      true,
      healthPolicy,
      ringDwellPolicy.ring0,
    );
    const now = new Date();
    const updated = await tx.msaidiziUpdateCandidate.update({
      where: { id: candidate.id },
      data: {
        automaticProgressionEnabled: true,
        automaticProgressionArmedAt: now,
        automaticProgressionArmedById: candidate.proposedByTask!.initiatedByUserId!,
        automaticProgressionMinimumSoakSeconds: healthPolicy.minimumHealthySoakSeconds,
        automaticProgressionHealthTimeoutSeconds: healthPolicy.healthTimeoutSeconds,
        automaticProgressionRing0DwellSeconds: ringDwellPolicy.ring0,
        automaticProgressionRing5DwellSeconds: ringDwellPolicy.ring5,
        automaticProgressionRing25DwellSeconds: ringDwellPolicy.ring25,
        automaticProgressionRing100DwellSeconds: ringDwellPolicy.ring100,
        automaticProgressionCohortDeviceIds: cohortIds,
        automaticProgressionCohortSha256: deviceSetDigest(cohortIds),
        automaticProgressionCohortCapturedAt: now,
      },
      include: UPDATE_INCLUDE,
    });
    await this.audit.logStrictInTransaction(tx, {
      action: 'MSAIDIZI_UPDATE_AUTOMATIC_ROLLOUT_ARMED',
      entityType: 'MsaidiziUpdateCandidate',
      entityId: candidate.id,
      userId: candidate.proposedByTask!.initiatedByUserId!,
      companyId: candidate.proposedByTask!.companyId ?? null,
      newValue: persistedJson({
        authoritySource: 'ACTIVE_MANDATE_AND_DEPLOYMENT_POLICY',
        mandateId: candidate.proposedByTask!.mandateId,
        configuredMaximumRing: this.signer.automaticRolloutMaximumRing,
        ring: 0,
        deviceIds: devices.map(({ id }) => id),
        targetDeviceSetSha256: deviceSetDigest(devices.map(({ id }) => id)),
        cohortDeviceCount: cohortIds.length,
        cohortDeviceSetSha256: deviceSetDigest(cohortIds),
        cohortCapturedAt: now.toISOString(),
        armedAt: now.toISOString(),
        ...healthPolicy,
        ringDwellPolicy,
      }) as Prisma.InputJsonObject,
      severity: AuditSeverity.CRITICAL,
      channel: AuditChannel.AGENT,
      agentSessionId: candidate.proposedByTaskId
        ? taskSessionId(candidate.proposedByTaskId)
        : undefined,
      principalType: 'MSAIDIZI',
      principalId: candidate.principalId,
      mandateId: candidate.proposedByTask!.mandateId,
      initiatedByUserId: candidate.proposedByTask!.initiatedByUserId!,
      taskId: candidate.proposedByTaskId,
      stepId: candidate.proposedByStepId,
    });
    return { candidate: updated, deployments };
  }

  private async advanceAutomaticCandidate(
    candidateId: string,
  ): Promise<'queued' | 'skipped-empty' | 'pending'> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${candidateId} FOR UPDATE`;
      const candidate = await tx.msaidiziUpdateCandidate.findUnique({
        where: { id: candidateId },
        include: UPDATE_INCLUDE,
      });
      if (
        candidate &&
        candidate.status === MsaidiziUpdateCandidateStatus.APPROVED &&
        !candidate.automaticProgressionEnabled &&
        candidate.rolloutRing === 0
      ) {
        const armed = await this.armAutomaticCandidateInTransaction(
          tx,
          candidate,
          undefined,
          false,
        );
        return armed ? 'queued' : 'pending';
      }
      if (
        !candidate ||
        !candidate.automaticProgressionEnabled ||
        candidate.status !== MsaidiziUpdateCandidateStatus.CANARY
      ) {
        return 'pending';
      }
      if (
        candidate.automaticProgressionMinimumSoakSeconds === null ||
        candidate.automaticProgressionHealthTimeoutSeconds === null
      ) {
        throw new ConflictException('Automatic rollout has no pinned signed health policy');
      }
      const healthPolicy: SignedHealthPolicy = {
        minimumHealthySoakSeconds: candidate.automaticProgressionMinimumSoakSeconds,
        healthTimeoutSeconds: candidate.automaticProgressionHealthTimeoutSeconds,
      };
      if (!this.automaticProgressionAvailable) {
        return 'pending';
      }
      if (candidate.rolloutRing > this.signer.automaticRolloutMaximumRing) return 'pending';
      const cohortIds = automaticCohortDeviceIds(candidate);

      const currentRing = await tx.msaidiziUpdateDeployment.findMany({
        where: {
          candidateId,
          ring: candidate.rolloutRing,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
        },
        select: { id: true, status: true, completedAt: true },
      });
      if (
        (currentRing.length === 0 && !candidate.automaticProgressionRingHealthyAt) ||
        currentRing.some(({ status }) => status !== MsaidiziUpdateDeploymentStatus.SUCCEEDED)
      ) {
        return 'pending';
      }
      const currentDwellSeconds = minimumRingDwellFor(candidate, candidate.rolloutRing);
      const healthyAt = candidate.automaticProgressionRingHealthyAt;
      if (
        !healthyAt ||
        candidate.automaticProgressionRingEvidenceSha256 !==
          automaticRingEvidenceDigest(
            candidate.id,
            candidate.rolloutRing,
            healthyAt,
            candidate.automaticProgressionCohortSha256!,
            currentDwellSeconds,
          ) ||
        Date.now() < healthyAt.getTime() + currentDwellSeconds * 1_000
      ) {
        return 'pending';
      }

      if (candidate.rolloutRing === 100) {
        if (this.signer.automaticRolloutMaximumRing < 100) return 'pending';
        const population = await this.automaticEligiblePopulationEvidence(tx, candidate);
        if (!population.complete) return 'pending';
        if (!(await this.lockAndAssertAutomaticQueueAuthority(tx, candidate))) {
          return 'pending';
        }
        const stabilizedAt = new Date();
        await tx.msaidiziUpdateCandidate.update({
          where: { id: candidate.id },
          data: {
            status: MsaidiziUpdateCandidateStatus.ACTIVE,
            deployedAt: stabilizedAt,
            healthSummary: persistedJson({
              ...jsonObject(candidate.healthSummary),
              automaticProgression: {
                ring: 100,
                stabilized: true,
                healthyAt: healthyAt.toISOString(),
                minimumRingDwellSeconds: currentDwellSeconds,
                ringEvidenceSha256: candidate.automaticProgressionRingEvidenceSha256,
                stabilizedAt: stabilizedAt.toISOString(),
                ...population,
              },
            }),
          },
        });
        await this.writeAutomaticProgressionAudit(
          tx,
          candidate,
          'MSAIDIZI_UPDATE_AUTOMATIC_RING_100_STABILIZED',
          {
            ring: 100,
            healthyAt: healthyAt.toISOString(),
            minimumRingDwellSeconds: currentDwellSeconds,
            ringEvidenceSha256: candidate.automaticProgressionRingEvidenceSha256,
            stabilizedAt: stabilizedAt.toISOString(),
            ...population,
          },
        );
        return 'skipped-empty';
      }

      const nextRing = NEXT_AUTOMATIC_RING.get(candidate.rolloutRing);
      if (!nextRing) return 'pending';
      if (nextRing > this.signer.automaticRolloutMaximumRing) return 'pending';
      const nextRingExisting = await tx.msaidiziUpdateDeployment.findMany({
        where: {
          candidateId,
          ring: nextRing,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
        },
        select: { deviceId: true, status: true },
      });
      // Completed commands are reusable only inside the immutable cohort.
      // Any uncertain, failed, or still-running command closes progression.
      if (
        nextRingExisting.some(({ status }) => status !== MsaidiziUpdateDeploymentStatus.SUCCEEDED)
      ) {
        return 'pending';
      }

      const eligible = await this.lockAndLoadEligibleDevices(tx, cohortIds, [
        MsaidiziDeviceStatus.ACTIVE,
        MsaidiziDeviceStatus.OFFLINE,
      ]);
      // Membership is immutable. A killed/revoked/missing cohort member blocks
      // progression for oversight instead of silently shrinking the denominator.
      if (!eligible || eligible.length !== cohortIds.length) return 'pending';
      const priorSucceeded = await tx.msaidiziUpdateDeployment.findMany({
        where: {
          candidateId,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
          status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
        },
        select: { deviceId: true },
      });
      const eligibleDeviceIds = new Set(eligible.map(({ id }) => id));
      const priorDeviceIds = new Set(
        priorSucceeded
          .map(({ deviceId }) => deviceId)
          .filter((deviceId) => eligibleDeviceIds.has(deviceId)),
      );
      const desiredPopulation = Math.max(1, Math.ceil((eligible.length * nextRing) / 100));
      const requiredNewDevices = Math.max(0, desiredPopulation - priorDeviceIds.size);
      const devices = eligible
        .filter(({ id }) => !priorDeviceIds.has(id))
        .sort((left, right) =>
          stableDeviceRank(candidate.id, left.id).localeCompare(
            stableDeviceRank(candidate.id, right.id),
          ),
        )
        .slice(0, requiredNewDevices);
      const now = new Date();
      const progressionEvidence = {
        fromRing: candidate.rolloutRing,
        toRing: nextRing,
        eligibleDeviceCount: eligible.length,
        previouslySucceededDeviceCount: priorDeviceIds.size,
        desiredPopulation,
        newDeviceCount: devices.length,
        targetDeviceSetSha256: deviceSetDigest(devices.map(({ id }) => id)),
        observedAt: now.toISOString(),
        priorRingHealthyAt: healthyAt.toISOString(),
        priorRingMinimumDwellSeconds: currentDwellSeconds,
        priorRingEvidenceSha256: candidate.automaticProgressionRingEvidenceSha256,
      };

      // Lock the principal row through commit and recheck every deployment-owned
      // safety gate immediately before either queueing work or advancing state.
      // The signer check also re-reads the deployment-owned global kill switch.
      if (!(await this.lockAndAssertAutomaticQueueAuthority(tx, candidate))) {
        return 'pending';
      }

      if (devices.length === 0) {
        if (nextRing === 100 && priorDeviceIds.size !== eligible.length) {
          return 'pending';
        }
        const nextRingDwellSeconds = minimumRingDwellFor(candidate, nextRing);
        const nextRingEvidenceSha256 = automaticRingEvidenceDigest(
          candidate.id,
          nextRing,
          now,
          candidate.automaticProgressionCohortSha256!,
          nextRingDwellSeconds,
        );
        await tx.msaidiziUpdateCandidate.update({
          where: { id: candidate.id },
          data: {
            rolloutRing: nextRing,
            status: MsaidiziUpdateCandidateStatus.CANARY,
            automaticProgressionRingHealthyAt: now,
            automaticProgressionRingEvidenceSha256: nextRingEvidenceSha256,
            healthSummary: persistedJson({
              ...jsonObject(candidate.healthSummary),
              automaticProgression: { ...progressionEvidence, skippedEmptyRing: true },
            }),
          },
        });
        await this.writeAutomaticProgressionAudit(
          tx,
          candidate,
          'MSAIDIZI_UPDATE_AUTOMATIC_RING_SKIPPED',
          progressionEvidence,
        );
        return 'skipped-empty';
      }

      await this.queueDeploymentsInTransaction(
        tx,
        candidate,
        devices,
        nextRing,
        MsaidiziUpdateDeploymentOperation.APPLY,
        true,
        healthPolicy,
        minimumRingDwellFor(candidate, nextRing),
      );
      await this.writeAutomaticProgressionAudit(
        tx,
        candidate,
        'MSAIDIZI_UPDATE_AUTOMATIC_RING_QUEUED',
        progressionEvidence,
      );
      return 'queued';
    });
  }

  private async lockAndAssertAutomaticQueueAuthority(
    tx: Prisma.TransactionClient,
    candidate: UpdateDetail,
  ): Promise<boolean> {
    if (
      !this.automaticProgressionAvailable ||
      !candidate.proposedByTaskId ||
      !candidate.proposedByPlanVersionId ||
      !candidate.proposedByStepId ||
      !candidate.proposedByTask?.initiatedByUserId ||
      !candidate.proposedByTask.mandateId
    ) {
      return false;
    }

    await tx.$queryRaw`SELECT "id" FROM "msaidizi_principals" WHERE "id" = ${candidate.principalId} FOR SHARE`;
    const principal = await tx.msaidiziPrincipal.findUnique({
      where: { id: candidate.principalId },
      select: { status: true },
    });
    if (principal?.status !== MsaidiziPrincipalStatus.ACTIVE) {
      return false;
    }

    await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${candidate.proposedByTaskId} FOR SHARE`;
    const task = await tx.msaidiziTask.findUnique({
      where: { id: candidate.proposedByTaskId },
      select: {
        id: true,
        principalId: true,
        initiatedByUserId: true,
        companyId: true,
        mandateId: true,
        mode: true,
        status: true,
        activePlanVersion: true,
      },
    });
    if (
      !task ||
      task.principalId !== candidate.principalId ||
      task.initiatedByUserId !== candidate.proposedByTask.initiatedByUserId ||
      task.companyId !== candidate.proposedByTask.companyId ||
      task.mandateId !== candidate.proposedByTask.mandateId ||
      task.mode !== MsaidiziTaskMode.AUTOPILOT ||
      (task.status !== MsaidiziTaskStatus.RUNNING && task.status !== MsaidiziTaskStatus.COMPLETED)
    ) {
      return false;
    }

    await tx.$queryRaw`SELECT "id" FROM "msaidizi_mandates" WHERE "id" = ${task.mandateId} FOR SHARE`;
    const mandate = await tx.msaidiziMandate.findUnique({
      where: { id: task.mandateId! },
      select: {
        id: true,
        principalId: true,
        status: true,
        capabilities: true,
        startsAt: true,
        expiresAt: true,
      },
    });
    const now = new Date();
    if (
      !mandate ||
      mandate.principalId !== candidate.principalId ||
      mandate.status !== MsaidiziMandateStatus.ACTIVE ||
      (mandate.startsAt && mandate.startsAt > now) ||
      (mandate.expiresAt && mandate.expiresAt <= now)
    ) {
      return false;
    }

    const step = await tx.msaidiziTaskStep.findUnique({
      where: { id: candidate.proposedByStepId },
      select: {
        id: true,
        taskId: true,
        planVersionId: true,
        target: true,
        capability: true,
        capabilityVersion: true,
        arguments: true,
        expectedEffect: true,
        dataClass: true,
        idempotent: true,
        mutation: true,
      },
    });
    if (
      !step ||
      step.taskId !== task.id ||
      step.planVersionId !== candidate.proposedByPlanVersionId ||
      !mandateAuthorizesUpdateCandidateProposal(mandate.capabilities, step)
    ) {
      return false;
    }
    try {
      const proposal = assertUpdateCandidateProposalStep(step);
      if (
        proposal.name !== candidate.name ||
        proposal.version !== candidate.version ||
        proposal.scope !== candidate.scope ||
        proposal.rollbackVersion !== candidate.rollbackVersion ||
        (proposal.proposalKind === 'ARTIFACT_BACKED' &&
          (proposal.sourceArtifactId !== candidate.sourceArtifactId ||
            proposal.sourceArtifactSha256 !== candidate.sourceArtifactSha256 ||
            proposal.rollbackArtifactId !== candidate.rollbackArtifactId ||
            proposal.rollbackArtifactSha256 !== candidate.rollbackArtifactSha256)) ||
        (isGeneratedUpdateCandidateProposal(proposal) && !candidate.generatedSourceArtifactId)
      ) {
        return false;
      }
    } catch {
      return false;
    }

    if (!(await this.hasCompleteAutomaticEvaluationEvidence(tx, candidate))) return false;
    this.signer.assertReady();
    return true;
  }

  private async hasCompleteAutomaticEvaluationEvidence(
    tx: Prisma.TransactionClient,
    candidate: UpdateDetail,
  ): Promise<boolean> {
    if (
      !candidate.evaluationBundleDigest ||
      !candidate.evaluationDecidedAt ||
      !candidate.evaluationReportArtifactId ||
      !candidate.evaluationReportArtifactSha256 ||
      !candidate.sourceArtifactId ||
      !candidate.sourceArtifactSha256 ||
      !candidate.rollbackArtifactId ||
      !candidate.rollbackArtifactSha256
    ) {
      return false;
    }
    const summary = jsonObject(candidate.evaluationSummary);
    if (
      summary.protocol !== 'MSAIDIZI-EVALUATION-BUNDLE-V1' ||
      summary.bundleDigest !== candidate.evaluationBundleDigest ||
      summary.decision !== MsaidiziUpdateCandidateStatus.APPROVED
    ) {
      return false;
    }
    const evidence = await tx.msaidiziUpdateEvaluationAttestation.findMany({
      where: { candidateId: candidate.id },
      select: {
        candidateId: true,
        taskId: true,
        planVersionId: true,
        stepId: true,
        kind: true,
        signerKeyId: true,
        claimsDigest: true,
        canonicalClaims: true,
        signature: true,
        verdict: true,
        evaluationRunId: true,
        cleanSnapshotId: true,
        sourceArtifactId: true,
        sourceArtifactSha256: true,
        rollbackArtifactId: true,
        rollbackArtifactSha256: true,
        reportArtifactId: true,
        reportArtifactSha256: true,
        runnerClaimsDigest: true,
        reviewerId: true,
        modelId: true,
      },
      orderBy: [{ kind: 'asc' }, { signerKeyId: 'asc' }],
    });
    if (evidence.length !== 3) return false;
    const runner = evidence.find(
      ({ kind }) => kind === MsaidiziUpdateEvaluationAttestationKind.RUNNER,
    );
    const reviews = evidence.filter(
      ({ kind }) => kind === MsaidiziUpdateEvaluationAttestationKind.MODEL_REVIEW,
    );
    if (
      !runner ||
      reviews.length !== 2 ||
      runner.verdict !== MsaidiziUpdateEvaluationVerdict.PASS ||
      reviews.some(({ verdict }) => verdict !== MsaidiziUpdateEvaluationVerdict.APPROVE) ||
      !automaticEvidenceRowMatchesCandidate(runner, candidate) ||
      reviews.some((review) => !automaticEvidenceRowMatchesCandidate(review, candidate)) ||
      !automaticRunnerClaimsArePassing(runner)
    ) {
      return false;
    }
    const signerIds = new Set(evidence.map(({ signerKeyId }) => identityKey(signerKeyId)));
    const reviewerIds = new Set(
      reviews.map(({ reviewerId }) => (reviewerId ? identityKey(reviewerId) : '')),
    );
    const modelIds = new Set(reviews.map(({ modelId }) => (modelId ? identityKey(modelId) : '')));
    if (
      signerIds.size !== 3 ||
      reviewerIds.size !== 2 ||
      reviewerIds.has('') ||
      modelIds.size !== 2 ||
      modelIds.has('') ||
      reviews.some(({ runnerClaimsDigest }) => runnerClaimsDigest !== runner.claimsDigest) ||
      reviews.some(
        (review) =>
          review.evaluationRunId !== runner.evaluationRunId ||
          review.cleanSnapshotId !== runner.cleanSnapshotId,
      ) ||
      attestationBundleDigest(
        runner.claimsDigest,
        reviews.map(({ claimsDigest }) => claimsDigest),
      ) !== candidate.evaluationBundleDigest
    ) {
      return false;
    }

    const run = await tx.msaidiziUpdateEvaluationRun.findUnique({
      where: { candidateId: candidate.id },
      select: {
        evaluationRunId: true,
        status: true,
        completedAt: true,
        requiredChecks: true,
      },
    });
    if (candidate.generatedSourceArtifactId) {
      return Boolean(
        run &&
        run.evaluationRunId === runner.evaluationRunId &&
        run.status === MsaidiziUpdateEvaluationRunStatus.SUCCEEDED &&
        run.completedAt &&
        allBooleanChecksPass(run.requiredChecks),
      );
    }
    return run === null;
  }

  private async lockAndLoadEligibleDevices(
    tx: Prisma.TransactionClient,
    deviceIds: readonly string[],
    statuses: readonly MsaidiziDeviceStatus[],
  ): Promise<Array<{ id: string; status: MsaidiziDeviceStatus }> | null> {
    const uniqueIds = [...new Set(deviceIds)].sort();
    if (uniqueIds.length === 0) return [];
    await this.lockDeviceRows(tx, uniqueIds);
    const eligible = await tx.msaidiziDevice.findMany({
      where: { id: { in: uniqueIds }, status: { in: [...statuses] } },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    });
    return eligible.length === uniqueIds.length ? eligible : null;
  }

  private async lockDeviceRows(
    tx: Prisma.TransactionClient,
    deviceIds: readonly string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(deviceIds)].sort();
    if (uniqueIds.length === 0) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "msaidizi_devices" WHERE "id" IN (${Prisma.join(
        uniqueIds,
      )}) ORDER BY "id" FOR SHARE`,
    );
  }

  private async writeAutomaticProgressionAudit(
    tx: Prisma.TransactionClient,
    candidate: UpdateDetail,
    action: string,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.logStrictInTransaction(tx, {
      action,
      entityType: 'MsaidiziUpdateCandidate',
      entityId: candidate.id,
      userId: candidate.proposedByTask?.initiatedByUserId,
      companyId: candidate.proposedByTask?.companyId ?? null,
      newValue: persistedJson(evidence) as Prisma.InputJsonObject,
      severity: AuditSeverity.CRITICAL,
      channel: AuditChannel.AGENT,
      agentSessionId: candidate.proposedByTaskId
        ? taskSessionId(candidate.proposedByTaskId)
        : undefined,
      principalType: 'MSAIDIZI',
      principalId: candidate.principalId,
      mandateId: candidate.proposedByTask?.mandateId,
      initiatedByUserId: candidate.proposedByTask?.initiatedByUserId,
      taskId: candidate.proposedByTaskId,
      stepId: candidate.proposedByStepId,
    });
  }

  async rollback(id: string, user: AuthUser) {
    const scopedCandidate = await this.findScoped(id, user);
    if (
      scopedCandidate.status !== MsaidiziUpdateCandidateStatus.CANARY &&
      scopedCandidate.status !== MsaidiziUpdateCandidateStatus.ACTIVE
    ) {
      throw new ConflictException(`Candidate cannot be rolled back from ${scopedCandidate.status}`);
    }
    const rollback = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${scopedCandidate.id} FOR UPDATE`;
      const candidate = await tx.msaidiziUpdateCandidate.findUnique({
        where: { id: scopedCandidate.id },
        include: UPDATE_INCLUDE,
      });
      if (!candidate) throw new NotFoundException('Update candidate not found');
      if (
        candidate.status !== MsaidiziUpdateCandidateStatus.CANARY &&
        candidate.status !== MsaidiziUpdateCandidateStatus.ACTIVE
      ) {
        throw new ConflictException(`Candidate cannot be rolled back from ${candidate.status}`);
      }
      if (![0, 5, 25, 100].includes(candidate.rolloutRing)) {
        throw new ConflictException('Candidate rollout ring is invalid');
      }

      const mayHaveActivated = await tx.msaidiziUpdateDeployment.findMany({
        where: {
          candidateId: candidate.id,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
          status: {
            in: [
              MsaidiziUpdateDeploymentStatus.DISPATCHED,
              MsaidiziUpdateDeploymentStatus.APPLYING,
              MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
              MsaidiziUpdateDeploymentStatus.SUCCEEDED,
              MsaidiziUpdateDeploymentStatus.FAILED,
              MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
            ],
          },
        },
        orderBy: [{ ring: 'desc' }, { id: 'asc' }],
      });
      if (mayHaveActivated.length === 0) {
        throw new ConflictException('No dispatched update deployment exists to roll back');
      }
      const signed = signedDeploymentClaims(mayHaveActivated[0]);
      assertCandidateMatchesSignedTarget(candidate, signed);
      for (const deployment of mayHaveActivated.slice(1)) {
        if (!sameSignedTarget(signed, signedDeploymentClaims(deployment))) {
          throw new ConflictException(
            'Dispatched deployments disagree on the signed update target',
          );
        }
      }

      const deviceIds = [...new Set(mayHaveActivated.map(({ deviceId }) => deviceId))].sort();
      const wave = await this.queueRollbackDeploymentsInTransaction(tx, {
        candidateId: candidate.id,
        deviceIds,
        ring: mayHaveActivated[0].ring as 0 | 5 | 25 | 100,
        signed,
      });
      const remaining = wave.unprovenDeviceCount;
      const now = new Date();
      const updatedCandidate = await tx.msaidiziUpdateCandidate.update({
        where: { id: candidate.id },
        data: {
          status:
            remaining === 0
              ? MsaidiziUpdateCandidateStatus.ROLLED_BACK
              : MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: persistedJson({
            healthy: false,
            source: 'oversight-requested-rollback',
            rollbackInProgress: remaining > 0,
            requiredRollbackDevices: wave.requiredDeviceCount,
            queuedRollbackDeployments: wave.newlyQueuedCount,
            remainingRollbackDeployments: remaining,
            unavailableRollbackDevices: wave.unavailableDeviceCount,
            unavailableRollbackDeviceSetSha256: wave.unavailableDeviceSetSha256,
            observedAt: now.toISOString(),
          }),
          recoveryPending: wave.unavailableDeviceCount > 0,
          recoveryRequestedAt: wave.unavailableDeviceCount > 0 ? now : null,
          recoveryLastAttemptAt: wave.unavailableDeviceCount > 0 ? now : undefined,
          recoveryLastErrorCode:
            wave.unavailableDeviceCount > 0 ? 'RECOVERY_TARGET_UNAVAILABLE' : null,
          ...(remaining === 0 ? { rolledBackAt: now } : {}),
        },
        include: UPDATE_INCLUDE,
      });
      return { candidate: updatedCandidate, deployments: wave.deployments };
    });
    await this.writeAudit('MSAIDIZI_UPDATE_ROLLBACK_QUEUED', rollback.candidate, user);
    return jsonSafe(rollback);
  }

  /** Returns at most one immutable command for the authenticated supervisor. */
  async pollSupervisor(dto: PollMsaidiziUpdateDeploymentsDto, request: Request) {
    const device = await this.authenticatedDevice(dto.deviceId, request);
    this.signer.assertReady();
    const now = new Date();
    const deployment = await this.prisma.$transaction(async (tx) => {
      const next = await tx.msaidiziUpdateDeployment.findFirst({
        where: {
          deviceId: device.id,
          AND: [
            {
              OR: [
                {
                  operation: MsaidiziUpdateDeploymentOperation.APPLY,
                  candidate: {
                    status: {
                      in: [
                        MsaidiziUpdateCandidateStatus.APPROVED,
                        MsaidiziUpdateCandidateStatus.CANARY,
                      ],
                    },
                  },
                },
                {
                  operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
                  candidate: {
                    status: {
                      in: [
                        MsaidiziUpdateCandidateStatus.CANARY,
                        MsaidiziUpdateCandidateStatus.ACTIVE,
                        MsaidiziUpdateCandidateStatus.FAILED,
                      ],
                    },
                  },
                },
              ],
            },
          ],
          OR: [
            { status: MsaidiziUpdateDeploymentStatus.QUEUED },
            {
              status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
              deliveryLeaseExpiresAt: { lte: now },
            },
          ],
        },
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      });
      if (!next) return null;
      // Result aggregation and dispatch take the same candidate lock. If a
      // failure wins first, a stale poll must not dispatch another APPLY after
      // rollback has started. If this poll wins first, failure aggregation will
      // observe the command as dispatched and include its device in the
      // rollback wave.
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${next.candidateId} FOR UPDATE`;
      const lockedDevice = await this.lockAndLoadEligibleDevices(
        tx,
        [device.id],
        [MsaidiziDeviceStatus.ACTIVE],
      );
      if (!lockedDevice) return null;
      const candidateState = await tx.msaidiziUpdateCandidate.findUnique({
        where: { id: next.candidateId },
        include: UPDATE_INCLUDE,
      });
      if (
        !candidateState ||
        !canDispatchUpdate(next.operation, candidateState.status) ||
        (next.operation === MsaidiziUpdateDeploymentOperation.APPLY &&
          next.automaticProgression &&
          !candidateState.automaticProgressionEnabled)
      ) {
        return null;
      }
      if (next.operation === MsaidiziUpdateDeploymentOperation.APPLY && next.automaticProgression) {
        if (!(await this.lockAndAssertAutomaticQueueAuthority(tx, candidateState))) {
          return null;
        }
      } else {
        // Re-read the deployment-owned signer and kill-switch state at the
        // actual dispatch boundary, not only before selecting a command.
        this.signer.assertReady();
      }
      const prepared = this.prepareDeliveryAttempt(next, now);
      const manifestHistory = appendManifestHistory(next);
      const won = await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: next.id,
          updatedAt: next.updatedAt,
          ...(next.status === MsaidiziUpdateDeploymentStatus.QUEUED
            ? { status: MsaidiziUpdateDeploymentStatus.QUEUED }
            : {
                status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
                deliveryLeaseId: next.deliveryLeaseId,
                deliveryLeaseExpiresAt: { lte: now },
              }),
        },
        data: {
          status:
            next.status === MsaidiziUpdateDeploymentStatus.QUEUED
              ? MsaidiziUpdateDeploymentStatus.DISPATCHED
              : next.status,
          dispatchedAt: new Date(),
          dispatchCount: { increment: 1 },
          deliveryLeaseId: prepared.deliveryLeaseId,
          deliveryLeaseExpiresAt: prepared.deliveryLeaseExpiresAt,
          deliveryAcknowledgedAt: null,
          manifestJson: prepared.issued.manifestJson,
          manifestSha256: prepared.issued.manifestSha256,
          manifestSignature: prepared.issued.signature,
          signingKeyId: prepared.issued.signingKeyId,
          manifestHistory,
        },
      });
      if (won.count !== 1) return null;
      return tx.msaidiziUpdateDeployment.findUnique({ where: { id: next.id } });
    });
    return deployment
      ? {
          deploymentId: deployment.id,
          manifestJson: deployment.manifestJson,
          manifestSha256: deployment.manifestSha256,
          signature: deployment.manifestSignature,
          signingKeyId: deployment.signingKeyId,
          deliveryLeaseId: deployment.deliveryLeaseId,
        }
      : { deploymentId: null };
  }

  async acknowledgeSupervisorDelivery(dto: AckMsaidiziUpdateDeploymentDto, request: Request) {
    const device = await this.authenticatedDevice(dto.deviceId, request);
    this.signer.assertReady();
    return this.prisma.$transaction(async (tx) => {
      const selected = await tx.msaidiziUpdateDeployment.findFirst({
        where: { id: dto.deploymentId, deviceId: device.id },
      });
      if (!selected) throw new NotFoundException('Update deployment not found');
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${selected.candidateId} FOR UPDATE`;
      if (
        !(await this.lockAndLoadEligibleDevices(tx, [device.id], [MsaidiziDeviceStatus.ACTIVE]))
      ) {
        throw new UnauthorizedException('The update device is no longer eligible');
      }
      const deployment = await tx.msaidiziUpdateDeployment.findUnique({
        where: { id: selected.id },
      });
      if (!deployment) throw new NotFoundException('Update deployment not found');
      const manifestSha256 = dto.manifestSha256.toLowerCase();
      if (deployment.deliveryAcknowledgedAt) {
        if (
          deployment.deliveryLeaseId !== dto.deliveryLeaseId ||
          deployment.manifestSha256 !== manifestSha256
        ) {
          throw new ConflictException('A different delivery attempt was already acknowledged');
        }
        return { accepted: true, replay: true };
      }
      if (
        deployment.status !== MsaidiziUpdateDeploymentStatus.DISPATCHED ||
        deployment.deliveryLeaseId !== dto.deliveryLeaseId ||
        deployment.manifestSha256 !== manifestSha256 ||
        !deployment.deliveryLeaseExpiresAt ||
        deployment.deliveryLeaseExpiresAt.getTime() <= Date.now()
      ) {
        throw new ConflictException('The signed delivery lease is invalid or expired');
      }
      const candidate = await tx.msaidiziUpdateCandidate.findUnique({
        where: { id: deployment.candidateId },
        include: UPDATE_INCLUDE,
      });
      if (!candidate || !canDispatchUpdate(deployment.operation, candidate.status)) {
        throw new ConflictException('The update candidate no longer permits dispatch');
      }
      if (
        deployment.operation === MsaidiziUpdateDeploymentOperation.APPLY &&
        deployment.automaticProgression
      ) {
        if (!(await this.lockAndAssertAutomaticQueueAuthority(tx, candidate))) {
          throw new ServiceUnavailableException('Automatic rollout authority is unavailable');
        }
      } else {
        this.signer.assertReady();
      }
      const acknowledgedAt = new Date();
      const won = await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: deployment.id,
          status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
          deliveryLeaseId: dto.deliveryLeaseId,
          deliveryAcknowledgedAt: null,
          deliveryLeaseExpiresAt: { gt: acknowledgedAt },
          manifestSha256,
        },
        data: { deliveryAcknowledgedAt: acknowledgedAt },
      });
      if (won.count !== 1) {
        throw new ConflictException('The delivery acknowledgement lost its lease');
      }
      return { accepted: true, replay: false };
    });
  }

  async supervisorProgress(dto: MsaidiziUpdateProgressDto, request: Request) {
    const device = await this.authenticatedDevice(dto.deviceId, request);
    const requested = dto.status as MsaidiziUpdateDeploymentStatus;
    const won = await this.prisma.$transaction(async (tx) => {
      const selected = await tx.msaidiziUpdateDeployment.findFirst({
        where: { id: dto.deploymentId, deviceId: device.id },
        select: { candidateId: true },
      });
      if (!selected) return 0;
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${selected.candidateId} FOR UPDATE`;
      if (
        !(await this.lockAndLoadEligibleDevices(tx, [device.id], [MsaidiziDeviceStatus.ACTIVE]))
      ) {
        return 0;
      }
      const deployment = await tx.msaidiziUpdateDeployment.findUnique({
        where: { id: dto.deploymentId },
      });
      if (!deployment || deployment.deviceId !== device.id) return 0;
      const now = new Date();
      const journalHead = dto.journalHeadSha256.toLowerCase();
      const manifestSha256 = dto.manifestSha256.toLowerCase();
      if (requested === MsaidiziUpdateDeploymentStatus.APPLYING) {
        if (deployment.status === MsaidiziUpdateDeploymentStatus.APPLYING) {
          const replay = await tx.msaidiziUpdateDeployment.updateMany({
            where: {
              id: deployment.id,
              deviceId: device.id,
              status: MsaidiziUpdateDeploymentStatus.APPLYING,
              deliveryAcknowledgedAt: { not: null },
              deliveryLeaseId: dto.deliveryLeaseId,
              manifestSha256,
            },
            data: { supervisorJournalHead: journalHead },
          });
          return replay.count;
        }
        if (
          deployment.status !== MsaidiziUpdateDeploymentStatus.DISPATCHED ||
          !deployment.deliveryAcknowledgedAt ||
          !deployment.deliveryLeaseExpiresAt ||
          deployment.deliveryLeaseExpiresAt.getTime() <= now.getTime() ||
          deployment.deliveryLeaseId !== dto.deliveryLeaseId ||
          deployment.manifestSha256 !== manifestSha256
        ) {
          return 0;
        }
        const candidate = await tx.msaidiziUpdateCandidate.findUnique({
          where: { id: deployment.candidateId },
          include: UPDATE_INCLUDE,
        });
        if (!candidate || !canDispatchUpdate(deployment.operation, candidate.status)) {
          throw new ConflictException('The update candidate no longer permits dispatch');
        }
        if (
          deployment.operation === MsaidiziUpdateDeploymentOperation.APPLY &&
          deployment.automaticProgression
        ) {
          if (
            !candidate.automaticProgressionEnabled ||
            !(await this.lockAndAssertAutomaticQueueAuthority(tx, candidate))
          ) {
            throw new ServiceUnavailableException('Automatic rollout authority is unavailable');
          }
        } else {
          // Re-read the signer-owned kill state while the candidate and device
          // rows are locked, immediately before crossing the mutation fence.
          this.signer.assertReady();
        }
        const started = await tx.msaidiziUpdateDeployment.updateMany({
          where: {
            id: deployment.id,
            deviceId: device.id,
            status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
            deliveryAcknowledgedAt: { not: null },
            deliveryLeaseExpiresAt: { gt: now },
            deliveryLeaseId: dto.deliveryLeaseId,
            manifestSha256,
          },
          data: {
            status: MsaidiziUpdateDeploymentStatus.APPLYING,
            supervisorJournalHead: journalHead,
            startedAt: now,
          },
        });
        return started.count;
      }
      const beganHealthCheck = await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: dto.deploymentId,
          deviceId: device.id,
          status: MsaidiziUpdateDeploymentStatus.APPLYING,
          deliveryLeaseId: dto.deliveryLeaseId,
          manifestSha256,
        },
        data: {
          status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
          supervisorJournalHead: journalHead,
          healthCheckStartedAt: now,
        },
      });
      if (beganHealthCheck.count === 1) return 1;
      const replay = await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: dto.deploymentId,
          deviceId: device.id,
          status: MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
          healthCheckStartedAt: { not: null },
          deliveryLeaseId: dto.deliveryLeaseId,
          manifestSha256,
        },
        data: { supervisorJournalHead: journalHead },
      });
      return replay.count;
    });
    if (won !== 1) throw new ConflictException('Invalid update progress transition');
    return { accepted: true };
  }

  async supervisorResult(dto: MsaidiziUpdateResultDto, request: Request) {
    // A kill/offline transition stops every new poll and artifact read, but an already
    // dispatched supervisor may still return the only evidence of what
    // happened. Accept terminal evidence from its still-bound certificate.
    // REVOKED is deliberately excluded because it may represent key compromise.
    const device = await this.authenticatedDevice(dto.deviceId, request, true);
    const digest = resultDigest(dto);
    return this.prisma.$transaction(async (tx) => {
      let deployment = await tx.msaidiziUpdateDeployment.findFirst({
        where: { id: dto.deploymentId, deviceId: device.id },
        include: {
          candidate: {
            include: {
              proposedByTask: {
                select: { initiatedByUserId: true, companyId: true, mandateId: true },
              },
            },
          },
        },
      });
      if (!deployment) throw new NotFoundException('Update deployment not found');
      if (!deploymentAcceptsAcknowledgedManifestDigest(deployment, dto.manifestSha256)) {
        throw new ConflictException('Result does not match an acknowledged signed update manifest');
      }
      if (deployment.resultDigest) {
        if (deployment.resultDigest !== digest) {
          throw new ConflictException('A different result was already recorded');
        }
        return { accepted: true, replay: true, status: deployment.status };
      }

      // Poll dispatch and result aggregation lock candidate then deployment in
      // the same order. Re-read after the lock so two concurrent identical
      // results converge to replay instead of deadlocking or rejecting the
      // loser of the first terminal CAS.
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${deployment.candidateId} FOR UPDATE`;
      deployment = await tx.msaidiziUpdateDeployment.findFirst({
        where: { id: dto.deploymentId, deviceId: device.id },
        include: {
          candidate: {
            include: {
              proposedByTask: {
                select: { initiatedByUserId: true, companyId: true, mandateId: true },
              },
            },
          },
        },
      });
      if (!deployment) throw new NotFoundException('Update deployment not found');
      if (!deploymentAcceptsAcknowledgedManifestDigest(deployment, dto.manifestSha256)) {
        throw new ConflictException('Result does not match an acknowledged signed update manifest');
      }
      if (deployment.resultDigest) {
        if (deployment.resultDigest !== digest) {
          throw new ConflictException('A different result was already recorded');
        }
        return { accepted: true, replay: true, status: deployment.status };
      }
      const outcome = dto.outcome as MsaidiziUpdateDeploymentStatus;
      const completedAt = new Date();
      const healthySoakEvidenceSha256 = requiresHealthyTerminalEvidence(outcome)
        ? validateHealthySoakEvidence(deployment, dto, completedAt)
        : null;
      const won = await tx.msaidiziUpdateDeployment.updateMany({
        where: {
          id: deployment.id,
          resultDigest: null,
          status: {
            in: [
              MsaidiziUpdateDeploymentStatus.DISPATCHED,
              MsaidiziUpdateDeploymentStatus.APPLYING,
              MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
              ...(device.status === MsaidiziDeviceStatus.KILLED
                ? [MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION]
                : []),
            ],
          },
        },
        data: {
          status: outcome,
          resultDigest: digest,
          resultSummary: persistedJson({
            manifestSha256: dto.manifestSha256.toLowerCase(),
            activatedArtifactSha256: dto.activatedArtifactSha256?.toLowerCase(),
            observedVersion: dto.observedVersion,
            health: dto.health,
            healthySoakEvidenceSha256,
            reason: dto.reason,
            deviceId: device.id,
            receivedAt: new Date().toISOString(),
          }),
          supervisorJournalHead: dto.journalHeadSha256.toLowerCase(),
          healthySoakEvidenceSha256,
          completedAt,
        },
      });
      if (won.count !== 1) throw new ConflictException('Update result transition was rejected');

      await this.reconcileCandidateFromSupervisor(tx, deployment, outcome, dto, device.id);
      await this.audit.logStrictInTransaction(tx, {
        action: 'MSAIDIZI_UPDATE_SUPERVISOR_RESULT',
        entityType: 'MsaidiziUpdateDeployment',
        entityId: deployment.id,
        userId: deployment.candidate.proposedByTask?.initiatedByUserId,
        companyId: deployment.candidate.proposedByTask?.companyId ?? null,
        newValue: persistedJson({
          candidateId: deployment.candidateId,
          operation: deployment.operation,
          ring: deployment.ring,
          outcome,
          manifestSha256: dto.manifestSha256.toLowerCase(),
          currentDeliveryManifestSha256: deployment.manifestSha256,
          journalHeadSha256: dto.journalHeadSha256.toLowerCase(),
          activatedArtifactSha256: dto.activatedArtifactSha256?.toLowerCase(),
        }) as Prisma.InputJsonObject,
        severity:
          outcome === MsaidiziUpdateDeploymentStatus.SUCCEEDED ||
          outcome === MsaidiziUpdateDeploymentStatus.ROLLED_BACK
            ? AuditSeverity.HIGH
            : AuditSeverity.CRITICAL,
        channel: AuditChannel.AGENT,
        agentSessionId: deployment.candidate.proposedByTaskId
          ? taskSessionId(deployment.candidate.proposedByTaskId)
          : undefined,
        principalType: 'MSAIDIZI',
        principalId: deployment.candidate.principalId,
        mandateId: deployment.candidate.proposedByTask?.mandateId,
        initiatedByUserId: deployment.candidate.proposedByTask?.initiatedByUserId,
        taskId: deployment.candidate.proposedByTaskId,
        stepId: deployment.candidate.proposedByStepId,
        deviceId: device.id,
      });
      return { accepted: true, replay: false, status: outcome };
    });
  }

  async authorizeSupervisorArtifact(
    deploymentId: string,
    role: 'source' | 'rollback',
    request: Request,
  ) {
    this.signer.assertReady();
    const peer = directMtlsPeer(request);
    if (!peer.publicKeySpkiSha256) {
      throw new UnauthorizedException('The update supervisor TLS peer has no SPKI identity');
    }
    const deployment = await this.prisma.msaidiziUpdateDeployment.findFirst({
      where: {
        id: deploymentId,
        deliveryAcknowledgedAt: { not: null },
        OR: [
          {
            status: MsaidiziUpdateDeploymentStatus.DISPATCHED,
            deliveryLeaseExpiresAt: { gt: new Date() },
          },
          {
            status: {
              in: [
                MsaidiziUpdateDeploymentStatus.APPLYING,
                MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
              ],
            },
          },
        ],
        device: {
          status: MsaidiziDeviceStatus.ACTIVE,
          updateSupervisorCertificateSha256: peer.certificateSha256,
          updateSupervisorPublicKeySpkiSha256: peer.publicKeySpkiSha256,
        },
      },
      include: {
        candidate: {
          include: {
            sourceArtifact: { select: { id: true, sha256: true } },
            rollbackArtifact: { select: { id: true, sha256: true } },
          },
        },
      },
    });
    if (!deployment) throw new NotFoundException('Update deployment not found');
    const artifact =
      role === 'source'
        ? deployment.candidate.sourceArtifact
        : deployment.candidate.rollbackArtifact;
    if (!artifact) throw new NotFoundException('Update artifact not found');
    return artifact;
  }

  private async authenticatedDevice(
    deviceId: string,
    request: Request,
    terminalEvidenceOnly = false,
  ) {
    const peer = directMtlsPeer(request);
    if (!peer.publicKeySpkiSha256) {
      throw new UnauthorizedException('The update supervisor TLS peer has no SPKI identity');
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
        updateSupervisorCertificateSha256: peer.certificateSha256,
        updateSupervisorPublicKeySpkiSha256: peer.publicKeySpkiSha256,
      },
      select: { id: true, status: true },
    });
    if (!device) {
      throw new UnauthorizedException(
        'The update supervisor TLS identity is not bound to this device',
      );
    }
    return device;
  }

  private prepareDeliveryAttempt(
    deployment: Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>,
    now: Date,
  ) {
    const signed = signedDeploymentClaims(deployment);
    const deliveryLeaseId = randomUUID();
    const issued = this.signer.issue(
      {
        schemaVersion: 2,
        deploymentId: deployment.id,
        candidateId: deployment.candidateId,
        deviceId: deployment.deviceId,
        operation: deployment.operation,
        ring: deployment.ring as 0 | 5 | 25 | 100,
        ...signed,
        deliveryLeaseId,
        deliveryAttempt: deployment.dispatchCount + 1,
        idempotencyKey: deployment.idempotencyKey,
      },
      now,
    );
    return {
      issued,
      deliveryLeaseId,
      deliveryLeaseExpiresAt: signedManifestExpiry(issued.manifestJson),
    };
  }

  private async selectRingDevices(
    candidateId: string,
    ring: number,
    explicitDeviceIds?: string[],
  ): Promise<Array<{ id: string }>> {
    const requested = explicitDeviceIds ? [...new Set(explicitDeviceIds)] : undefined;
    const active = await this.prisma.msaidiziDevice.findMany({
      where: {
        status:
          ring === 0
            ? MsaidiziDeviceStatus.ACTIVE
            : { in: [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE] },
        ...(requested ? { id: { in: requested } } : {}),
      },
      select: { id: true },
    });
    if (requested && active.length !== requested.length) {
      throw new BadRequestException('Every selected update device must be enrolled in this ring');
    }
    if (active.length === 0) throw new ConflictException('No active enrolled update device exists');
    if (requested) return active.sort((a, b) => a.id.localeCompare(b.id));

    const ranked = active.sort((a, b) =>
      stableDeviceRank(candidateId, a.id).localeCompare(stableDeviceRank(candidateId, b.id)),
    );
    const count = ring === 0 ? 1 : Math.max(1, Math.ceil((ranked.length * ring) / 100));
    return ranked.slice(0, count);
  }

  private async queueDeployments(
    candidate: UpdateDetail,
    devices: Array<{ id: string }>,
    ring: 0 | 5 | 25 | 100,
    operation: MsaidiziUpdateDeploymentOperation,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_update_candidates" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const current = await tx.msaidiziUpdateCandidate.findUnique({
        where: { id: candidate.id },
        include: UPDATE_INCLUDE,
      });
      if (!current) throw new NotFoundException('Update candidate not found');
      if (current.automaticProgressionEnabled) {
        throw new ConflictException(
          'Manual rollout is unavailable while automatic progression is armed',
        );
      }
      const allowed =
        operation === MsaidiziUpdateDeploymentOperation.APPLY &&
        ((current.status === MsaidiziUpdateCandidateStatus.APPROVED && ring === 0) ||
          (current.status === MsaidiziUpdateCandidateStatus.CANARY &&
            ring > current.rolloutRing &&
            [5, 25, 100].includes(ring)));
      if (!allowed) {
        throw new ConflictException('Invalid or non-monotonic rollout ring transition');
      }
      return this.queueDeploymentsInTransaction(tx, current, devices, ring, operation);
    });
  }

  private async queueDeploymentsInTransaction(
    tx: Prisma.TransactionClient,
    candidate: UpdateDetail,
    devices: Array<{ id: string }>,
    ring: 0 | 5 | 25 | 100,
    operation: MsaidiziUpdateDeploymentOperation,
    automaticProgression = false,
    healthPolicy: SignedHealthPolicy = {
      healthTimeoutSeconds: this.signer.healthTimeoutSeconds,
      minimumHealthySoakSeconds: this.signer.minimumHealthySoakSeconds,
    },
    minimumRingDwellSeconds = this.signer.minimumRingDwellSeconds(ring),
  ) {
    if (!candidate.sourceArtifact || !candidate.rollbackArtifact) {
      throw new ConflictException('Update artifacts are no longer available');
    }
    const sourceArtifactSha256 = candidate.sourceArtifact.sha256.toLowerCase();
    const rollbackArtifactSha256 = candidate.rollbackArtifact.sha256.toLowerCase();
    const rollbackVersion = candidate.rollbackVersion;
    if (
      typeof rollbackVersion !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(rollbackVersion)
    ) {
      throw new ConflictException('Candidate has no evaluated rollback version');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate.scope)) {
      throw new BadRequestException('Candidate scope must be a configured target identifier');
    }
    const requestedDeviceIds = devices.map(({ id }) => id);
    const lockedDevices = await this.lockAndLoadEligibleDevices(
      tx,
      requestedDeviceIds,
      ring === 0
        ? [MsaidiziDeviceStatus.ACTIVE]
        : [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE],
    );
    if (!lockedDevices) {
      throw new ConflictException('A selected update device is no longer eligible');
    }

    const commands = lockedDevices.map((device) => {
      const id = randomUUID();
      const deliveryLeaseId = randomUUID();
      const idempotencyKey = createHash('sha256')
        .update(`${candidate.id}\0${device.id}\0${ring}\0${operation}`, 'utf8')
        .digest('hex');
      const issued = this.signer.issue({
        schemaVersion: 2,
        deploymentId: id,
        candidateId: candidate.id,
        deviceId: device.id,
        operation,
        ring,
        targetId: candidate.scope,
        version: candidate.version,
        rollbackVersion,
        sourceArtifactSha256,
        rollbackArtifactSha256,
        healthTimeoutSeconds: healthPolicy.healthTimeoutSeconds,
        minimumHealthySoakSeconds: healthPolicy.minimumHealthySoakSeconds,
        minimumRingDwellSeconds,
        deliveryLeaseId,
        deliveryAttempt: 1,
        idempotencyKey,
      });
      return {
        id,
        deviceId: device.id,
        idempotencyKey,
        deliveryLeaseId,
        deliveryLeaseExpiresAt: signedManifestExpiry(issued.manifestJson),
        issued,
      };
    });

    const created = [];
    for (const command of commands) {
      created.push(
        await tx.msaidiziUpdateDeployment.upsert({
          where: {
            candidateId_deviceId_ring_operation: {
              candidateId: candidate.id,
              deviceId: command.deviceId,
              ring,
              operation,
            },
          },
          update: {},
          create: {
            id: command.id,
            candidateId: candidate.id,
            deviceId: command.deviceId,
            operation,
            ring,
            targetId: candidate.scope,
            idempotencyKey: command.idempotencyKey,
            manifestJson: command.issued.manifestJson,
            manifestSha256: command.issued.manifestSha256,
            manifestSignature: command.issued.signature,
            signingKeyId: command.issued.signingKeyId,
            automaticProgression,
            deliveryLeaseId: command.deliveryLeaseId,
            deliveryLeaseExpiresAt: command.deliveryLeaseExpiresAt,
          },
        }),
      );
    }
    return created;
  }

  private async assertSupervisorRingSucceeded(candidateId: string, ring: number): Promise<void> {
    const total = await this.prisma.msaidiziUpdateDeployment.count({
      where: {
        candidateId,
        ring,
        operation: MsaidiziUpdateDeploymentOperation.APPLY,
      },
    });
    const succeeded = await this.prisma.msaidiziUpdateDeployment.count({
      where: {
        candidateId,
        ring,
        operation: MsaidiziUpdateDeploymentOperation.APPLY,
        status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
      },
    });
    if (total === 0 || succeeded !== total) {
      throw new ConflictException('Supervisor-confirmed healthy completion is required');
    }
  }

  private async reconcileCandidateFromSupervisor(
    tx: Prisma.TransactionClient,
    deployment: SupervisorDeployment,
    outcome: MsaidiziUpdateDeploymentStatus,
    dto: MsaidiziUpdateResultDto,
    deviceId: string,
  ) {
    // supervisorResult already holds the candidate row lock. Without it, two
    // final devices could each observe the other as unfinished and neither
    // would promote (or they could queue competing rollback waves).
    const now = new Date();
    const healthSummary = persistedJson({
      healthy: outcome === MsaidiziUpdateDeploymentStatus.SUCCEEDED,
      source: 'trusted-update-supervisor',
      deploymentId: deployment.id,
      deviceId,
      rolloutRing: deployment.ring,
      journalHeadSha256: dto.journalHeadSha256.toLowerCase(),
      metrics: dto.health,
      reason: dto.reason,
      observedAt: now.toISOString(),
    });

    if (
      deployment.operation === MsaidiziUpdateDeploymentOperation.APPLY &&
      outcome === MsaidiziUpdateDeploymentStatus.SUCCEEDED
    ) {
      const signed = signedDeploymentClaims(deployment);
      if (
        dto.activatedArtifactSha256?.toLowerCase() !== signed.sourceArtifactSha256 ||
        dto.observedVersion !== signed.version
      ) {
        throw new ConflictException('Supervisor did not prove activation of the signed artifact');
      }
      const remaining = await tx.msaidiziUpdateDeployment.count({
        where: {
          candidateId: deployment.candidateId,
          ring: deployment.ring,
          operation: MsaidiziUpdateDeploymentOperation.APPLY,
          status: { not: MsaidiziUpdateDeploymentStatus.SUCCEEDED },
        },
      });
      if (remaining === 0) {
        if (
          deployment.ring === 100 &&
          deployment.automaticProgression &&
          deployment.candidate.automaticProgressionEnabled
        ) {
          const population = await this.automaticEligiblePopulationEvidence(
            tx,
            deployment.candidate,
          );
          if (!population.complete) {
            await tx.msaidiziUpdateCandidate.update({
              where: { id: deployment.candidateId },
              data: {
                status: MsaidiziUpdateCandidateStatus.CANARY,
                healthSummary: persistedJson({
                  ...(healthSummary as Prisma.InputJsonObject),
                  automaticProgression: {
                    awaitingFullEligiblePopulation: true,
                    eligibleDeviceCount: population.eligibleDeviceCount,
                    succeededEligibleDeviceCount: population.succeededEligibleDeviceCount,
                    uncoveredDeviceCount: population.uncoveredDeviceCount,
                    uncoveredDeviceSetSha256: population.uncoveredDeviceSetSha256,
                  },
                }),
              },
            });
            await this.audit.logStrictInTransaction(tx, {
              action: 'MSAIDIZI_UPDATE_AUTOMATIC_POPULATION_INCOMPLETE',
              entityType: 'MsaidiziUpdateCandidate',
              entityId: deployment.candidateId,
              userId: deployment.candidate.proposedByTask?.initiatedByUserId,
              companyId: deployment.candidate.proposedByTask?.companyId ?? null,
              newValue: persistedJson(population) as Prisma.InputJsonObject,
              severity: AuditSeverity.CRITICAL,
              channel: AuditChannel.AGENT,
              agentSessionId: deployment.candidate.proposedByTaskId
                ? taskSessionId(deployment.candidate.proposedByTaskId)
                : undefined,
              principalType: 'MSAIDIZI',
              principalId: deployment.candidate.principalId,
              mandateId: deployment.candidate.proposedByTask?.mandateId,
              initiatedByUserId: deployment.candidate.proposedByTask?.initiatedByUserId,
              taskId: deployment.candidate.proposedByTaskId,
              stepId: deployment.candidate.proposedByStepId,
            });
            return;
          }
        }
        const automatic =
          deployment.automaticProgression && deployment.candidate.automaticProgressionEnabled;
        const ringDwellSeconds = automatic
          ? minimumRingDwellFor(deployment.candidate, deployment.ring)
          : null;
        const ringEvidenceSha256 = automatic
          ? automaticRingEvidenceDigest(
              deployment.candidateId,
              deployment.ring,
              now,
              deployment.candidate.automaticProgressionCohortSha256!,
              ringDwellSeconds!,
            )
          : null;
        await tx.msaidiziUpdateCandidate.update({
          where: { id: deployment.candidateId },
          data: {
            status:
              automatic || deployment.ring !== 100
                ? MsaidiziUpdateCandidateStatus.CANARY
                : MsaidiziUpdateCandidateStatus.ACTIVE,
            rolloutRing: deployment.ring,
            healthSummary: automatic
              ? persistedJson({
                  ...(healthSummary as Prisma.InputJsonObject),
                  automaticProgression: {
                    ring: deployment.ring,
                    healthyAt: now.toISOString(),
                    minimumRingDwellSeconds: ringDwellSeconds,
                    ringEvidenceSha256,
                    stabilizationPending: deployment.ring === 100,
                  },
                })
              : healthSummary,
            ...(automatic
              ? {
                  automaticProgressionRingHealthyAt: now,
                  automaticProgressionRingEvidenceSha256: ringEvidenceSha256,
                }
              : deployment.ring === 100
                ? { deployedAt: now }
                : {}),
          },
        });
      }
      return;
    }

    if (outcome === MsaidiziUpdateDeploymentStatus.ROLLED_BACK) {
      const signed = signedDeploymentClaims(deployment);
      if (
        dto.activatedArtifactSha256?.toLowerCase() !== signed.rollbackArtifactSha256 ||
        dto.observedVersion !== signed.rollbackVersion
      ) {
        throw new ConflictException(
          'Supervisor did not prove activation of the signed rollback artifact and version',
        );
      }
      let automaticWave:
        | {
            requiredDeviceCount: number;
            newlyQueuedCount: number;
            unprovenDeviceCount: number;
            unavailableDeviceCount: number;
            unavailableDeviceSetSha256: string;
          }
        | undefined;
      if (deployment.operation !== MsaidiziUpdateDeploymentOperation.ROLLBACK) {
        try {
          automaticWave = await this.queueAutomaticRollbackDeployments(tx, deployment, deviceId);
        } catch (error) {
          if (!isDeferrableRecoveryError(error)) throw error;
          await this.markRecoveryPending(tx, deployment, healthSummary, error);
          return;
        }
      }

      // APPLY may report a local self-rollback. Do not issue another mutation
      // to that device, but roll back peers that may still run the source.
      const existingUnproven = await this.countUnprovenRollbackDevices(
        tx,
        deployment.candidateId,
        signedDeploymentClaims(deployment),
        automaticWave === undefined,
      );
      const remaining = automaticWave
        ? Math.max(automaticWave.unprovenDeviceCount, existingUnproven)
        : existingUnproven;
      if (remaining !== 0) {
        const recoveryStillPending =
          (automaticWave?.unavailableDeviceCount ?? 0) > 0 ||
          (automaticWave === undefined && deployment.candidate.recoveryPending);
        await tx.msaidiziUpdateCandidate.update({
          where: { id: deployment.candidateId },
          data: {
            status: MsaidiziUpdateCandidateStatus.FAILED,
            healthSummary: persistedJson({
              ...(healthSummary as Prisma.InputJsonObject),
              rollbackInProgress: true,
              remainingRollbackDeployments: remaining,
              ...(automaticWave
                ? {
                    requiredRollbackDevices: automaticWave.requiredDeviceCount,
                    queuedRollbackDeployments: automaticWave.newlyQueuedCount,
                    unavailableRollbackDevices: automaticWave.unavailableDeviceCount,
                    unavailableRollbackDeviceSetSha256: automaticWave.unavailableDeviceSetSha256,
                  }
                : {}),
            }),
            recoveryPending: recoveryStillPending,
            recoveryRequestedAt: recoveryStillPending
              ? (deployment.candidate.recoveryRequestedAt ?? now)
              : null,
            recoveryLastErrorCode: recoveryStillPending
              ? (deployment.candidate.recoveryLastErrorCode ?? 'RECOVERY_TARGET_UNAVAILABLE')
              : null,
          },
        });
        return;
      }
      await tx.msaidiziUpdateCandidate.update({
        where: { id: deployment.candidateId },
        data: {
          status: MsaidiziUpdateCandidateStatus.ROLLED_BACK,
          healthSummary,
          rolledBackAt: now,
          recoveryPending: false,
          recoveryRequestedAt: null,
          recoveryLastErrorCode: null,
        },
      });
      return;
    }

    if (
      deployment.operation === MsaidiziUpdateDeploymentOperation.APPLY &&
      (outcome === MsaidiziUpdateDeploymentStatus.FAILED ||
        outcome === MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION)
    ) {
      let wave;
      try {
        wave = await this.queueAutomaticRollbackDeployments(tx, deployment);
      } catch (error) {
        if (!isDeferrableRecoveryError(error)) throw error;
        await this.markRecoveryPending(tx, deployment, healthSummary, error);
        return;
      }
      const rollbackProved = wave.unprovenDeviceCount === 0;
      await tx.msaidiziUpdateCandidate.update({
        where: { id: deployment.candidateId },
        data: {
          status: rollbackProved
            ? MsaidiziUpdateCandidateStatus.ROLLED_BACK
            : MsaidiziUpdateCandidateStatus.FAILED,
          healthSummary: persistedJson({
            ...(healthSummary as Prisma.InputJsonObject),
            rollbackInProgress: !rollbackProved,
            requiredRollbackDevices: wave.requiredDeviceCount,
            remainingRollbackDevices: wave.unprovenDeviceCount,
            queuedRollbackDeployments: wave.newlyQueuedCount,
            unavailableRollbackDevices: wave.unavailableDeviceCount,
            unavailableRollbackDeviceSetSha256: wave.unavailableDeviceSetSha256,
          }),
          ...(rollbackProved ? { rolledBackAt: now } : {}),
          recoveryPending: wave.unavailableDeviceCount > 0,
          recoveryRequestedAt: wave.unavailableDeviceCount > 0 ? now : null,
          recoveryLastErrorCode:
            wave.unavailableDeviceCount > 0 ? 'RECOVERY_TARGET_UNAVAILABLE' : null,
        },
      });
      return;
    }

    await tx.msaidiziUpdateCandidate.update({
      where: { id: deployment.candidateId },
      data: { status: MsaidiziUpdateCandidateStatus.FAILED, healthSummary },
    });
  }

  private async markRecoveryPending(
    tx: Prisma.TransactionClient,
    deployment: SupervisorDeployment,
    healthSummary: Prisma.InputJsonValue,
    error: unknown,
  ): Promise<void> {
    const now = new Date();
    const errorCode = recoveryErrorCode(error);
    await tx.msaidiziUpdateCandidate.update({
      where: { id: deployment.candidateId },
      data: {
        status: MsaidiziUpdateCandidateStatus.FAILED,
        recoveryPending: true,
        recoveryRequestedAt: now,
        recoveryLastAttemptAt: now,
        recoveryLastErrorCode: errorCode,
        healthSummary: persistedJson({
          ...(healthSummary as Prisma.InputJsonObject),
          rollbackInProgress: false,
          rollbackDispatchPending: true,
          recoveryErrorCode: errorCode,
          recoveryRequestedAt: now.toISOString(),
        }),
      },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: 'MSAIDIZI_UPDATE_RECOVERY_PENDING',
      entityType: 'MsaidiziUpdateCandidate',
      entityId: deployment.candidateId,
      userId: deployment.candidate.proposedByTask?.initiatedByUserId,
      companyId: deployment.candidate.proposedByTask?.companyId ?? null,
      newValue: persistedJson({
        sourceDeploymentId: deployment.id,
        operation: deployment.operation,
        ring: deployment.ring,
        errorCode,
        requestedAt: now.toISOString(),
      }) as Prisma.InputJsonObject,
      severity: AuditSeverity.CRITICAL,
      channel: AuditChannel.AGENT,
      agentSessionId: deployment.candidate.proposedByTaskId
        ? taskSessionId(deployment.candidate.proposedByTaskId)
        : undefined,
      principalType: 'MSAIDIZI',
      principalId: deployment.candidate.principalId,
      mandateId: deployment.candidate.proposedByTask?.mandateId,
      initiatedByUserId: deployment.candidate.proposedByTask?.initiatedByUserId,
      taskId: deployment.candidate.proposedByTaskId,
      stepId: deployment.candidate.proposedByStepId,
      deviceId: deployment.deviceId,
    });
  }

  private async automaticEligiblePopulationEvidence(
    tx: Prisma.TransactionClient,
    candidate: SupervisorDeployment['candidate'],
  ) {
    const cohortIds = automaticCohortDeviceIds(candidate);
    const eligible = await this.lockAndLoadEligibleDevices(tx, cohortIds, [
      MsaidiziDeviceStatus.ACTIVE,
      MsaidiziDeviceStatus.OFFLINE,
    ]);
    const eligibleIds = new Set((eligible ?? []).map(({ id }) => id));
    const succeeded = await tx.msaidiziUpdateDeployment.findMany({
      where: {
        candidateId: candidate.id,
        operation: MsaidiziUpdateDeploymentOperation.APPLY,
        status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
        deviceId: { in: cohortIds },
      },
      select: { deviceId: true },
    });
    const succeededIds = new Set(succeeded.map(({ deviceId }) => deviceId));
    const uncoveredIds = cohortIds.filter((id) => !eligibleIds.has(id) || !succeededIds.has(id));
    return {
      complete: cohortIds.length > 0 && uncoveredIds.length === 0,
      eligibleDeviceCount: eligibleIds.size,
      cohortDeviceCount: cohortIds.length,
      succeededEligibleDeviceCount: cohortIds.filter(
        (id) => eligibleIds.has(id) && succeededIds.has(id),
      ).length,
      uncoveredDeviceCount: uncoveredIds.length,
      uncoveredDeviceSetSha256: deviceSetDigest(uncoveredIds),
    };
  }

  private async queueAutomaticRollbackDeployments(
    tx: Prisma.TransactionClient,
    sourceDeployment: Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>,
    excludeDeviceId?: string,
  ) {
    const signed = signedDeploymentClaims(sourceDeployment);
    const mayHaveActivated = await tx.msaidiziUpdateDeployment.findMany({
      where: {
        candidateId: sourceDeployment.candidateId,
        operation: MsaidiziUpdateDeploymentOperation.APPLY,
        ...(excludeDeviceId ? { deviceId: { not: excludeDeviceId } } : {}),
        OR: [
          {
            ring: { lt: sourceDeployment.ring },
            status: MsaidiziUpdateDeploymentStatus.SUCCEEDED,
          },
          {
            ring: sourceDeployment.ring,
            status: {
              in: [
                MsaidiziUpdateDeploymentStatus.APPLYING,
                MsaidiziUpdateDeploymentStatus.HEALTH_CHECK,
                MsaidiziUpdateDeploymentStatus.SUCCEEDED,
                MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION,
              ],
            },
          },
          {
            ring: sourceDeployment.ring,
            status: MsaidiziUpdateDeploymentStatus.FAILED,
            startedAt: { not: null },
          },
        ],
      },
      select: { deviceId: true, resultSummary: true },
    });
    const deviceIds = [
      ...new Set(
        mayHaveActivated
          .filter(({ resultSummary }) => !isKnownPreBoundaryDisableSettlement(resultSummary))
          .map(({ deviceId }) => deviceId),
      ),
    ].sort();
    return this.queueRollbackDeploymentsInTransaction(tx, {
      candidateId: sourceDeployment.candidateId,
      deviceIds,
      ring: sourceDeployment.ring as 0 | 5 | 25 | 100,
      signed,
    });
  }

  private async queueRollbackDeploymentsInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      candidateId: string;
      deviceIds: string[];
      ring: 0 | 5 | 25 | 100;
      signed: SignedDeploymentTarget;
    },
  ) {
    const deviceIds = [...new Set(input.deviceIds)].sort();
    if (deviceIds.length === 0) {
      return {
        deployments: [] as Array<Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>>,
        requiredDeviceCount: 0,
        newlyQueuedCount: 0,
        unprovenDeviceCount: 0,
        unavailableDeviceCount: 0,
        unavailableDeviceSetSha256: deviceSetDigest([]),
      };
    }

    await this.lockDeviceRows(tx, deviceIds);
    const eligibleDevices = await tx.msaidiziDevice.findMany({
      where: {
        id: { in: deviceIds },
        status: { in: [MsaidiziDeviceStatus.ACTIVE, MsaidiziDeviceStatus.OFFLINE] },
      },
      select: { id: true },
    });
    const eligibleDeviceIds = new Set(eligibleDevices.map(({ id }) => id));

    const existing = await tx.msaidiziUpdateDeployment.findMany({
      where: {
        candidateId: input.candidateId,
        deviceId: { in: deviceIds },
        operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
      },
      orderBy: [{ ring: 'desc' }, { id: 'asc' }],
    });
    const existingByDevice = new Map<string, typeof existing>();
    for (const deployment of existing) {
      if (!sameSignedTarget(input.signed, signedDeploymentClaims(deployment))) {
        throw new ConflictException(
          'Existing rollback deployment targets different signed update artifacts',
        );
      }
      const rows = existingByDevice.get(deployment.deviceId) ?? [];
      rows.push(deployment);
      existingByDevice.set(deployment.deviceId, rows);
    }

    const deployments: Array<Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>> = [];
    let newlyQueuedCount = 0;
    let signerReady = false;
    for (const deviceId of deviceIds) {
      const prior = existingByDevice.get(deviceId) ?? [];
      // Prefer a completed proof, then an active/uncertain command. Even a
      // definitively failed immutable command remains visible instead of being
      // retried autonomously; oversight must resolve that device explicitly.
      const reusable =
        prior.find(({ status }) => status === MsaidiziUpdateDeploymentStatus.ROLLED_BACK) ??
        prior.find(({ status }) => status !== MsaidiziUpdateDeploymentStatus.FAILED) ??
        prior[0];
      if (reusable) {
        deployments.push(reusable);
        continue;
      }
      if (!eligibleDeviceIds.has(deviceId)) continue;
      if (!signerReady) {
        this.signer.assertReady();
        signerReady = true;
      }
      const id = randomUUID();
      const deliveryLeaseId = randomUUID();
      const idempotencyKey = createHash('sha256')
        .update(
          `${input.candidateId}\0${deviceId}\0${input.ring}\0${MsaidiziUpdateDeploymentOperation.ROLLBACK}`,
          'utf8',
        )
        .digest('hex');
      const issued = this.signer.issue({
        schemaVersion: 2,
        deploymentId: id,
        candidateId: input.candidateId,
        deviceId,
        operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
        ring: input.ring,
        targetId: input.signed.targetId,
        version: input.signed.version,
        rollbackVersion: input.signed.rollbackVersion,
        sourceArtifactSha256: input.signed.sourceArtifactSha256,
        rollbackArtifactSha256: input.signed.rollbackArtifactSha256,
        healthTimeoutSeconds: input.signed.healthTimeoutSeconds,
        minimumHealthySoakSeconds: input.signed.minimumHealthySoakSeconds,
        minimumRingDwellSeconds: input.signed.minimumRingDwellSeconds,
        deliveryLeaseId,
        deliveryAttempt: 1,
        idempotencyKey,
      });
      deployments.push(
        await tx.msaidiziUpdateDeployment.upsert({
          where: {
            candidateId_deviceId_ring_operation: {
              candidateId: input.candidateId,
              deviceId,
              ring: input.ring,
              operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
            },
          },
          update: {},
          create: {
            id,
            candidateId: input.candidateId,
            deviceId,
            operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
            ring: input.ring,
            targetId: input.signed.targetId,
            idempotencyKey,
            manifestJson: issued.manifestJson,
            manifestSha256: issued.manifestSha256,
            manifestSignature: issued.signature,
            signingKeyId: issued.signingKeyId,
            deliveryLeaseId,
            deliveryLeaseExpiresAt: signedManifestExpiry(issued.manifestJson),
          },
        }),
      );
      newlyQueuedCount += 1;
    }
    const provedDeviceIds = new Set(
      deployments
        .filter(({ status }) => status === MsaidiziUpdateDeploymentStatus.ROLLED_BACK)
        .map(({ deviceId }) => deviceId),
    );
    const unavailableDeviceIds = deviceIds.filter(
      (deviceId) => !eligibleDeviceIds.has(deviceId) && !provedDeviceIds.has(deviceId),
    );
    return {
      deployments,
      requiredDeviceCount: deviceIds.length,
      newlyQueuedCount,
      unprovenDeviceCount: deviceIds.filter((deviceId) => !provedDeviceIds.has(deviceId)).length,
      unavailableDeviceCount: unavailableDeviceIds.length,
      unavailableDeviceSetSha256: deviceSetDigest(unavailableDeviceIds),
    };
  }

  private async countUnprovenRollbackDevices(
    tx: Prisma.TransactionClient,
    candidateId: string,
    signed: SignedDeploymentTarget,
    includeDurableRecoveryGap: boolean,
  ): Promise<number> {
    const [deployments, candidate] = await Promise.all([
      tx.msaidiziUpdateDeployment.findMany({
        where: {
          candidateId,
          operation: MsaidiziUpdateDeploymentOperation.ROLLBACK,
        },
      }),
      tx.msaidiziUpdateCandidate.findUnique({
        where: { id: candidateId },
        select: { recoveryPending: true },
      }),
    ]);
    const proofByDevice = new Map<string, boolean>();
    for (const deployment of deployments) {
      if (!sameSignedTarget(signed, signedDeploymentClaims(deployment))) {
        throw new ConflictException(
          'Rollback completion targets different signed update artifacts',
        );
      }
      proofByDevice.set(
        deployment.deviceId,
        (proofByDevice.get(deployment.deviceId) ?? false) ||
          deployment.status === MsaidiziUpdateDeploymentStatus.ROLLED_BACK,
      );
    }
    const unproven = [...proofByDevice.values()].filter((proved) => !proved).length;
    return Math.max(unproven, includeDurableRecoveryGap && candidate?.recoveryPending ? 1 : 0);
  }

  private async findScoped(id: string, user: AuthUser): Promise<UpdateDetail> {
    const candidate = await this.prisma.msaidiziUpdateCandidate.findFirst({
      where: {
        id,
        proposedByTask: {
          initiatedByUserId: user.id,
          ...taskCompanyScope(user),
        },
      },
      include: UPDATE_INCLUDE,
    });
    if (!candidate) throw new NotFoundException('Update candidate not found');
    return candidate;
  }

  private async writeAudit(
    action: string,
    candidate: UpdateDetail,
    user: AuthUser,
    companyId?: string | null,
  ) {
    await this.audit.log({
      action,
      entityType: 'MsaidiziUpdateCandidate',
      entityId: candidate.id,
      userId: user.id,
      companyId: companyId ?? undefined,
      principalType: 'MSAIDIZI',
      principalId: candidate.principalId,
      taskId: candidate.proposedByTaskId ?? undefined,
      newValue: {
        status: candidate.status,
        name: candidate.name,
        version: candidate.version,
        scope: candidate.scope,
        rolloutRing: candidate.rolloutRing,
        automaticProgressionEnabled: candidate.automaticProgressionEnabled,
      },
    });
  }
}

function taskCompanyScope(user: AuthUser): Prisma.MsaidiziTaskWhereInput {
  const companyScope = companyWhereForUser(user);
  return isGroupScopedUser(user) ? { OR: [{ companyId: null }, companyScope] } : companyScope;
}

function taskSessionId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '')}`;
}

function stableDeviceRank(candidateId: string, deviceId: string): string {
  return createHash('sha256').update(`${candidateId}\0${deviceId}`, 'utf8').digest('hex');
}

function deviceSetDigest(deviceIds: readonly string[]): string {
  return createHash('sha256')
    .update([...deviceIds].sort().join('\0'), 'utf8')
    .digest('hex');
}

function automaticCohortDeviceIds(candidate: {
  automaticProgressionCohortDeviceIds: Prisma.JsonValue | null;
  automaticProgressionCohortSha256: string | null;
  automaticProgressionCohortCapturedAt: Date | null;
}): string[] {
  const raw = candidate.automaticProgressionCohortDeviceIds;
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.some((id) => typeof id !== 'string' || !isUuid(id)) ||
    new Set(raw).size !== raw.length ||
    !candidate.automaticProgressionCohortCapturedAt
  ) {
    throw new ConflictException('Automatic rollout has no valid immutable cohort');
  }
  const ids = [...raw].sort() as string[];
  if (candidate.automaticProgressionCohortSha256 !== deviceSetDigest(ids)) {
    throw new ConflictException('Automatic rollout cohort digest does not match membership');
  }
  return ids;
}

function protectedRingDwellMinimum(ring: number): number {
  if (ring === 0 || ring === 5) return 86_400;
  if (ring === 25) return 172_800;
  if (ring === 100) return 259_200;
  throw new ConflictException('Automatic rollout ring is invalid');
}

function minimumRingDwellFor(
  candidate: {
    automaticProgressionRing0DwellSeconds: number | null;
    automaticProgressionRing5DwellSeconds: number | null;
    automaticProgressionRing25DwellSeconds: number | null;
    automaticProgressionRing100DwellSeconds: number | null;
  },
  ring: number,
): number {
  const configured =
    ring === 0
      ? candidate.automaticProgressionRing0DwellSeconds
      : ring === 5
        ? candidate.automaticProgressionRing5DwellSeconds
        : ring === 25
          ? candidate.automaticProgressionRing25DwellSeconds
          : ring === 100
            ? candidate.automaticProgressionRing100DwellSeconds
            : null;
  if (
    !Number.isSafeInteger(configured) ||
    configured === null ||
    configured < protectedRingDwellMinimum(ring)
  ) {
    throw new ConflictException('Automatic rollout has no valid protected ring dwell policy');
  }
  return configured;
}

function automaticRingEvidenceDigest(
  candidateId: string,
  ring: number,
  healthyAt: Date,
  cohortSha256: string,
  minimumRingDwellSeconds: number,
): string {
  if (!/^[0-9a-f]{64}$/.test(cohortSha256)) {
    throw new ConflictException('Automatic rollout cohort evidence is invalid');
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        protocol: 'MSAIDIZI-AUTOMATIC-RING-DWELL-V1',
        candidateId,
        ring,
        healthyAt: healthyAt.toISOString(),
        cohortSha256,
        minimumRingDwellSeconds,
      }),
      'utf8',
    )
    .digest('hex');
}

function automaticEvidenceRowMatchesCandidate(
  row: AutomaticEvaluationEvidenceRow,
  candidate: UpdateDetail,
): boolean {
  try {
    const envelope = {
      claimsJson: canonicalAttestationJson(row.canonicalClaims),
      signature: row.signature,
    };
    const parsed =
      row.kind === MsaidiziUpdateEvaluationAttestationKind.RUNNER
        ? parseEvaluationRunnerAttestation(envelope)
        : parseModelReviewAttestation(envelope);
    const claims = parsed.claims;
    const expectedType =
      row.kind === MsaidiziUpdateEvaluationAttestationKind.RUNNER
        ? 'UPDATE_EVALUATION_RUNNER'
        : 'UPDATE_MODEL_REVIEW';
    return (
      row.candidateId === candidate.id &&
      row.taskId === candidate.proposedByTaskId &&
      row.planVersionId === candidate.proposedByPlanVersionId &&
      row.stepId === candidate.proposedByStepId &&
      row.sourceArtifactId === candidate.sourceArtifactId &&
      row.sourceArtifactSha256 === candidate.sourceArtifactSha256 &&
      row.rollbackArtifactId === candidate.rollbackArtifactId &&
      row.rollbackArtifactSha256 === candidate.rollbackArtifactSha256 &&
      row.reportArtifactId === candidate.evaluationReportArtifactId &&
      row.reportArtifactSha256 === candidate.evaluationReportArtifactSha256 &&
      parsed.claimsDigest === row.claimsDigest &&
      claims.type === expectedType &&
      claims.candidateId === row.candidateId &&
      claims.taskId === row.taskId &&
      claims.planVersionId === row.planVersionId &&
      claims.stepId === row.stepId &&
      claims.signerKeyId === row.signerKeyId &&
      claims.verdict === row.verdict &&
      claims.evaluationRunId === row.evaluationRunId &&
      claims.cleanSnapshotId === row.cleanSnapshotId &&
      claims.sourceArtifactId === row.sourceArtifactId &&
      claims.sourceArtifactSha256 === row.sourceArtifactSha256 &&
      claims.rollbackArtifactId === row.rollbackArtifactId &&
      claims.rollbackArtifactSha256 === row.rollbackArtifactSha256 &&
      claims.reportArtifactId === row.reportArtifactId &&
      claims.reportArtifactSha256 === row.reportArtifactSha256 &&
      (row.kind !== MsaidiziUpdateEvaluationAttestationKind.MODEL_REVIEW ||
        (claims.type === 'UPDATE_MODEL_REVIEW' &&
          claims.runnerClaimsDigest === row.runnerClaimsDigest &&
          claims.reviewerId === row.reviewerId &&
          claims.modelId === row.modelId))
    );
  } catch {
    return false;
  }
}

function automaticRunnerClaimsArePassing(row: AutomaticEvaluationEvidenceRow): boolean {
  const claims = jsonObject(row.canonicalClaims);
  const checks = jsonObject(claims.checks as Prisma.JsonValue | null);
  const schemaVersion = claims.schemaVersion;
  const required = [
    'isolatedWindowsVm',
    'tests',
    'staticAnalysis',
    'adversarialEvaluation',
    'supervisorIntegrity',
    'protectedBoundaryDiff',
    ...(schemaVersion === 2 ? ['baseRevisionMatch', 'ntfsReparseHardLinkAndToctouIsolation'] : []),
  ];
  return (
    (schemaVersion === 1 || schemaVersion === 2) &&
    Object.keys(checks).length === required.length &&
    required.every((check) => checks[check] === true) &&
    Array.isArray(claims.failureCodes) &&
    claims.failureCodes.length === 0
  );
}

function allBooleanChecksPass(value: Prisma.JsonValue): boolean {
  const checks = jsonObject(value);
  const required = [
    'isolatedWindowsVm',
    'baseRevisionMatch',
    'tests',
    'staticAnalysis',
    'adversarialEvaluation',
    'supervisorIntegrity',
    'protectedBoundaryDiff',
    'ntfsReparseHardLinkAndToctouIsolation',
    'dualIndependentModelReview',
  ];
  return (
    Object.keys(checks).length === required.length &&
    required.every((check) => checks[check] === true)
  );
}

function identityKey(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function signedManifestExpiry(manifestJson: string): Date {
  try {
    const value = (JSON.parse(manifestJson) as Record<string, unknown>).expiresAt;
    if (typeof value !== 'string') throw new Error('missing expiry');
    const expiresAt = new Date(value);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.toISOString() !== value) {
      throw new Error('invalid expiry');
    }
    return expiresAt;
  } catch {
    throw new ConflictException('The signed update manifest expiry is invalid');
  }
}

function appendManifestHistory(
  deployment: Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>,
): Prisma.InputJsonArray {
  const existing = manifestHistoryEntries(deployment.manifestHistory);
  if (deployment.dispatchCount === 0) return existing as Prisma.InputJsonArray;
  if (!deployment.deliveryLeaseId || !isUuid(deployment.deliveryLeaseId)) {
    throw new ConflictException('The prior delivery lease is invalid');
  }
  if (!existing.some(({ manifestSha256 }) => manifestSha256 === deployment.manifestSha256)) {
    existing.push({
      manifestSha256: deployment.manifestSha256,
      deliveryLeaseId: deployment.deliveryLeaseId,
      deliveryAttempt: deployment.dispatchCount,
      deliveryAcknowledgedAt: deployment.deliveryAcknowledgedAt?.toISOString() ?? null,
    });
  }
  if (existing.length > 1_000) {
    throw new ConflictException('Update delivery attempt history exceeded its safety ceiling');
  }
  return existing as Prisma.InputJsonArray;
}

function deploymentAcceptsAcknowledgedManifestDigest(
  deployment: Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>,
  reportedDigest: string,
): boolean {
  const digest = reportedDigest.toLowerCase();
  return (
    (deployment.manifestSha256 === digest && deployment.deliveryAcknowledgedAt !== null) ||
    manifestHistoryEntries(deployment.manifestHistory).some(
      ({ manifestSha256, deliveryAcknowledgedAt }) =>
        manifestSha256 === digest && deliveryAcknowledgedAt !== null,
    )
  );
}

function manifestHistoryEntries(value: Prisma.JsonValue): Array<{
  manifestSha256: string;
  deliveryLeaseId: string;
  deliveryAttempt: number;
  deliveryAcknowledgedAt: string | null;
}> {
  if (!Array.isArray(value)) {
    throw new ConflictException('Update delivery attempt history is invalid');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ConflictException('Update delivery attempt history is invalid');
    }
    const record = entry as Record<string, unknown>;
    const acknowledgedAt =
      typeof record.deliveryAcknowledgedAt === 'string'
        ? new Date(record.deliveryAcknowledgedAt)
        : null;
    if (
      Object.keys(record).sort().join(',') !==
        'deliveryAcknowledgedAt,deliveryAttempt,deliveryLeaseId,manifestSha256' ||
      typeof record.manifestSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(record.manifestSha256) ||
      typeof record.deliveryLeaseId !== 'string' ||
      !isUuid(record.deliveryLeaseId) ||
      typeof record.deliveryAttempt !== 'number' ||
      !Number.isSafeInteger(record.deliveryAttempt) ||
      record.deliveryAttempt < 1 ||
      (record.deliveryAcknowledgedAt !== null &&
        (typeof record.deliveryAcknowledgedAt !== 'string' ||
          !Number.isFinite(acknowledgedAt?.getTime()) ||
          acknowledgedAt?.toISOString() !== record.deliveryAcknowledgedAt))
    ) {
      throw new ConflictException('Update delivery attempt history is invalid');
    }
    return {
      manifestSha256: record.manifestSha256,
      deliveryLeaseId: record.deliveryLeaseId,
      deliveryAttempt: record.deliveryAttempt,
      deliveryAcknowledgedAt: record.deliveryAcknowledgedAt as string | null,
    };
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDeferrableRecoveryError(error: unknown): boolean {
  return error instanceof ServiceUnavailableException || error instanceof ConflictException;
}

function recoveryErrorCode(error: unknown): string {
  if (error instanceof ServiceUnavailableException) return 'TRUSTED_SIGNER_UNAVAILABLE';
  if (error instanceof ConflictException) return 'RECOVERY_PRECONDITION_UNAVAILABLE';
  return 'RECOVERY_DISPATCH_FAILED';
}

function jsonObject(value: Prisma.JsonValue | null): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

function isKnownPreBoundaryDisableSettlement(value: Prisma.JsonValue | null): boolean {
  const summary = jsonObject(value);
  return (
    summary.source === 'device-disable-reconciliation' &&
    summary.mutationStarted === false &&
    summary.updateBoundaryCrossed === false
  );
}

function resultDigest(dto: MsaidiziUpdateResultDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        deviceId: dto.deviceId,
        deploymentId: dto.deploymentId,
        outcome: dto.outcome,
        manifestSha256: dto.manifestSha256.toLowerCase(),
        journalHeadSha256: dto.journalHeadSha256.toLowerCase(),
        activatedArtifactSha256: dto.activatedArtifactSha256?.toLowerCase() ?? null,
        observedVersion: dto.observedVersion ?? null,
        health: sortJson(dto.health),
        reason: dto.reason ?? null,
      }),
      'utf8',
    )
    .digest('hex');
}

function requiresHealthyTerminalEvidence(outcome: MsaidiziUpdateDeploymentStatus): boolean {
  return (
    outcome === MsaidiziUpdateDeploymentStatus.SUCCEEDED ||
    outcome === MsaidiziUpdateDeploymentStatus.ROLLED_BACK
  );
}

function validateHealthySoakEvidence(
  deployment: Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>,
  dto: MsaidiziUpdateResultDto,
  receivedAt: Date,
): string {
  const dwellStartedAt =
    deployment.healthCheckStartedAt ??
    (deployment.status === MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION
      ? deployment.startedAt
      : null);
  if (
    (deployment.status !== MsaidiziUpdateDeploymentStatus.HEALTH_CHECK &&
      deployment.status !== MsaidiziUpdateDeploymentStatus.NEEDS_ATTENTION) ||
    !dwellStartedAt
  ) {
    throw new ConflictException('A protected health-check dwell was not started');
  }
  const signed = signedDeploymentClaims(deployment);
  const metrics = dto.health;
  const attempts = finiteNumber(metrics.attempts);
  const healthyProbeCount = finiteNumber(metrics.healthyProbeCount);
  const continuousHealthySeconds = finiteNumber(metrics.continuousHealthySeconds);
  const requiredSoakSeconds = finiteNumber(metrics.requiredSoakSeconds);
  const healthySince = strictIsoDate(metrics.healthySince);
  const healthyThrough = strictIsoDate(metrics.healthyThrough);
  const observedDwellMs = receivedAt.getTime() - dwellStartedAt.getTime();
  const supervisorDwellMs = healthyThrough.getTime() - healthySince.getTime();
  const requiredDwellMs = signed.minimumHealthySoakSeconds * 1_000;
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 2 ||
    !Number.isSafeInteger(healthyProbeCount) ||
    healthyProbeCount < 2 ||
    continuousHealthySeconds < signed.minimumHealthySoakSeconds ||
    requiredSoakSeconds !== signed.minimumHealthySoakSeconds ||
    supervisorDwellMs < requiredDwellMs ||
    observedDwellMs < requiredDwellMs ||
    healthyThrough.getTime() > receivedAt.getTime() + 5 * 60_000 ||
    healthySince.getTime() < dwellStartedAt.getTime() - 5 * 60_000
  ) {
    throw new ConflictException('Supervisor healthy-soak evidence does not satisfy signed policy');
  }
  return createHash('sha256')
    .update(
      JSON.stringify(
        sortJson({
          deploymentId: deployment.id,
          manifestSha256: dto.manifestSha256.toLowerCase(),
          healthCheckStartedAt: deployment.healthCheckStartedAt?.toISOString() ?? null,
          brokerDwellStartedAt: dwellStartedAt.toISOString(),
          receivedAt: receivedAt.toISOString(),
          attempts,
          healthyProbeCount,
          healthySince: healthySince.toISOString(),
          healthyThrough: healthyThrough.toISOString(),
          continuousHealthySeconds,
          requiredSoakSeconds,
          observedVersion: dto.observedVersion ?? null,
        }),
      ),
      'utf8',
    )
    .digest('hex');
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function strictIsoDate(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new ConflictException('Supervisor healthy-soak timestamps are missing');
  }
  // JavaScript emits millisecond UTC timestamps while .NET's round-trip ("O")
  // format emits seven fractional digits and commonly uses an explicit +00:00
  // offset. Accept only those two UTC wire shapes; reject local/non-zero zones
  // and validate every calendar component before discarding sub-ms precision.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3,7})(?:Z|\+00:00)$/.exec(
    value,
  );
  if (!match || match[0] !== value) {
    throw new ConflictException('Supervisor healthy-soak timestamps are invalid');
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const millisecond = Number(match[7].slice(0, 3));
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month - 1, day);
  parsed.setUTCHours(hour, minute, second, millisecond);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second ||
    parsed.getUTCMilliseconds() !== millisecond
  ) {
    throw new ConflictException('Supervisor healthy-soak timestamps are invalid');
  }
  return parsed;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function signedDeploymentClaims(
  deployment: Prisma.MsaidiziUpdateDeploymentGetPayload<Record<string, never>>,
): SignedDeploymentTarget {
  try {
    const manifest = JSON.parse(deployment.manifestJson) as Record<string, unknown>;
    const targetId = manifest.targetId;
    const version = manifest.version;
    const rollbackVersion = manifest.rollbackVersion;
    const sourceArtifactSha256 = manifest.sourceArtifactSha256;
    const rollbackArtifactSha256 = manifest.rollbackArtifactSha256;
    const healthTimeoutSeconds = manifest.healthTimeoutSeconds;
    const minimumHealthySoakSeconds = manifest.minimumHealthySoakSeconds;
    const minimumRingDwellSeconds = manifest.minimumRingDwellSeconds;
    const deliveryLeaseId = manifest.deliveryLeaseId;
    const deliveryAttempt = manifest.deliveryAttempt;
    if (
      manifest.schemaVersion !== 2 ||
      manifest.deploymentId !== deployment.id ||
      manifest.candidateId !== deployment.candidateId ||
      manifest.deviceId !== deployment.deviceId ||
      manifest.operation !== deployment.operation ||
      manifest.ring !== deployment.ring ||
      targetId !== deployment.targetId ||
      typeof targetId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(targetId) ||
      typeof version !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(version) ||
      typeof rollbackVersion !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(rollbackVersion) ||
      typeof sourceArtifactSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(sourceArtifactSha256) ||
      typeof rollbackArtifactSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(rollbackArtifactSha256) ||
      typeof healthTimeoutSeconds !== 'number' ||
      !Number.isSafeInteger(healthTimeoutSeconds) ||
      healthTimeoutSeconds < 5 ||
      healthTimeoutSeconds > 900 ||
      typeof minimumHealthySoakSeconds !== 'number' ||
      !Number.isSafeInteger(minimumHealthySoakSeconds) ||
      minimumHealthySoakSeconds < 1 ||
      minimumHealthySoakSeconds >= healthTimeoutSeconds ||
      typeof minimumRingDwellSeconds !== 'number' ||
      !Number.isSafeInteger(minimumRingDwellSeconds) ||
      minimumRingDwellSeconds < protectedRingDwellMinimum(deployment.ring) ||
      typeof deliveryLeaseId !== 'string' ||
      !isUuid(deliveryLeaseId) ||
      deliveryLeaseId !== deployment.deliveryLeaseId ||
      typeof deliveryAttempt !== 'number' ||
      !Number.isSafeInteger(deliveryAttempt) ||
      deliveryAttempt < 1 ||
      manifest.idempotencyKey !== deployment.idempotencyKey ||
      ![0, 5, 25, 100].includes(deployment.ring)
    ) {
      throw new Error('invalid signed claims');
    }
    return {
      targetId,
      version,
      rollbackVersion,
      sourceArtifactSha256,
      rollbackArtifactSha256,
      healthTimeoutSeconds,
      minimumHealthySoakSeconds,
      minimumRingDwellSeconds,
    };
  } catch {
    throw new ConflictException('The persisted signed update manifest is invalid');
  }
}

function sameSignedTarget(
  expected: SignedDeploymentTarget,
  actual: SignedDeploymentTarget,
): boolean {
  return (
    expected.targetId === actual.targetId &&
    expected.version === actual.version &&
    expected.rollbackVersion === actual.rollbackVersion &&
    expected.sourceArtifactSha256 === actual.sourceArtifactSha256 &&
    expected.rollbackArtifactSha256 === actual.rollbackArtifactSha256 &&
    expected.healthTimeoutSeconds === actual.healthTimeoutSeconds &&
    expected.minimumHealthySoakSeconds === actual.minimumHealthySoakSeconds
  );
}

function assertCandidateMatchesSignedTarget(
  candidate: UpdateDetail,
  signed: SignedDeploymentTarget,
): void {
  if (
    !candidate.sourceArtifact ||
    !candidate.rollbackArtifact ||
    candidate.scope !== signed.targetId ||
    candidate.version !== signed.version ||
    candidate.rollbackVersion !== signed.rollbackVersion ||
    candidate.sourceArtifact.sha256.toLowerCase() !== signed.sourceArtifactSha256 ||
    candidate.rollbackArtifact.sha256.toLowerCase() !== signed.rollbackArtifactSha256 ||
    (candidate.automaticProgressionEnabled &&
      (candidate.automaticProgressionHealthTimeoutSeconds !== signed.healthTimeoutSeconds ||
        candidate.automaticProgressionMinimumSoakSeconds !== signed.minimumHealthySoakSeconds))
  ) {
    throw new ConflictException('Candidate no longer matches its signed deployment target');
  }
}

function canDispatchUpdate(
  operation: MsaidiziUpdateDeploymentOperation,
  candidateStatus: MsaidiziUpdateCandidateStatus,
): boolean {
  if (operation === MsaidiziUpdateDeploymentOperation.APPLY) {
    return (
      candidateStatus === MsaidiziUpdateCandidateStatus.APPROVED ||
      candidateStatus === MsaidiziUpdateCandidateStatus.CANARY
    );
  }
  return (
    candidateStatus === MsaidiziUpdateCandidateStatus.CANARY ||
    candidateStatus === MsaidiziUpdateCandidateStatus.ACTIVE ||
    candidateStatus === MsaidiziUpdateCandidateStatus.FAILED
  );
}

function persistedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(sanitizePersistedValue(value).value)) as Prisma.InputJsonValue;
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as T;
}
