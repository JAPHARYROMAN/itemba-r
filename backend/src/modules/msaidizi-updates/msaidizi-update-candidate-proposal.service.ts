import { Injectable } from '@nestjs/common';
import {
  AuditChannel,
  AuditSeverity,
  MsaidiziArtifactKind,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  MsaidiziTrustLevel,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateEvaluationRunStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  MsaidiziArtifactsService,
  PreparedToolObservationArtifact,
} from '../msaidizi-artifacts/msaidizi-artifacts.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { stepLocalIoState } from '../msaidizi-task-runtime/msaidizi-step-controls';
import { remainingTaskWallTimeMs } from '../msaidizi-task-runtime/msaidizi-task-wall-time';
import {
  assertUpdateCandidateProposalStep,
  ArtifactBackedUpdateCandidateProposalArguments,
  GENERATED_UPDATE_POLICY_VERSION,
  GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
  generatedUpdateManifest,
  generatedUpdateEvaluationRequestDigest,
  generatedUpdateRequiredChecks,
  GeneratedUpdateCandidateProposalArguments,
  isGeneratedUpdateCandidateProposal,
  mandateAuthorizesUpdateCandidateProposal,
  UpdateCandidateProposalArguments,
  updateCandidateProposalDigest,
  updateCandidateProposalIdempotencyKey,
  UpdateCandidateProposalPolicyError,
  UpdateCandidateProposalPort,
  UpdateCandidateProposalRequest,
  UpdateCandidateProposalResult,
} from './update-candidate-proposal.port';

/**
 * The only autonomous write into the update ledger. This implementation can
 * create one DRAFT row and append evidence; its API has no transition method.
 */
