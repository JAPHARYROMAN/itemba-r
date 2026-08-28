import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziUpdateCandidateStatus,
  MsaidiziUpdateEvaluationRunStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MsaidiziArtifactsService } from '../msaidizi-artifacts/msaidizi-artifacts.service';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { remainingTaskWallTimeMs } from '../msaidizi-task-runtime/msaidizi-task-wall-time';
import { ReportMsaidiziUpdateEvaluationUsageDto } from './dto/msaidizi-update.dto';
import {
  assertGeneratedUpdateProtectedBoundary,
  assertUpdateCandidateProposalStep,
  GENERATED_UPDATE_POLICY_VERSION,
  GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256,
  generatedUpdateEvaluationRequestDigest,
  generatedUpdateManifest,
  generatedUpdateRequiredChecks,
  isGeneratedUpdateCandidateProposal,
  mandateAuthorizesUpdateCandidateProposal,
} from './update-candidate-proposal.port';

const LEASE_SECONDS = 300;
const MAX_PRESTART_DISPATCHES = 3;

export const EVALUATION_RUN_INCLUDE = {
  candidate: true,
  task: { include: { principal: true, mandate: true } },
  step: { include: { planVersion: true } },
  generationArtifact: true,
} satisfies Prisma.MsaidiziUpdateEvaluationRunInclude;

export type EvaluationRun = Prisma.MsaidiziUpdateEvaluationRunGetPayload<{
  include: typeof EVALUATION_RUN_INCLUDE;
}>;

/**
 * Durable broker for isolated update evaluation. This service never evaluates,
 * signs, approves, deploys, or materializes a change-set. It leases one exact
 * immutable request to the mTLS evaluator and accounts cumulative usage.
 */