@Injectable()
export class MsaidiziUpdateCandidateProposalService implements UpdateCandidateProposalPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly autonomy: AutonomyConfig,
    private readonly audit: AuditLogsService,
    private readonly artifacts: MsaidiziArtifactsService,
  ) {}

  async propose(request: UpdateCandidateProposalRequest): Promise<UpdateCandidateProposalResult> {
    this.assertGlobalExecutionEnabled();
    let expected: ProposalIdentity | undefined;
    let prepared: PreparedToolObservationArtifact | undefined;
    let preparedCommitted = false;
    try {
      const proposal = await this.prisma.$transaction(async (tx) => {
        const taskLock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${request.taskId} FOR UPDATE
        `;
        if (taskLock.length !== 1) throw policy('UPDATE_PROPOSAL_TASK_NOT_FOUND');

        const task = await tx.msaidiziTask.findUnique({
          where: { id: request.taskId },
          select: {
            id: true,
            principalId: true,
            initiatedByUserId: true,
            companyId: true,
            mandateId: true,
            mode: true,
            status: true,
            activePlanVersion: true,
            startedAt: true,
            consumedWallTimeMs: true,
            wallTimeCheckpointAt: true,
            maxWallTimeSeconds: true,
            maxModelTurns: true,
            maxLocalBytes: true,
            maxExternalEgressBytes: true,
            maxModelCostUsd: true,
            modelTurns: true,
            bytesRead: true,
            bytesWritten: true,
            externalEgressBytes: true,
            reservedExternalEgressBytes: true,
            modelCostUsd: true,
            proposalUsage: { select: { model: true } },
            principal: { select: { status: true } },
            mandate: {
              select: {
                id: true,
                principalId: true,
                status: true,
                startsAt: true,
                expiresAt: true,
                capabilities: true,
              },
            },
          },
        });
        const clockRows = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() AS "now"
        `;
        const databaseNow = clockRows[0]?.now;
        if (!(databaseNow instanceof Date) || !Number.isFinite(databaseNow.getTime())) {
          throw policy('UPDATE_PROPOSAL_DATABASE_CLOCK_UNAVAILABLE');
        }
        const step = await tx.msaidiziTaskStep.findFirst({
          where: { id: request.stepId, taskId: request.taskId },
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
            status: true,
            budgets: true,
            bytesRead: true,
            bytesWritten: true,
            localIoAccountingValid: true,
            planVersion: {
              select: { id: true, taskId: true, version: true, createdByUserId: true },
            },
          },
        });
        const attempt = await tx.msaidiziToolAttempt.findFirst({
          where: {
            id: request.attemptId,
            taskId: request.taskId,
            stepId: request.stepId,
          },
          select: { id: true, status: true },
        });
        this.assertReviewedAuthority(task, step, attempt, request, databaseNow);

        const mandateLock = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "msaidizi_mandates" WHERE "id" = ${task!.mandateId!} FOR SHARE
        `;
        if (mandateLock.length !== 1) throw policy('UPDATE_PROPOSAL_MANDATE_INACTIVE');
        const liveMandate = await tx.msaidiziMandate.findUnique({
          where: { id: task!.mandateId! },
          select: {
            id: true,
            principalId: true,
            status: true,
            startsAt: true,
            expiresAt: true,
            capabilities: true,
          },
        });
        this.assertLiveMandate(task!, liveMandate, databaseNow);

        const args = assertUpdateCandidateProposalStep(step!);
        if (!mandateAuthorizesUpdateCandidateProposal(liveMandate!.capabilities, step!)) {
          throw policy('UPDATE_PROPOSAL_MANDATE_SCOPE_DENIED');
        }
        if (!isGeneratedUpdateCandidateProposal(args)) {
          await this.assertArtifacts(
            tx,
            task!.id,
            step!.planVersionId,
            step!.id,
            step!.dataClass,
            args,
          );
        }

        const proposalDigest = updateCandidateProposalDigest(
          task!.id,
          step!.planVersionId,
          step!.id,
          args,
        );
        const idempotencyKey = updateCandidateProposalIdempotencyKey(
          task!.id,
          step!.planVersionId,
          step!.id,
        );
        expected = {
          taskId: task!.id,
          planVersionId: step!.planVersionId,
          stepId: step!.id,
          args,
          proposalDigest,
          idempotencyKey,
        };
        const generation = isGeneratedUpdateCandidateProposal(args)
          ? (() => {
              const manifest = generatedUpdateManifest(
                task!.id,
                step!.planVersionId,
                step!.id,
                request.attemptId,
                args,
              );
              this.assertGeneratedBudgets(task!, args, manifest.byteSize, databaseNow);
              const candidateId = deterministicUuid(`candidate\0${proposalDigest}`);
              const evaluationRunId = `eval-${candidateId}`;
              const generatorModelId = canonicalModelIdentity(
                task!.proposalUsage?.model ?? 'human-reviewed-plan',
              );
              const requestDigest = generatedUpdateEvaluationRequestDigest({
                candidateId,
                evaluationRunId,
                manifestSha256: manifest.sha256,
                proposalDigest,
                generatorModelId,
                args,
              });
              if (!task!.startedAt) throw policy('UPDATE_PROPOSAL_TASK_NOT_STARTED');
              const remainingWallTimeMs = remainingTaskWallTimeMs(task!, databaseNow);
              const taskDeadline = databaseNow.getTime() + Number(remainingWallTimeMs);
              const requestedDeadline =
                databaseNow.getTime() + args.evaluationBudget.maxWallTimeSeconds * 1_000;
              const deadlineAt = new Date(Math.min(taskDeadline, requestedDeadline));
              if (deadlineAt.getTime() <= databaseNow.getTime()) {
                throw policy('UPDATE_PROPOSAL_WALL_TIME_EXHAUSTED');
              }
              expected = {
                ...expected!,
                manifestSha256: manifest.sha256,
                evaluationRunId,
                requestDigest,
              };
              return {
                manifest,
                candidateId,
                evaluationRunId,
                generatorModelId,
                requestDigest,
                deadlineAt,
                databaseNow,
                remainingWallTimeMs,
              };
            })()
          : null;

        const existing = await tx.msaidiziUpdateCandidate.findUnique({
          where: { proposedByStepId: step!.id },
          include: { evaluationRun: true },
        });
        if (existing) return this.replay(existing, expected);

        // Re-read the deployment-owned switch immediately before the only
        // autonomous mutation in this service. It is intentionally not a
        // database value that a task, model, or mandate can clear.
        this.assertGlobalExecutionEnabled();

        if (isGeneratedUpdateCandidateProposal(args)) {
          if (!generation) throw policy('UPDATE_PROPOSAL_GENERATION_CONTEXT_INVALID');
          const {
            manifest,
            candidateId,
            evaluationRunId,
            generatorModelId,
            requestDigest,
            deadlineAt,
            databaseNow: reservationClock,
            remainingWallTimeMs,
          } = generation;
          const content = Buffer.from(manifest.canonicalJson, 'utf8');
          try {
            prepared = await this.artifacts.prepareToolObservation({
              taskId: task!.id,
              stepId: step!.id,
              attemptId: request.attemptId,
              dataClass: step!.dataClass,
              sourceType: 'UPDATE_GENERATION',
              sourceSha256: manifest.sha256,
              sourceBytes: manifest.byteSize,
              persistedSha256: manifest.sha256,
              persistedBytes: manifest.byteSize,
              redactionsApplied: false,
              content,
            });
          } finally {
            content.fill(0);
          }
          const artifactResult = (await this.artifacts.commitPreparedToolObservation(
            tx,
            prepared,
          )) as { artifact?: { id?: unknown; sha256?: unknown } };
          if (
            artifactResult.artifact?.id !== prepared.artifact.id ||
            artifactResult.artifact?.sha256 !== manifest.sha256
          ) {
            throw policy('UPDATE_PROPOSAL_GENERATION_ARTIFACT_MISMATCH');
          }
          await this.reserveGeneratedEvaluationBudget(tx, task!.id, step!.id, args);
          const candidate = await tx.msaidiziUpdateCandidate.create({
            data: {
              id: candidateId,
              principalId: task!.principalId,
              proposedByTaskId: task!.id,
              proposedByPlanVersionId: step!.planVersionId,
              proposedByStepId: step!.id,
              proposalIdempotencyKey: idempotencyKey,
              proposalDigest,
              proposalRationale: args.rationale,
              generatedSourceArtifactId: prepared.artifact.id,
              generationManifestSha256: manifest.sha256,
              rollbackVersion: args.rollbackVersion,
              name: args.name,
              version: args.version,
              scope: args.scope,
              status: MsaidiziUpdateCandidateStatus.EVALUATING,
              evaluationSummary: {},
              reviewerDecisions: [],
            },
          });
          await tx.msaidiziUpdateEvaluationRun.create({
            data: {
              candidateId: candidate.id,
              taskId: task!.id,
              planVersionId: step!.planVersionId,
              stepId: step!.id,
              attemptId: request.attemptId,
              generationArtifactId: prepared.artifact.id,
              generationArtifactSha256: manifest.sha256,
              generationManifestSha256: manifest.sha256,
              requestDigest,
              evaluationRunId,
              generatorPrincipalId: task!.principalId,
              generatorModelId,
              policyVersion: GENERATED_UPDATE_POLICY_VERSION,
              policyDigest: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
              deadlineAt,
              requiredChecks: persistedJson(generatedUpdateRequiredChecks()),
              provenance: persistedJson({
                producer: 'MSAIDIZI_IMMUTABLE_TASK_STEP',
                taskId: task!.id,
                planVersionId: step!.planVersionId,
                stepId: step!.id,
                attemptId: request.attemptId,
                proposalDigest,
                generationManifestSha256: manifest.sha256,
                protectedSupervisorBoundary: 'EXCLUDED',
                protectedPathPolicyVersion: GENERATED_UPDATE_POLICY_VERSION,
                protectedPathPolicySha256: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
                budgetAccounting: 'PESSIMISTICALLY_RESERVED_BEFORE_TASK_TERMINAL',
                taskWallTimeConsumedMsAtReservation: task!.consumedWallTimeMs.toString(),
                taskWallTimeCheckpointAtReservation:
                  task!.wallTimeCheckpointAt?.toISOString() ?? null,
                wallTimeReservationClockAt: reservationClock.toISOString(),
                remainingTaskWallTimeMsAtReservation: remainingWallTimeMs.toString(),
                deadlineAt: deadlineAt.toISOString(),
              }),
              status: MsaidiziUpdateEvaluationRunStatus.QUEUED,
              ...evaluationBudgetData(args),
            },
          });
          const evidence = persistedJson({
            candidateId: candidate.id,
            status: MsaidiziUpdateCandidateStatus.EVALUATING,
            scope: args.scope,
            proposalDigest,
            generationArtifactId: prepared.artifact.id,
            generationManifestSha256: manifest.sha256,
            evaluationRunId,
            evaluationRequestDigest: requestDigest,
            protectedPathPolicySha256: GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
          });
          await this.recordProposalEvidence(tx, task!, step!.id, candidate.id, evidence);
          return result(
            candidate.id,
            expected,
            false,
            candidate.status,
            MsaidiziUpdateEvaluationRunStatus.QUEUED,
          );
        }

        const candidate = await tx.msaidiziUpdateCandidate.create({
          data: {
            principalId: task!.principalId,
            proposedByTaskId: task!.id,
            proposedByPlanVersionId: step!.planVersionId,
            proposedByStepId: step!.id,
            proposalIdempotencyKey: idempotencyKey,
            proposalDigest,
            proposalRationale: args.rationale,
            sourceArtifactId: args.sourceArtifactId,
            sourceArtifactSha256: args.sourceArtifactSha256,
            rollbackArtifactId: args.rollbackArtifactId,
            rollbackArtifactSha256: args.rollbackArtifactSha256,
            rollbackVersion: args.rollbackVersion,
            name: args.name,
            version: args.version,
            scope: args.scope,
            status: MsaidiziUpdateCandidateStatus.DRAFT,
            evaluationSummary: {},
            reviewerDecisions: [],
          },
        });

        const evidence = persistedJson({
          candidateId: candidate.id,
          status: MsaidiziUpdateCandidateStatus.DRAFT,
          scope: args.scope,
          proposalDigest,
          sourceArtifactId: args.sourceArtifactId,
          sourceArtifactSha256: args.sourceArtifactSha256,
          rollbackArtifactId: args.rollbackArtifactId,
          rollbackArtifactSha256: args.rollbackArtifactSha256,
          rollbackVersion: args.rollbackVersion,
        });
        await this.recordProposalEvidence(tx, task!, step!.id, candidate.id, evidence);
        return result(candidate.id, expected, false);
      });
      preparedCommitted = Boolean(prepared);
      return proposal;
    } catch (error) {
      // A racing redelivery may lose the unique step/idempotency insert. Return
      // only the exact same DRAFT; any other unique collision remains fail-closed.
      if (expected && isUniqueConstraintError(error)) {
        const existing = await this.prisma.msaidiziUpdateCandidate.findUnique({
          where: { proposedByStepId: request.stepId },
          include: { evaluationRun: true },
        });
        if (existing) return this.replay(existing, expected);
        throw policy('UPDATE_PROPOSAL_NAME_VERSION_CONFLICT');
      }
      throw error;
    } finally {
      if (prepared) {
        await this.artifacts.finishPreparedToolObservation(prepared, preparedCommitted);
      }
    }
  }

  private assertGlobalExecutionEnabled(): void {
    if (!this.autonomy.enabled) throw policy('AUTONOMY_DISABLED');
    if (this.autonomy.globalKillSwitchActive) throw policy('GLOBAL_KILL_SWITCH');
  }

  private assertGeneratedBudgets(
    task: {
      startedAt: Date | null;
      consumedWallTimeMs: bigint;
      wallTimeCheckpointAt: Date | null;
      maxWallTimeSeconds: number;
      maxModelTurns: number;
      maxLocalBytes: bigint;
      maxExternalEgressBytes: bigint;
      maxModelCostUsd: Prisma.Decimal;
      modelTurns: number;
      bytesRead: bigint;
      bytesWritten: bigint;
      externalEgressBytes: bigint;
      reservedExternalEgressBytes: bigint;
      modelCostUsd: Prisma.Decimal;
    },
    args: GeneratedUpdateCandidateProposalArguments,
    manifestBytes: number,
    now: Date,
  ): void {
    const budget = args.evaluationBudget;
    const remainingLocal = task.maxLocalBytes - task.bytesRead - task.bytesWritten;
    const remainingEgress =
      task.maxExternalEgressBytes - task.externalEgressBytes - task.reservedExternalEgressBytes;
    const remainingCostMicrousd = decimalUsdToMicrousd(
      new Prisma.Decimal(task.maxModelCostUsd).minus(task.modelCostUsd),
    );
    const remainingWallSeconds = task.startedAt
      ? Number(remainingTaskWallTimeMs(task, now) / 1_000n)
      : 0;
    if (
      budget.maxWallTimeSeconds > remainingWallSeconds ||
      budget.maxModelTurns > task.maxModelTurns - task.modelTurns ||
      budget.maxBytesRead + budget.maxBytesWritten + BigInt(manifestBytes) > remainingLocal ||
      budget.maxExternalEgressBytes > remainingEgress ||
      budget.maxModelCostMicrousd > remainingCostMicrousd
    ) {
      throw policy('UPDATE_PROPOSAL_BUDGET_EXCEEDS_TASK');
    }
  }

  private async reserveGeneratedEvaluationBudget(
    tx: Prisma.TransactionClient,
    taskId: string,
    stepId: string,
    args: GeneratedUpdateCandidateProposalArguments,
  ): Promise<void> {
    const [task, step] = await Promise.all([
      tx.msaidiziTask.findUnique({ where: { id: taskId } }),
      tx.msaidiziTaskStep.findUnique({ where: { id: stepId } }),
    ]);
    const clockRows = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS "now"
    `;
    const databaseNow = clockRows[0]?.now;
    if (!(databaseNow instanceof Date) || !Number.isFinite(databaseNow.getTime())) {
      throw policy('UPDATE_PROPOSAL_DATABASE_CLOCK_UNAVAILABLE');
    }
    if (
      !task ||
      !step ||
      task.status !== MsaidiziTaskStatus.RUNNING ||
      step.status !== MsaidiziTaskStepStatus.RUNNING
    ) {
      throw policy('UPDATE_PROPOSAL_TASK_STATE_CHANGED');
    }
    this.assertGeneratedBudgets(task, args, 0, databaseNow);
    const stepIo = stepLocalIoState(step);
    const budget = args.evaluationBudget;
    if (
      !stepIo.ok ||
      (stepIo.remaining !== null && budget.maxBytesRead + budget.maxBytesWritten > stepIo.remaining)
    ) {
      throw policy('UPDATE_PROPOSAL_STEP_BUDGET_EXCEEDED');
    }
    const taskWon = await tx.msaidiziTask.updateMany({
      where: {
        id: taskId,
        status: MsaidiziTaskStatus.RUNNING,
        modelTurns: task.modelTurns,
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
        modelCostUsd: task.modelCostUsd,
        bytesRead: task.bytesRead,
        bytesWritten: task.bytesWritten,
        externalEgressBytes: task.externalEgressBytes,
        reservedExternalEgressBytes: task.reservedExternalEgressBytes,
      },
      data: {
        modelTurns: { increment: budget.maxModelTurns },
        inputTokens: { increment: budget.maxModelInputTokens },
        outputTokens: { increment: budget.maxModelOutputTokens },
        modelCostUsd: { increment: microusdToDecimal(budget.maxModelCostMicrousd) },
        bytesRead: { increment: budget.maxBytesRead },
        bytesWritten: { increment: budget.maxBytesWritten },
        externalEgressBytes: { increment: budget.maxExternalEgressBytes },
        lastCheckpointAt: databaseNow,
      },
    });
    const stepWon = await tx.msaidiziTaskStep.updateMany({
      where: {
        id: stepId,
        taskId,
        status: MsaidiziTaskStepStatus.RUNNING,
        localIoAccountingValid: true,
        bytesRead: stepIo.bytesRead,
        bytesWritten: stepIo.bytesWritten,
      },
      data: {
        bytesRead: { increment: budget.maxBytesRead },
        bytesWritten: { increment: budget.maxBytesWritten },
        checkpointedAt: databaseNow,
      },
    });
    if (taskWon.count !== 1 || stepWon.count !== 1) {
      throw policy('UPDATE_PROPOSAL_BUDGET_RESERVATION_CONFLICT');
    }
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type: 'update_evaluation.budget_reserved',
        actorType: 'SERVICE',
        payload: {
          stepId,
          accounting: 'PESSIMISTIC_FULL_CEILING',
          maxWallTimeSeconds: budget.maxWallTimeSeconds,
          maxBytesRead: budget.maxBytesRead.toString(),
          maxBytesWritten: budget.maxBytesWritten.toString(),
          maxExternalEgressBytes: budget.maxExternalEgressBytes.toString(),
          maxModelTurns: budget.maxModelTurns,
          maxModelInputTokens: budget.maxModelInputTokens.toString(),
          maxModelOutputTokens: budget.maxModelOutputTokens.toString(),
          maxModelCostMicrousd: budget.maxModelCostMicrousd.toString(),
        },
      },
    });
  }

  private async recordProposalEvidence(
    tx: Prisma.TransactionClient,
    task: {
      id: string;
      principalId: string;
      initiatedByUserId: string | null;
      companyId: string | null;
      mandateId: string | null;
    },
    stepId: string,
    candidateId: string,
    evidence: Prisma.InputJsonObject,
  ): Promise<void> {
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId: task.id,
        type: 'update_candidate.proposed',
        actorType: 'SERVICE',
        actorId: task.principalId,
        payload: evidence,
      },
    });
    await this.audit.logStrictInTransaction(tx, {
      action: 'MSAIDIZI_UPDATE_CANDIDATE_PROPOSED',
      entityType: 'MsaidiziUpdateCandidate',
      entityId: candidateId,
      userId: task.initiatedByUserId,
      companyId: task.companyId,
      newValue: evidence,
      severity: AuditSeverity.HIGH,
      channel: AuditChannel.AGENT,
      agentSessionId: taskSessionId(task.id),
      principalType: 'MSAIDIZI',
      principalId: task.principalId,
      mandateId: task.mandateId,
      initiatedByUserId: task.initiatedByUserId,
      taskId: task.id,
      stepId,
    });
  }

  private assertReviewedAuthority(
    task: {
      id: string;
      principalId: string;
      initiatedByUserId: string | null;
      mandateId: string | null;
      mode: MsaidiziTaskMode;
      status: MsaidiziTaskStatus;
      activePlanVersion: number;
      principal: { status: MsaidiziPrincipalStatus };
      mandate: {
        id: string;
        principalId: string;
        status: string;
        startsAt: Date | null;
        expiresAt: Date | null;
        capabilities: Prisma.JsonValue;
      } | null;
    } | null,
    step: {
      id: string;
      taskId: string;
      planVersionId: string;
      status: MsaidiziTaskStepStatus;
      planVersion: {
        id: string;
        taskId: string;
        version: number;
        createdByUserId: string | null;
      };
    } | null,
    attempt: { id: string; status: MsaidiziToolAttemptStatus } | null,
    request: UpdateCandidateProposalRequest,
    databaseNow: Date,
  ): void {
    if (!task || !step || !attempt) throw policy('UPDATE_PROPOSAL_CONTEXT_NOT_FOUND');
    if (
      task.status !== MsaidiziTaskStatus.RUNNING ||
      task.mode !== MsaidiziTaskMode.AUTOPILOT ||
      task.principal.status !== MsaidiziPrincipalStatus.ACTIVE
    ) {
      throw policy('UPDATE_PROPOSAL_TASK_NOT_AUTHORIZED');
    }
    if (
      step.status !== MsaidiziTaskStepStatus.RUNNING ||
      attempt.status !== MsaidiziToolAttemptStatus.RUNNING
    ) {
      throw policy('UPDATE_PROPOSAL_ATTEMPT_NOT_RUNNING');
    }
    if (
      step.planVersionId !== request.planVersionId ||
      step.planVersion.id !== request.planVersionId ||
      step.planVersion.taskId !== task.id ||
      step.planVersion.version !== task.activePlanVersion ||
      !task.initiatedByUserId ||
      step.planVersion.createdByUserId !== task.initiatedByUserId
    ) {
      throw policy('UPDATE_PROPOSAL_PLAN_NOT_REVIEWED');
    }
    const now = databaseNow.getTime();
    if (
      !task.mandateId ||
      !task.mandate ||
      task.mandate.id !== task.mandateId ||
      task.mandate.principalId !== task.principalId ||
      task.mandate.status !== 'ACTIVE' ||
      (task.mandate.startsAt && task.mandate.startsAt.getTime() > now) ||
      (task.mandate.expiresAt && task.mandate.expiresAt.getTime() <= now)
    ) {
      throw policy('UPDATE_PROPOSAL_MANDATE_INACTIVE');
    }
  }

  private async assertArtifacts(
    tx: Prisma.TransactionClient,
    taskId: string,
    planVersionId: string,
    stepId: string,
    dataClass: string,
    args: ArtifactBackedUpdateCandidateProposalArguments,
  ): Promise<void> {
    const artifacts = await tx.msaidiziArtifact.findMany({
      where: { id: { in: [args.sourceArtifactId, args.rollbackArtifactId] } },
      select: {
        id: true,
        taskId: true,
        stepId: true,
        kind: true,
        mimeType: true,
        sha256: true,
        byteSize: true,
        encrypted: true,
        dataClass: true,
        trustLevel: true,
        trustedPurpose: true,
        provenance: true,
        trustedEvidence: {
          select: {
            taskId: true,
            planVersionId: true,
            stepId: true,
            candidateId: true,
            purpose: true,
            claimsDigest: true,
            signature: true,
          },
        },
      },
    });
    const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const pairs = [
      [args.sourceArtifactId, args.sourceArtifactSha256, 'SOURCE'],
      [args.rollbackArtifactId, args.rollbackArtifactSha256, 'ROLLBACK'],
    ] as const;
    for (const [id, digest, purpose] of pairs) {
      const artifact = byId.get(id);
      if (!artifact || artifact.taskId !== taskId) {
        throw policy('UPDATE_PROPOSAL_CROSS_TASK_ARTIFACT');
      }
      if (
        artifact.kind !== MsaidiziArtifactKind.FILE ||
        artifact.trustLevel !== MsaidiziTrustLevel.TRUSTED ||
        artifact.trustedPurpose !== purpose ||
        artifact.stepId !== stepId ||
        !artifact.encrypted ||
        artifact.byteSize <= 0n ||
        artifact.dataClass !== dataClass ||
        artifact.sha256.toLowerCase() !== digest ||
        !artifact.trustedEvidence ||
        artifact.trustedEvidence.taskId !== taskId ||
        artifact.trustedEvidence.planVersionId !== planVersionId ||
        artifact.trustedEvidence.stepId !== stepId ||
        artifact.trustedEvidence.candidateId !== null ||
        artifact.trustedEvidence.purpose !== purpose ||
        !/^[0-9a-f]{64}$/.test(artifact.trustedEvidence.claimsDigest) ||
        !/^[A-Za-z0-9_-]{86}$/.test(artifact.trustedEvidence.signature)
      ) {
        throw policy('UPDATE_PROPOSAL_ARTIFACT_UNTRUSTED');
      }
      if (sanitizePersistedValue(artifact.provenance).redactionsApplied) {
        throw policy('UPDATE_PROPOSAL_ARTIFACT_PROVENANCE_SECRET');
      }
    }
  }

  private assertLiveMandate(
    task: { principalId: string; mandateId: string | null },
    mandate: {
      id: string;
      principalId: string;
      status: string;
      startsAt: Date | null;
      expiresAt: Date | null;
    } | null,
    databaseNow: Date,
  ): void {
    const now = databaseNow.getTime();
    if (
      !task.mandateId ||
      !mandate ||
      mandate.id !== task.mandateId ||
      mandate.principalId !== task.principalId ||
      mandate.status !== 'ACTIVE' ||
      (mandate.startsAt && mandate.startsAt.getTime() > now) ||
      (mandate.expiresAt && mandate.expiresAt.getTime() <= now)
    ) {
      throw policy('UPDATE_PROPOSAL_MANDATE_INACTIVE');
    }
  }

  private replay(
    existing: {
      id: string;
      proposedByTaskId: string | null;
      proposedByPlanVersionId: string | null;
      proposedByStepId: string | null;
      proposalIdempotencyKey: string | null;
      proposalDigest: string | null;
      sourceArtifactSha256: string | null;
      rollbackArtifactSha256: string | null;
      rollbackVersion: string | null;
      scope: string;
      status: MsaidiziUpdateCandidateStatus;
      generatedSourceArtifactId: string | null;
      generationManifestSha256: string | null;
      evaluationRun: {
        evaluationRunId: string;
        requestDigest: string;
        generationArtifactSha256: string;
        policyVersion: string;
        policyDigest: string;
        status: MsaidiziUpdateEvaluationRunStatus;
      } | null;
    },
    expected: ProposalIdentity,
  ): UpdateCandidateProposalResult {
    const commonMismatch =
      existing.proposedByTaskId !== expected.taskId ||
      existing.proposedByPlanVersionId !== expected.planVersionId ||
      existing.proposedByStepId !== expected.stepId ||
      existing.proposalIdempotencyKey !== expected.idempotencyKey ||
      existing.proposalDigest !== expected.proposalDigest ||
      existing.rollbackVersion !== expected.args.rollbackVersion ||
      existing.scope !== expected.args.scope;
    if (commonMismatch) {
      throw policy('UPDATE_PROPOSAL_REPLAY_MISMATCH');
    }
    if (isGeneratedUpdateCandidateProposal(expected.args)) {
      if (
        !expected.manifestSha256 ||
        !expected.evaluationRunId ||
        !expected.requestDigest ||
        existing.generationManifestSha256 !== expected.manifestSha256 ||
        !existing.generatedSourceArtifactId ||
        !existing.evaluationRun ||
        existing.evaluationRun.evaluationRunId !== expected.evaluationRunId ||
        existing.evaluationRun.requestDigest !== expected.requestDigest ||
        existing.evaluationRun.generationArtifactSha256 !== expected.manifestSha256 ||
        existing.evaluationRun.policyVersion !== GENERATED_UPDATE_POLICY_VERSION ||
        existing.evaluationRun.policyDigest !== GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256 ||
        !generatedReplayStatusPair(existing.status, existing.evaluationRun.status)
      ) {
        throw policy('UPDATE_PROPOSAL_REPLAY_MISMATCH');
      }
    } else if (
      existing.status !== MsaidiziUpdateCandidateStatus.DRAFT ||
      existing.sourceArtifactSha256 !== expected.args.sourceArtifactSha256 ||
      existing.rollbackArtifactSha256 !== expected.args.rollbackArtifactSha256 ||
      existing.evaluationRun !== null
    ) {
      throw policy('UPDATE_PROPOSAL_REPLAY_MISMATCH');
    }
    return result(existing.id, expected, true, existing.status, existing.evaluationRun?.status);
  }
}

interface ProposalIdentity {
  taskId: string;
  planVersionId: string;
  stepId: string;
  args: UpdateCandidateProposalArguments;
  proposalDigest: string;
  idempotencyKey: string;
  manifestSha256?: string;
  evaluationRunId?: string;
  requestDigest?: string;
}

function result(
  candidateId: string,
  expected: ProposalIdentity,
  replay: boolean,
  candidateStatus?: MsaidiziUpdateCandidateStatus,
  evaluationRunStatus?: MsaidiziUpdateEvaluationRunStatus,
): UpdateCandidateProposalResult {
  if (isGeneratedUpdateCandidateProposal(expected.args)) {
    return {
      candidateId,
      status: candidateStatus ?? MsaidiziUpdateCandidateStatus.EVALUATING,
      scope: expected.args.scope,
      proposalDigest: expected.proposalDigest,
      sourceArtifactSha256: null,
      rollbackArtifactSha256: null,
      rollbackVersion: expected.args.rollbackVersion,
      generationArtifactSha256: expected.manifestSha256,
      evaluationRunId: expected.evaluationRunId,
      ...(evaluationRunStatus && { evaluationRunStatus }),
      replay,
    };
  }
  return {
    candidateId,
    status: 'DRAFT',
    scope: expected.args.scope,
    proposalDigest: expected.proposalDigest,
    sourceArtifactSha256: expected.args.sourceArtifactSha256,
    rollbackArtifactSha256: expected.args.rollbackArtifactSha256,
    rollbackVersion: expected.args.rollbackVersion,
    replay,
  };
}