@Injectable()
export class MsaidiziUpdateEvaluationOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: MsaidiziArtifactsService,
    private readonly autonomy: AutonomyConfig,
  ) {}

  async poll() {
    await this.enforceExecutionGate();
    return this.prisma.$transaction(async (tx) => {
      const now = await databaseNow(tx);
      await this.failCancelledOrExpired(tx, now);
      await this.requeueExpiredPrestartLeases(tx, now);
      await this.failInvalidAuthority(tx, now);
      await this.failExpiredOrExhausted(tx, now);

      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT runs."id" AS "id"
        FROM "msaidizi_update_evaluation_runs" runs
        JOIN "msaidizi_tasks" tasks ON tasks."id" = runs."taskId"
        JOIN "msaidizi_update_candidates" candidates ON candidates."id" = runs."candidateId"
        WHERE runs."status" = 'QUEUED'
          AND runs."dispatchCount" < ${MAX_PRESTART_DISPATCHES}
          AND runs."deadlineAt" > ${now}
          AND tasks."status"::text IN ('RUNNING', 'COMPLETED')
        ORDER BY runs."queuedAt", runs."id"
        FOR UPDATE OF candidates SKIP LOCKED
        LIMIT 1
      `;
      if (rows.length === 0) return { run: null };
      await lockEvaluationRunInCanonicalOrder(tx, rows[0].id);
      const dispatchNow = await databaseNow(tx);
      const run = await tx.msaidiziUpdateEvaluationRun.findUnique({
        where: { id: rows[0].id },
        include: EVALUATION_RUN_INCLUDE,
      });
      if (!run) throw new ConflictException('Evaluation run disappeared while leased');
      assertEvaluationRunBinding(run);
      if (run.deadlineAt <= dispatchNow || !runOwnsEvaluation(run, dispatchNow)) {
        await failRun(
          tx,
          run,
          evaluationOwnershipFailure(run, dispatchNow),
          dispatchNow,
          MsaidiziUpdateEvaluationRunStatus.CANCELLED,
        );
        return { run: null };
      }
      const leaseId = randomUUID();
      const leaseExpiresAt = new Date(
        Math.min(run.deadlineAt.getTime(), dispatchNow.getTime() + LEASE_SECONDS * 1_000),
      );
      const won = await tx.msaidiziUpdateEvaluationRun.updateMany({
        where: {
          id: run.id,
          status: MsaidiziUpdateEvaluationRunStatus.QUEUED,
          dispatchCount: run.dispatchCount,
        },
        data: {
          status: MsaidiziUpdateEvaluationRunStatus.LEASED,
          leaseId,
          leaseGeneration: { increment: 1 },
          leaseExpiresAt,
          leasedAt: dispatchNow,
          dispatchCount: { increment: 1 },
        },
      });
      if (won.count !== 1) throw new ConflictException('Evaluation lease changed; poll again');
      await tx.msaidiziTaskEvent.create({
        data: {
          taskId: run.taskId,
          type: 'update_evaluation.leased',
          actorType: 'VERIFIER',
          payload: {
            evaluationRunId: run.evaluationRunId,
            requestDigest: run.requestDigest,
            leaseGeneration: run.leaseGeneration + 1,
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          },
        },
      });
      return jsonSafe({
        run: {
          id: run.id,
          evaluationRunId: run.evaluationRunId,
          candidateId: run.candidateId,
          taskId: run.taskId,
          planVersionId: run.planVersionId,
          stepId: run.stepId,
          requestDigest: run.requestDigest,
          generationArtifactId: run.generationArtifactId,
          generationArtifactSha256: run.generationArtifactSha256,
          policyVersion: run.policyVersion,
          policyDigest: run.policyDigest,
          requiredChecks: run.requiredChecks,
          budgets: runBudgets(run),
          leaseId,
          leaseGeneration: run.leaseGeneration + 1,
          leaseExpiresAt,
        },
      });
    });
  }

  async start(runId: string, leaseId: string) {
    await this.enforceExecutionGate();
    return this.prisma.$transaction(async (tx) => {
      await lockEvaluationRunInCanonicalOrder(tx, runId);
      const run = await tx.msaidiziUpdateEvaluationRun.findUnique({
        where: { id: runId },
        include: EVALUATION_RUN_INCLUDE,
      });
      if (!run) throw new NotFoundException('Evaluation run not found');
      assertEvaluationRunBinding(run);
      const now = await databaseNow(tx);
      if (run.deadlineAt <= now || !runOwnsEvaluation(run, now)) {
        const failureCode = evaluationOwnershipFailure(run, now);
        await failRun(tx, run, failureCode, now);
        return { id: run.id, status: 'FAILED', replay: false, failureCode, start: false };
      }
      if (
        run.status === MsaidiziUpdateEvaluationRunStatus.RUNNING &&
        run.leaseId === leaseId &&
        run.leaseExpiresAt &&
        run.leaseExpiresAt > now
      ) {
        return { id: run.id, status: run.status, replay: true };
      }
      if (
        run.status !== MsaidiziUpdateEvaluationRunStatus.LEASED ||
        run.leaseId !== leaseId ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt <= now
      ) {
        throw new ConflictException('Evaluation lease is not startable');
      }
      const won = await tx.msaidiziUpdateEvaluationRun.updateMany({
        where: {
          id: run.id,
          status: MsaidiziUpdateEvaluationRunStatus.LEASED,
          leaseId,
          leaseExpiresAt: run.leaseExpiresAt,
        },
        data: {
          status: MsaidiziUpdateEvaluationRunStatus.RUNNING,
          startedAt: now,
          lastHeartbeatAt: null,
        },
      });
      if (won.count !== 1) throw new ConflictException('Evaluation start lease changed');
      await tx.msaidiziTaskEvent.create({
        data: {
          taskId: run.taskId,
          type: 'update_evaluation.started',
          actorType: 'VERIFIER',
          payload: { evaluationRunId: run.evaluationRunId, requestDigest: run.requestDigest },
        },
      });
      return { id: run.id, status: MsaidiziUpdateEvaluationRunStatus.RUNNING, replay: false };
    });
  }

  async heartbeat(runId: string, leaseId: string, dto: ReportMsaidiziUpdateEvaluationUsageDto) {
    await this.enforceExecutionGate();
    return this.prisma.$transaction(async (tx) => {
      await lockEvaluationRunInCanonicalOrder(tx, runId);
      const run = await tx.msaidiziUpdateEvaluationRun.findUnique({
        where: { id: runId },
        include: EVALUATION_RUN_INCLUDE,
      });
      if (!run) throw new NotFoundException('Evaluation run not found');
      assertEvaluationRunBinding(run);
      const now = await databaseNow(tx);
      if (run.deadlineAt <= now || !runOwnsEvaluation(run, now)) {
        const failure = evaluationOwnershipFailure(run, now);
        await failRun(tx, run, failure, now);
        return { accepted: false, stop: true, failureCode: failure };
      }
      if (
        run.status !== MsaidiziUpdateEvaluationRunStatus.RUNNING ||
        run.leaseId !== leaseId ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt <= now ||
        !run.startedAt
      ) {
        throw new ConflictException('Evaluation heartbeat lease is invalid');
      }
      const usage = parseUsage(dto);
      const budgetFailure = usageFailure(run, usage, now);
      if (budgetFailure) {
        await failRun(tx, run, budgetFailure, now);
        return { accepted: false, stop: true, failureCode: budgetFailure };
      }
      const hardDeadline = new Date(run.startedAt.getTime() + run.maxWallTimeSeconds * 1_000);
      const leaseExpiresAt = new Date(
        Math.min(
          run.deadlineAt.getTime(),
          hardDeadline.getTime(),
          now.getTime() + LEASE_SECONDS * 1_000,
        ),
      );
      const runWon = await tx.msaidiziUpdateEvaluationRun.updateMany({
        where: {
          id: run.id,
          status: MsaidiziUpdateEvaluationRunStatus.RUNNING,
          leaseId,
          usedCpuTimeSeconds: run.usedCpuTimeSeconds,
          usedBytesRead: run.usedBytesRead,
          usedBytesWritten: run.usedBytesWritten,
          usedExternalEgressBytes: run.usedExternalEgressBytes,
          usedModelTurns: run.usedModelTurns,
          usedModelInputTokens: run.usedModelInputTokens,
          usedModelOutputTokens: run.usedModelOutputTokens,
          usedModelCostMicrousd: run.usedModelCostMicrousd,
        },
        data: {
          usedCpuTimeSeconds: usage.cpuTimeSeconds,
          usedBytesRead: usage.bytesRead,
          usedBytesWritten: usage.bytesWritten,
          usedExternalEgressBytes: usage.externalEgressBytes,
          usedModelTurns: usage.modelTurns,
          usedModelInputTokens: usage.modelInputTokens,
          usedModelOutputTokens: usage.modelOutputTokens,
          usedModelCostMicrousd: usage.modelCostMicrousd,
          lastHeartbeatAt: now,
          leaseExpiresAt,
        },
      });
      if (runWon.count !== 1) throw new ConflictException('Evaluation usage changed; retry');
      return jsonSafe({ accepted: true, stop: false, leaseExpiresAt, usage });
    });
  }

  async generationArtifact(runId: string, leaseId: string) {
    await this.enforceExecutionGate();
    const run = await this.prisma.$transaction(async (tx) => {
      const now = await databaseNow(tx);
      const current = await tx.msaidiziUpdateEvaluationRun.findUnique({
        where: { id: runId },
        include: EVALUATION_RUN_INCLUDE,
      });
      if (
        !current ||
        current.status !== MsaidiziUpdateEvaluationRunStatus.RUNNING ||
        current.leaseId !== leaseId ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt <= now ||
        current.deadlineAt <= now ||
        !runOwnsEvaluation(current, now)
      ) {
        throw new NotFoundException('Evaluation artifact authorization not found');
      }
      assertEvaluationRunBinding(current);
      return current;
    });
    return this.artifacts.downloadForUpdateEvaluation(
      run.id,
      leaseId,
      run.generationArtifactId,
      run.generationArtifactSha256,
    );
  }

  async enforceExecutionGate(): Promise<void> {
    if (this.autonomy.enabled && !this.autonomy.globalKillSwitchActive) return;
    const failureCode = this.autonomy.globalKillSwitchActive
      ? 'EVALUATION_GLOBAL_KILL_SWITCH'
      : 'EVALUATION_AUTONOMY_DISABLED';
    await this.terminalizeActiveRuns(failureCode);
    throw new ServiceUnavailableException('Autonomous update evaluation is disabled');
  }

  assertExecutionGateOpen(): void {
    if (!this.autonomy.enabled || this.autonomy.globalKillSwitchActive) {
      throw new ServiceUnavailableException('Autonomous update evaluation is disabled');
    }
  }

  private async terminalizeActiveRuns(failureCode: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const runs = await tx.msaidiziUpdateEvaluationRun.findMany({
        where: {
          status: {
            in: [
              MsaidiziUpdateEvaluationRunStatus.QUEUED,
              MsaidiziUpdateEvaluationRunStatus.LEASED,
              MsaidiziUpdateEvaluationRunStatus.RUNNING,
            ],
          },
        },
        include: EVALUATION_RUN_INCLUDE,
      });
      const now = await databaseNow(tx);
      for (const run of runs) {
        await failRun(tx, run, failureCode, now, MsaidiziUpdateEvaluationRunStatus.CANCELLED);
      }
    });
  }

  private async failExpiredOrExhausted(tx: Prisma.TransactionClient, now: Date): Promise<void> {
    const runs = await tx.msaidiziUpdateEvaluationRun.findMany({
      where: {
        OR: [
          { status: MsaidiziUpdateEvaluationRunStatus.RUNNING, leaseExpiresAt: { lte: now } },
          {
            status: MsaidiziUpdateEvaluationRunStatus.LEASED,
            leaseExpiresAt: { lte: now },
            dispatchCount: { gte: MAX_PRESTART_DISPATCHES },
          },
        ],
      },
      include: EVALUATION_RUN_INCLUDE,
    });
    for (const run of runs) {
      await failRun(
        tx,
        run,
        run.status === MsaidiziUpdateEvaluationRunStatus.RUNNING
          ? 'EVALUATION_RUNNING_LEASE_EXPIRED'
          : 'EVALUATION_DISPATCH_EXHAUSTED',
        now,
        MsaidiziUpdateEvaluationRunStatus.NEEDS_ATTENTION,
      );
    }
  }

  private async requeueExpiredPrestartLeases(
    tx: Prisma.TransactionClient,
    observedNow: Date,
  ): Promise<void> {
    // Discovery is read-only. Every mutation below first acquires the complete
    // candidate-first safety order, avoiding the former bulk run UPDATE lock
    // that could deadlock against evidence submission.
    const rows = await tx.msaidiziUpdateEvaluationRun.findMany({
      where: {
        status: MsaidiziUpdateEvaluationRunStatus.LEASED,
        leaseExpiresAt: { lte: observedNow },
        dispatchCount: { lt: MAX_PRESTART_DISPATCHES },
      },
      select: { id: true, candidateId: true },
      orderBy: [{ candidateId: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const row of rows) {
      await lockEvaluationRunInCanonicalOrder(tx, row.id);
      const run = await tx.msaidiziUpdateEvaluationRun.findUnique({
        where: { id: row.id },
        include: EVALUATION_RUN_INCLUDE,
      });
      if (!run) continue;
      const now = await databaseNow(tx);
      if (
        run.status !== MsaidiziUpdateEvaluationRunStatus.LEASED ||
        !run.leaseId ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt > now ||
        run.dispatchCount >= MAX_PRESTART_DISPATCHES
      ) {
        continue;
      }
      if (run.deadlineAt <= now || !runOwnsEvaluation(run, now)) {
        await failRun(
          tx,
          run,
          evaluationOwnershipFailure(run, now),
          now,
          MsaidiziUpdateEvaluationRunStatus.CANCELLED,
        );
        continue;
      }
      const won = await tx.msaidiziUpdateEvaluationRun.updateMany({
        where: {
          id: run.id,
          candidateId: row.candidateId,
          status: MsaidiziUpdateEvaluationRunStatus.LEASED,
          leaseId: run.leaseId,
          leaseGeneration: run.leaseGeneration,
          leaseExpiresAt: run.leaseExpiresAt,
          dispatchCount: run.dispatchCount,
          usedCpuTimeSeconds: run.usedCpuTimeSeconds,
          usedBytesRead: run.usedBytesRead,
          usedBytesWritten: run.usedBytesWritten,
          usedExternalEgressBytes: run.usedExternalEgressBytes,
          usedModelTurns: run.usedModelTurns,
          usedModelInputTokens: run.usedModelInputTokens,
          usedModelOutputTokens: run.usedModelOutputTokens,
          usedModelCostMicrousd: run.usedModelCostMicrousd,
          candidate: {
            status: MsaidiziUpdateCandidateStatus.EVALUATING,
            principalId: run.task.principalId,
          },
          task: {
            id: run.taskId,
            principalId: run.task.principalId,
            status: { in: [MsaidiziTaskStatus.RUNNING, MsaidiziTaskStatus.COMPLETED] },
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
          },
        },
        data: {
          status: MsaidiziUpdateEvaluationRunStatus.QUEUED,
          leaseId: null,
          leaseExpiresAt: null,
          failureCode: null,
        },
      });
      if (won.count !== 1) {
        throw new ConflictException('Expired evaluation lease changed while requeueing');
      }
    }
  }

  private async failInvalidAuthority(tx: Prisma.TransactionClient, now: Date): Promise<void> {
    const runs = await tx.msaidiziUpdateEvaluationRun.findMany({
      where: {
        status: {
          in: [
            MsaidiziUpdateEvaluationRunStatus.QUEUED,
            MsaidiziUpdateEvaluationRunStatus.LEASED,
            MsaidiziUpdateEvaluationRunStatus.RUNNING,
          ],
        },
      },
      include: EVALUATION_RUN_INCLUDE,
    });
    for (const run of runs) {
      if (!runOwnsEvaluation(run, now)) {
        await failRun(
          tx,
          run,
          evaluationOwnershipFailure(run, now),
          now,
          MsaidiziUpdateEvaluationRunStatus.CANCELLED,
        );
      }
    }
  }

  private async failCancelledOrExpired(tx: Prisma.TransactionClient, now: Date): Promise<void> {
    const runs = await tx.msaidiziUpdateEvaluationRun.findMany({
      where: {
        status: {
          in: [
            MsaidiziUpdateEvaluationRunStatus.QUEUED,
            MsaidiziUpdateEvaluationRunStatus.LEASED,
            MsaidiziUpdateEvaluationRunStatus.RUNNING,
          ],
        },
        OR: [
          { deadlineAt: { lte: now } },
          {
            task: {
              status: {
                in: [
                  MsaidiziTaskStatus.CANCELLING,
                  MsaidiziTaskStatus.CANCELLED,
                  MsaidiziTaskStatus.FAILED,
                  MsaidiziTaskStatus.PARTIAL,
                  MsaidiziTaskStatus.NEEDS_ATTENTION,
                ],
              },
            },
          },
        ],
      },
      include: EVALUATION_RUN_INCLUDE,
    });
    for (const run of runs) {
      const failureCode = evaluationOwnershipFailure(run, now);
      await failRun(
        tx,
        run,
        failureCode,
        now,
        failureCode === 'EVALUATION_TASK_AUTHORITY_CANCELLED'
          ? MsaidiziUpdateEvaluationRunStatus.CANCELLED
          : MsaidiziUpdateEvaluationRunStatus.FAILED,
      );
    }
  }
}

export function assertEvaluationRunBinding(run: EvaluationRun): void {
  const args = assertUpdateCandidateProposalStep(run.step);
  if (!isGeneratedUpdateCandidateProposal(args)) {
    throw new ConflictException('Evaluation run is not bound to a generated proposal');
  }
  assertGeneratedUpdateProtectedBoundary(args);
  const manifest = generatedUpdateManifest(
    run.taskId,
    run.planVersionId,
    run.stepId,
    run.attemptId,
    args,
  );
  const provenance = jsonRecord(run.provenance);
  const reservationClock = strictDate(provenance.wallTimeReservationClockAt);
  const checkpointAt = nullableStrictDate(provenance.taskWallTimeCheckpointAtReservation);
  const consumedAtReservation = canonicalNonnegativeBigInt(
    provenance.taskWallTimeConsumedMsAtReservation,
  );
  const recordedRemaining = canonicalNonnegativeBigInt(
    provenance.remainingTaskWallTimeMsAtReservation,
  );
  const reconstructedRemaining = remainingTaskWallTimeMs(
    {
      consumedWallTimeMs: consumedAtReservation,
      wallTimeCheckpointAt: checkpointAt,
      maxWallTimeSeconds: run.task.maxWallTimeSeconds,
    },
    reservationClock,
  );
  const expectedDeadline = new Date(
    reservationClock.getTime() +
      Number(
        reconstructedRemaining < BigInt(run.maxWallTimeSeconds) * 1_000n
          ? reconstructedRemaining
          : BigInt(run.maxWallTimeSeconds) * 1_000n,
      ),
  );
  const requestDigest = generatedUpdateEvaluationRequestDigest({
    candidateId: run.candidateId,
    evaluationRunId: run.evaluationRunId,
    manifestSha256: manifest.sha256,
    proposalDigest: run.candidate.proposalDigest ?? '',
    generatorModelId: run.generatorModelId,
    args,
  });
  if (
    run.policyVersion !== GENERATED_UPDATE_POLICY_VERSION ||
    run.policyDigest !== GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256 ||
    run.requestDigest !== requestDigest ||
    stableJson(run.requiredChecks) !== stableJson(generatedUpdateRequiredChecks()) ||
    run.generationManifestSha256 !== manifest.sha256 ||
    run.generationArtifactSha256 !== manifest.sha256 ||
    run.generationArtifact.id !== run.generationArtifactId ||
    run.generationArtifact.taskId !== run.taskId ||
    run.generationArtifact.stepId !== run.stepId ||
    run.generationArtifact.sha256 !== manifest.sha256 ||
    !run.generationArtifact.encrypted ||
    run.generationArtifact.trustLevel !== 'UNTRUSTED' ||
    run.candidate.generatedSourceArtifactId !== run.generationArtifactId ||
    run.candidate.generationManifestSha256 !== manifest.sha256 ||
    run.candidate.proposedByTaskId !== run.taskId ||
    run.candidate.proposedByPlanVersionId !== run.planVersionId ||
    run.candidate.proposedByStepId !== run.stepId ||
    run.step.planVersionId !== run.planVersionId ||
    run.step.planVersion.taskId !== run.taskId ||
    run.generatorPrincipalId !== run.task.principalId ||
    provenance.protectedSupervisorBoundary !== 'EXCLUDED' ||
    provenance.protectedPathPolicyVersion !== GENERATED_UPDATE_POLICY_VERSION ||
    provenance.protectedPathPolicySha256 !== GENERATED_UPDATE_PROTECTED_PATH_POLICY_SHA256 ||
    provenance.deadlineAt !== run.deadlineAt.toISOString() ||
    recordedRemaining !== reconstructedRemaining ||
    run.deadlineAt.getTime() !== expectedDeadline.getTime()
  ) {
    throw new ConflictException('Evaluation run immutable binding is invalid');
  }
}

async function lockEvaluationRunInCanonicalOrder(
  tx: Prisma.TransactionClient,
  runId: string,
): Promise<void> {
  const bindings = await tx.$queryRaw<
    Array<{
      id: string;
      candidateId: string;
      taskId: string;
      stepId: string;
      principalId: string;
      mandateId: string | null;
    }>
  >`
    SELECT runs."id" AS "id",
           runs."candidateId" AS "candidateId",
           runs."taskId" AS "taskId",
           runs."stepId" AS "stepId",
           candidates."principalId" AS "principalId",
           tasks."mandateId" AS "mandateId"
    FROM "msaidizi_update_evaluation_runs" runs
    JOIN "msaidizi_update_candidates" candidates ON candidates."id" = runs."candidateId"
    JOIN "msaidizi_tasks" tasks ON tasks."id" = runs."taskId"
    WHERE runs."id" = ${runId}
  `;
  const binding = bindings[0];
  if (!binding || !binding.mandateId) throw new NotFoundException('Evaluation run not found');
  const candidateRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "msaidizi_update_candidates"
    WHERE "id" = ${binding.candidateId}
    FOR UPDATE
  `;
  if (candidateRows.length !== 1) throw new NotFoundException('Evaluation run not found');
  const principalRows = await tx.$queryRaw<Array<{ id: string; status: MsaidiziPrincipalStatus }>>`
    SELECT "id", "status"
    FROM "msaidizi_principals"
    WHERE "id" = ${binding.principalId}
    FOR SHARE
  `;
  if (principalRows.length !== 1) throw new NotFoundException('Evaluation run not found');
  const taskRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "msaidizi_tasks"
    WHERE "id" = ${binding.taskId}
      AND "principalId" = ${binding.principalId}
    FOR SHARE
  `;
  if (taskRows.length !== 1) throw new NotFoundException('Evaluation run not found');
  const mandateRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "msaidizi_mandates"
    WHERE "id" = ${binding.mandateId}
      AND "principalId" = ${binding.principalId}
    FOR SHARE
  `;
  if (mandateRows.length !== 1) throw new NotFoundException('Evaluation run not found');
  const stepRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "msaidizi_task_steps"
    WHERE "id" = ${binding.stepId}
      AND "taskId" = ${binding.taskId}
    FOR SHARE
  `;
  if (stepRows.length !== 1) throw new NotFoundException('Evaluation run not found');
  const runRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "msaidizi_update_evaluation_runs"
    WHERE "id" = ${runId}
    FOR UPDATE
  `;
  if (runRows.length !== 1) throw new NotFoundException('Evaluation run not found');
}

async function failRun(
  tx: Prisma.TransactionClient,
  run: EvaluationRun,
  failureCode: string,
  now: Date,
  status: MsaidiziUpdateEvaluationRunStatus = MsaidiziUpdateEvaluationRunStatus.FAILED,
): Promise<void> {
  await lockEvaluationRunInCanonicalOrder(tx, run.id);
  await tx.msaidiziUpdateCandidate.updateMany({
    where: { id: run.candidateId, status: MsaidiziUpdateCandidateStatus.EVALUATING },
    data: { status: MsaidiziUpdateCandidateStatus.FAILED },
  });
  const won = await tx.msaidiziUpdateEvaluationRun.updateMany({
    where: { id: run.id, status: run.status },
    data: { status, failureCode, completedAt: now, leaseId: null, leaseExpiresAt: null },
  });
  if (won.count !== 1) throw new ConflictException('Evaluation failure state changed');
  await tx.msaidiziTaskEvent.create({
    data: {
      taskId: run.taskId,
      type: 'update_evaluation.failed',
      actorType: 'SERVICE',
      payload: { evaluationRunId: run.evaluationRunId, failureCode, status },
    },
  });
}

type Usage = {
  cpuTimeSeconds: number;
  bytesRead: bigint;
  bytesWritten: bigint;
  externalEgressBytes: bigint;
  modelTurns: number;
  modelInputTokens: bigint;
  modelOutputTokens: bigint;
  modelCostMicrousd: bigint;
};

function parseUsage(dto: ReportMsaidiziUpdateEvaluationUsageDto): Usage {
  return {
    cpuTimeSeconds: dto.cpuTimeSeconds,
    bytesRead: BigInt(dto.bytesRead),
    bytesWritten: BigInt(dto.bytesWritten),
    externalEgressBytes: BigInt(dto.externalEgressBytes),
    modelTurns: dto.modelTurns,
    modelInputTokens: BigInt(dto.modelInputTokens),
    modelOutputTokens: BigInt(dto.modelOutputTokens),
    modelCostMicrousd: BigInt(dto.modelCostMicrousd),
  };
}

function usageFailure(run: EvaluationRun, usage: Usage, now: Date): string | null {
  if (
    usage.cpuTimeSeconds < run.usedCpuTimeSeconds ||
    usage.bytesRead < run.usedBytesRead ||
    usage.bytesWritten < run.usedBytesWritten ||
    usage.externalEgressBytes < run.usedExternalEgressBytes ||
    usage.modelTurns < run.usedModelTurns ||
    usage.modelInputTokens < run.usedModelInputTokens ||
    usage.modelOutputTokens < run.usedModelOutputTokens ||
    usage.modelCostMicrousd < run.usedModelCostMicrousd
  ) {
    return 'EVALUATION_USAGE_NOT_MONOTONIC';
  }
  if (
    usage.cpuTimeSeconds > run.maxCpuTimeSeconds ||
    usage.bytesRead > run.maxBytesRead ||
    usage.bytesWritten > run.maxBytesWritten ||
    usage.externalEgressBytes > run.maxExternalEgressBytes ||
    usage.modelTurns > run.maxModelTurns ||
    usage.modelInputTokens > run.maxModelInputTokens ||
    usage.modelOutputTokens > run.maxModelOutputTokens ||
    usage.modelCostMicrousd > run.maxModelCostMicrousd ||
    !run.startedAt ||
    now.getTime() - run.startedAt.getTime() > run.maxWallTimeSeconds * 1_000
  ) {
    return 'EVALUATION_BUDGET_EXCEEDED';
  }
  return null;
}

function runOwnsEvaluation(run: EvaluationRun, now: Date): boolean {
  const task = run.task;
  const mandate = task.mandate;
  return (
    (task.status === MsaidiziTaskStatus.RUNNING || task.status === MsaidiziTaskStatus.COMPLETED) &&
    task.mode === MsaidiziTaskMode.AUTOPILOT &&
    task.principal.status === 'ACTIVE' &&
    run.candidate.status === MsaidiziUpdateCandidateStatus.EVALUATING &&
    Boolean(
      mandate &&
      mandate.id === task.mandateId &&
      mandate.principalId === task.principalId &&
      mandate.status === 'ACTIVE' &&
      (!mandate.startsAt || mandate.startsAt <= now) &&
      (!mandate.expiresAt || mandate.expiresAt > now) &&
      mandateAuthorizesUpdateCandidateProposal(mandate.capabilities, run.step),
    )
  );
}

function evaluationOwnershipFailure(run: EvaluationRun, now: Date): string {
  if (run.deadlineAt <= now) return 'EVALUATION_TASK_WALL_TIME_EXCEEDED';
  if (
    [
      MsaidiziTaskStatus.CANCELLING,
      MsaidiziTaskStatus.CANCELLED,
      MsaidiziTaskStatus.FAILED,
      MsaidiziTaskStatus.PARTIAL,
      MsaidiziTaskStatus.NEEDS_ATTENTION,
    ].some((status) => status === run.task.status)
  ) {
    return 'EVALUATION_TASK_AUTHORITY_CANCELLED';
  }
  return 'EVALUATION_TASK_AUTHORITY_REVOKED';
}

function runBudgets(run: EvaluationRun) {
  return {
    maxWallTimeSeconds: run.maxWallTimeSeconds,
    maxCpuTimeSeconds: run.maxCpuTimeSeconds,
    maxBytesRead: run.maxBytesRead,
    maxBytesWritten: run.maxBytesWritten,
    maxExternalEgressBytes: run.maxExternalEgressBytes,
    maxModelTurns: run.maxModelTurns,
    maxModelInputTokens: run.maxModelInputTokens,
    maxModelOutputTokens: run.maxModelOutputTokens,
    maxModelCostMicrousd: run.maxModelCostMicrousd,
  };
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strictDate(value: unknown): Date {
  if (typeof value !== 'string') {
    throw new ConflictException('Evaluation run wall-time provenance is invalid');
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime()) || result.toISOString() !== value) {
    throw new ConflictException('Evaluation run wall-time provenance is invalid');
  }
  return result;
}

function nullableStrictDate(value: unknown): Date | null {
  return value === null ? null : strictDate(value);
}

function canonicalNonnegativeBigInt(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new ConflictException('Evaluation run wall-time provenance is invalid');
  }
  return BigInt(value);
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as T;
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  const now = rows[0]?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new ServiceUnavailableException('Database clock is unavailable');
  }
  return now;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