function evaluationBudgetData(args: GeneratedUpdateCandidateProposalArguments) {
  const budget = args.evaluationBudget;
  return {
    maxWallTimeSeconds: budget.maxWallTimeSeconds,
    maxCpuTimeSeconds: budget.maxCpuTimeSeconds,
    maxBytesRead: budget.maxBytesRead,
    maxBytesWritten: budget.maxBytesWritten,
    maxExternalEgressBytes: budget.maxExternalEgressBytes,
    maxModelTurns: budget.maxModelTurns,
    maxModelInputTokens: budget.maxModelInputTokens,
    maxModelOutputTokens: budget.maxModelOutputTokens,
    maxModelCostMicrousd: budget.maxModelCostMicrousd,
  };
}

function deterministicUuid(seed: string): string {
  const bytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function decimalUsdToMicrousd(value: Prisma.Decimal): bigint {
  if (value.isNegative()) return -1n;
  return BigInt(value.mul(1_000_000).floor().toFixed(0));
}

function microusdToDecimal(value: bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString()).div(1_000_000);
}

function canonicalModelIdentity(value: string): string {
  const normalized = value.normalize('NFC').trim().toLocaleLowerCase('en-US');
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
    ? normalized
    : `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`;
}

function generatedReplayStatusPair(
  candidate: MsaidiziUpdateCandidateStatus,
  run: MsaidiziUpdateEvaluationRunStatus,
): boolean {
  if (
    candidate === MsaidiziUpdateCandidateStatus.EVALUATING &&
    [
      MsaidiziUpdateEvaluationRunStatus.QUEUED,
      MsaidiziUpdateEvaluationRunStatus.LEASED,
      MsaidiziUpdateEvaluationRunStatus.RUNNING,
    ].some((status) => status === run)
  ) {
    return true;
  }
  if (
    run === MsaidiziUpdateEvaluationRunStatus.SUCCEEDED &&
    [
      MsaidiziUpdateCandidateStatus.APPROVED,
      MsaidiziUpdateCandidateStatus.CANARY,
      MsaidiziUpdateCandidateStatus.ACTIVE,
      MsaidiziUpdateCandidateStatus.ROLLED_BACK,
    ].some((status) => status === candidate)
  ) {
    return true;
  }
  if (
    run === MsaidiziUpdateEvaluationRunStatus.REJECTED &&
    candidate === MsaidiziUpdateCandidateStatus.REJECTED
  ) {
    return true;
  }
  return (
    candidate === MsaidiziUpdateCandidateStatus.FAILED &&
    [
      MsaidiziUpdateEvaluationRunStatus.FAILED,
      MsaidiziUpdateEvaluationRunStatus.NEEDS_ATTENTION,
      MsaidiziUpdateEvaluationRunStatus.CANCELLED,
    ].some((status) => status === run)
  );
}

function persistedJson(value: unknown): Prisma.InputJsonObject {
  const sanitized = sanitizePersistedValue(value);
  if (sanitized.redactionsApplied) {
    throw policy('UPDATE_PROPOSAL_EVIDENCE_SECRET');
  }
  return JSON.parse(JSON.stringify(sanitized.value)) as Prisma.InputJsonObject;
}

function taskSessionId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '')}`;
}

function policy(code: string): UpdateCandidateProposalPolicyError {
  return new UpdateCandidateProposalPolicyError(code);
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002',
  );
}
