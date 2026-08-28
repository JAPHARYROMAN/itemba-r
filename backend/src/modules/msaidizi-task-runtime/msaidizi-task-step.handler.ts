import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AuditChannel,
  AuditScopeKind,
  AuditSeverity,
  BackgroundJobStatus,
  BackgroundJobType,
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziHostActionStatus,
  MsaidiziPrincipalStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import { capabilityEffect } from '../../common/capabilities/capability-manifest';
import { MSAIDIZI_SERVICE_PRINCIPAL_TYPE } from '../../common/context/request-context';
import { AuditLogsService, redactSensitiveFields } from '../audit-logs/audit-logs.service';
import { MsaidiziTaskTokenService } from '../auth/msaidizi-task-token.service';
import { JobContext, JobHandlerRegistry, JobResult } from '../job-worker/job-handler.registry';
import {
  CapabilityInvoker,
  InvocationResult,
  MAX_CAPABILITY_RESPONSE_BYTES,
} from '../msaidizi/capability-invoker';
import {
  ErpEgressInvocationBinding,
  ErpEgressMeteringReceipt,
  verifyErpEgressMeteringReceipt,
} from '../msaidizi/erp-egress-metering';
import { CrudCoverageService } from '../msaidizi/crud-coverage.service';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import {
  MsaidiziInputBindingError,
  ResolvedStepInputs,
  resolveStepInputs,
  staticStepInputs,
} from '../msaidizi-tasks/msaidizi-input-bindings';
import { NotificationsService } from '../notifications/notifications.service';
import { MsaidiziArtifactsService } from '../msaidizi-artifacts/msaidizi-artifacts.service';
import {
  HostActionPolicyError,
  MsaidiziDevicesService,
} from '../msaidizi-devices/msaidizi-devices.service';
import {
  assertUpdateCandidateProposalStep,
  mandateAuthorizesUpdateCandidateProposal,
  UpdateCandidateProposalPolicyError,
  UpdateCandidateProposalPort,
} from '../msaidizi-updates/update-candidate-proposal.port';
import { preparePersistedUntrustedObservation } from './persisted-observation';
import {
  parseStepBudgets,
  stepDispatchBudgetExhaustion,
  stepLocalIoState,
  validateStepStopConditions,
} from './msaidizi-step-controls';
import {
  FinishMsaidiziSpan,
  MsaidiziObservabilityService,
  MsaidiziSpan,
} from './msaidizi-observability.service';
import {
  authoritativeTaskWallTimeExceeded,
  checkpointTaskWallTimeForAuthorization,
} from './msaidizi-task-wall-time';

interface StepPayload {
  kind: 'msaidizi-task-step/v1';
  taskId: string;
  stepId: string;
  maxAttempts: number;
}

interface ReservedAttempt {
  id: string;
  number: number;
}

interface ErpEgressSettlement {
  reservedExternalEgressBytes: number;
  chargedExternalEgressBytes: number;
  verified: boolean;
  receipt?: ErpEgressMeteringReceipt;
  errorCode?: string;
}

type ErpEgressReservation = { ok: true; bytes: number } | { ok: false; code: string };

export function hostQueueCheckpointData(queued: {
  queued: boolean;
  replay: boolean;
  actionId: string;
  deviceId: string;
}) {
  return {
    ok: true,
    queued: queued.queued,
    replay: queued.replay,
    actionId: queued.actionId,
    deviceId: queued.deviceId,
  };
}

/** Executes exactly one immutable plan step and persists only redacted summaries. */
@Injectable()
export class MsaidiziTaskStepHandler implements OnModuleInit {
  private readonly logger = new Logger(MsaidiziTaskStepHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly autonomy: AutonomyConfig,
    private readonly msaidizi: MsaidiziConfig,
    private readonly manifest: ManifestProvider,
    private readonly invoker: CapabilityInvoker,
    private readonly tokens: MsaidiziTaskTokenService,
    private readonly crudCoverage: CrudCoverageService,
    private readonly audit: AuditLogsService,
    @Optional() private readonly devices?: MsaidiziDevicesService,
    private readonly notifications?: NotificationsService,
    @Optional() private readonly updateCandidates?: UpdateCandidateProposalPort,
    @Optional() private readonly artifacts?: MsaidiziArtifactsService,
    @Optional() private readonly observability?: MsaidiziObservabilityService,
  ) {}

  onModuleInit(): void {
    this.registry.register('MSAIDIZI_TASK_STEP', (context) => this.handle(context));
  }

  private async handle(context: JobContext): Promise<JobResult> {
    const payload = parsePayload(context.payload);
    let span: MsaidiziSpan | undefined;
    try {
      span = this.observability?.startSpan({
        operation: 'msaidizi.step.execute',
        taskId: payload.taskId,
        stepId: payload.stepId,
        jobId: context.jobId,
      });
    } catch {
      // Telemetry input/persistence is deliberately fail-open. The task state,
      // tool-attempt ledger, and action result remain the sources of truth.
    }

    try {
      const result = await this.executeStep(context, payload);
      if (span) await this.observability?.finishSpan(span, stepTraceResult(result));
      return result;
    } catch (error) {
      if (span) {
        await this.observability?.finishSpan(span, {
          outcome: 'FAILED',
          outcomeCode: 'HANDLER_EXCEPTION',
        });
      }
      throw error;
    }
  }

  private async executeStep(context: JobContext, payload: StepPayload): Promise<JobResult> {
    await context.checkpoint?.();

    const loaded = await this.load(payload.taskId, payload.stepId);
    if (!loaded) throw new Error('Msaidizi task step not found');
    if (loaded.step.status === MsaidiziTaskStepStatus.SUCCEEDED) {
      return { data: { skipped: true, reason: 'step already succeeded' } };
    }
    if (loaded.task.status !== MsaidiziTaskStatus.RUNNING) {
      return { data: { skipped: true, reason: `task is ${loaded.task.status}` } };
    }
    if (loaded.plan.version !== loaded.task.activePlanVersion) {
      await this.rejectWithoutDispatch(loaded.task.id, loaded.step.id, 'STALE_PLAN_VERSION');
      return { data: { rejected: true, reason: 'stale plan version' } };
    }
    if (this.autonomy.globalKillSwitchActive) {
      // Check before reserving an attempt, mutation counter, host lease, model
      // call, update proposal, or ERP credential. The deployment kill switch
      // is outside model/database authority and is re-read for every job.
      await this.rejectWithoutDispatch(loaded.task.id, loaded.step.id, 'GLOBAL_KILL_SWITCH');
      return { data: { rejected: true, reason: 'global kill switch active' } };
    }

    if (
      loaded.step.mutation &&
      loaded.step.status === MsaidiziTaskStepStatus.RUNNING &&
      loaded.step.attemptCount > 0
    ) {
      // This can only be a legacy/generic retry or a duplicate job: a mutation
      // reserves exactly one attempt. Confirm this invocation still owns its
      // job lease, then either defer to the distinct live owner or close the
      // abandoned attempt as UNKNOWN without dispatching again.
      await context.checkpoint?.();
      const replayBarrier = await this.reconcileBlockedMutationRetry(
        context.jobId,
        loaded.task.id,
        loaded.step.id,
      );
      if (replayBarrier === 'ACTIVE_OWNER') {
        return { data: { skipped: true, reason: 'original mutation owner is still active' } };
      }
      if (replayBarrier === 'RECONCILED') {
        return { data: { ok: false, uncertainOutcome: true, replayBlocked: true } };
      }
      // A terminal non-unknown attempt is authoritative. Fail this impossible
      // duplicate job rather than turning it into a successful no-op that can
      // strand the RUNNING step.
      throw new Error('Mutation retry was blocked by an existing terminal attempt');
    }

    const stepBudgetError = stepBudgetPolicyError(loaded.task, loaded.step);
    if (stepBudgetError) {
      await this.rejectWithoutDispatch(loaded.task.id, loaded.step.id, stepBudgetError);
      return { data: { rejected: true, reason: stepBudgetError } };
    }

    const attempt = await this.reserveAttempt(loaded.task, loaded.step);
    if (!attempt) {
      const current = await this.load(loaded.task.id, loaded.step.id);
      if (
        !current ||
        current.task.status !== MsaidiziTaskStatus.RUNNING ||
        current.task.principal.status !== MsaidiziPrincipalStatus.ACTIVE ||
        current.step.status === MsaidiziTaskStepStatus.RUNNING
      ) {
        await this.prisma.msaidiziTaskStep.updateMany({
          where: { id: loaded.step.id, status: MsaidiziTaskStepStatus.LEASED },
          data: { status: MsaidiziTaskStepStatus.READY },
        });
        return { data: { skipped: true, reason: 'task state changed before reservation' } };
      }
      await this.needsAttention(loaded.task.id, loaded.step.id, 'TASK_BUDGET_EXHAUSTED');
      return { data: { rejected: true, reason: 'task budget exhausted' } };
    }

    let resolvedInputs: ResolvedStepInputs;
    try {
      resolvedInputs = hasInputBindings(loaded.step.inputBindings)
        ? await resolveStepInputs(
            this.prisma,
            loaded.task.id,
            loaded.step.id,
            attempt.id,
            this.artifacts
              ? (binding) => this.artifacts!.materializeForHostAction(binding)
              : undefined,
          )
        : staticStepInputs(
            loaded.task.id,
            loaded.plan.id,
            loaded.step.id,
            attempt.id,
            loaded.step.arguments,
          );
      if (hasInputBindings(loaded.step.inputBindings)) {
        await this.bindResolvedInputs(loaded, attempt.id, resolvedInputs);
      }
    } catch (error) {
      const reason =
        error instanceof MsaidiziInputBindingError ? error.code : 'INPUT_BINDING_RESOLUTION_FAILED';
      await this.settleRejected(loaded.task.id, loaded.step.id, attempt.id, reason);
      return { data: { rejected: true, reason } };
    }

    const policyError = await this.policyRejection(loaded);
    if (policyError) {
      await this.settleRejected(loaded.task.id, loaded.step.id, attempt.id, policyError);
      return { data: { rejected: true, reason: policyError } };
    }
    if (this.autonomy.globalKillSwitchActive) {
      await this.deferReservedAttempt(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        'GLOBAL_KILL_SWITCH',
      );
      return { data: { skipped: true, reason: 'global kill switch active' } };
    }

    if (loaded.step.target === MsaidiziExecutionTarget.HOST) {
      try {
        const queued = await this.devices!.queueHostAction(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          resolvedInputs,
        );
        await context.checkpoint?.();
        return { data: hostQueueCheckpointData(queued) };
      } catch (error) {
        const reason =
          error instanceof HostActionPolicyError ? error.code : 'HOST_ACTION_QUEUE_FAILED';
        this.logger.warn(
          `Could not queue host action for step ${loaded.step.id}: ${(error as Error).message}`,
        );
        if (await this.shouldDeferForOperatorPause(loaded.task.id)) {
          await this.deferReservedAttempt(
            loaded.task.id,
            loaded.step.id,
            attempt.id,
            'GLOBAL_AUTOPILOT_DISABLED',
          );
          return { data: { skipped: true, reason: 'global Autopilot disabled' } };
        }
        await this.settleRejected(loaded.task.id, loaded.step.id, attempt.id, reason);
        return { data: { rejected: true, reason } };
      }
    }

    if (loaded.step.target === MsaidiziExecutionTarget.SELF_IMPROVEMENT) {
      if (!(await this.markAttemptRunning(loaded.task.id, attempt.id))) {
        await this.deferReservedAttempt(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          'TASK_STATE_CHANGED_BEFORE_DISPATCH',
        );
        return { data: { skipped: true, reason: 'task state changed before dispatch' } };
      }
      try {
        const proposal = await this.updateCandidates!.propose({
          taskId: loaded.task.id,
          planVersionId: loaded.plan.id,
          stepId: loaded.step.id,
          attemptId: attempt.id,
        });
        const resultText = safeStringify(proposal);
        await this.succeed(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          proposal.replay ? 200 : 201,
          Buffer.byteLength(resultText, 'utf8'),
          sha256Hex(resultText),
          { candidateId: proposal.candidateId },
        );
        await context.checkpoint?.();
        return { data: { ok: true, candidateId: proposal.candidateId, replay: proposal.replay } };
      } catch (error) {
        if (error instanceof UpdateCandidateProposalPolicyError) {
          await this.settleRejected(loaded.task.id, loaded.step.id, attempt.id, error.code);
          return { data: { rejected: true, reason: error.code } };
        }
        // A database disconnect can make commit acknowledgement uncertain. The
        // unique step key makes operator reconciliation possible, but this
        // mutation is never retried automatically.
        await this.unknownOutcome(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          0,
          'Update proposal outcome could not be confirmed',
        );
        return { data: { ok: false, uncertainOutcome: true } };
      }
    }

    const capability = this.manifest
      .capabilities()
      .find((candidate) => candidate.id === loaded.step.capability)!;
    let issued;
    try {
      issued = await this.tokens.issue({
        taskId: loaded.task.id,
        stepId: loaded.step.id,
        attemptId: attempt.id,
        argsDigest: resolvedInputs.argumentsSha256,
        inputProvenanceSha256: resolvedInputs.provenanceSha256,
      });
    } catch {
      if (await this.shouldDeferForOperatorPause(loaded.task.id)) {
        await this.deferReservedAttempt(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          'GLOBAL_AUTOPILOT_DISABLED',
        );
        return { data: { skipped: true, reason: 'global Autopilot disabled' } };
      }
      await this.settleRejected(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        'TASK_CREDENTIAL_UNAVAILABLE',
      );
      return { data: { rejected: true, reason: 'task credential unavailable' } };
    }
    await context.checkpoint?.();

    let egressReservation: number | undefined;
    if (capability.externalEgress) {
      const reserved = await this.reserveErpEgressBudget(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        loaded.step.budgets,
        capability.externalEgress.reservationBytes,
      );
      if (!reserved.ok) {
        await this.settleRejected(loaded.task.id, loaded.step.id, attempt.id, reserved.code);
        return { data: { rejected: true, reason: reserved.code } };
      }
      egressReservation = reserved.bytes;
    }

    let responseReservation: number | null = null;
    let localReservationFailure = 'TASK_LOCAL_IO_BUDGET_EXHAUSTED';
    try {
      responseReservation = await this.reserveErpResponseBudget(
        loaded.task.id,
        loaded.step.id,
        loaded.step.budgets,
      );
    } catch (error) {
      localReservationFailure = 'STEP_LOCAL_IO_ACCOUNTING_FAILED';
      this.logger.error(
        `Could not reserve ERP response bytes for ${attempt.id}: ${(error as Error).message}`,
      );
      await this.prisma.msaidiziTaskStep
        .updateMany({
          where: { id: loaded.step.id, taskId: loaded.task.id },
          data: { localIoAccountingValid: false, checkpointedAt: new Date() },
        })
        .catch(() => undefined);
    }
    if (!responseReservation) {
      if (egressReservation !== undefined) {
        try {
          await this.releaseErpEgressReservation(
            loaded.task.id,
            loaded.step.id,
            attempt.id,
            egressReservation,
          );
        } catch (error) {
          this.logger.error(
            `Could not release ERP egress reservation for ${attempt.id}: ${(error as Error).message}`,
          );
          await this.settleRejected(
            loaded.task.id,
            loaded.step.id,
            attempt.id,
            'ERP_EGRESS_RESERVATION_RELEASE_FAILED',
          );
          return {
            data: { rejected: true, reason: 'ERP egress reservation release failed' },
          };
        }
      }
      await this.settleRejected(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        localReservationFailure,
      );
      return { data: { rejected: true, reason: localReservationFailure } };
    }

    if (!(await this.markAttemptRunning(loaded.task.id, attempt.id))) {
      try {
        await this.reconcileErpResponseBudget(
          loaded.task.id,
          loaded.step.id,
          responseReservation,
          0,
        );
        if (egressReservation !== undefined) {
          await this.releaseErpEgressReservation(
            loaded.task.id,
            loaded.step.id,
            attempt.id,
            egressReservation,
          );
        }
        await this.deferReservedAttempt(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          'TASK_STATE_CHANGED_BEFORE_DISPATCH',
        );
      } catch (error) {
        this.logger.error(
          `Could not unwind pre-dispatch reservations for ${attempt.id}: ${(error as Error).message}`,
        );
        await this.settleRejected(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          'PRE_DISPATCH_RESERVATION_RELEASE_FAILED',
        );
      }
      return { data: { skipped: true, reason: 'task state changed before dispatch' } };
    }

    const result = await this.invoker.invoke({
      capability,
      args: resolvedInputs.arguments,
      authorization: `Bearer ${issued.accessToken}`,
      agentSessionId: taskSessionId(loaded.task.id),
      inputProvenanceSha256: resolvedInputs.provenanceSha256,
      maxResponseBytes: responseReservation,
      ...(egressReservation !== undefined
        ? {
            egressBinding: {
              taskId: loaded.task.id,
              planVersionId: loaded.plan.id,
              stepId: loaded.step.id,
              attemptId: attempt.id,
              capabilityId: capability.id,
              capabilityVersion: loaded.step.capabilityVersion,
              argumentsSha256: resolvedInputs.argumentsSha256,
              reservedExternalEgressBytes: egressReservation,
            } satisfies ErpEgressInvocationBinding,
          }
        : {}),
    });
    const resultText = safeStringify(result.body);
    const resultBytes =
      result.responseBytes ?? (result.status === 0 ? 0 : Buffer.byteLength(resultText, 'utf8'));
    const resultSha256 = result.responseSha256 ?? sha256Hex(result.status === 0 ? '' : resultText);
    const resultEntityIdentifiers = extractEntityIdentifiers(result.body);
    const egressSettlement =
      egressReservation === undefined
        ? undefined
        : deriveErpEgressSettlement(
            result,
            {
              taskId: loaded.task.id,
              planVersionId: loaded.plan.id,
              stepId: loaded.step.id,
              attemptId: attempt.id,
              capabilityId: capability.id,
              capabilityVersion: loaded.step.capabilityVersion,
              argumentsSha256: resolvedInputs.argumentsSha256,
              reservedExternalEgressBytes: egressReservation,
            },
            resultSha256,
          );

    try {
      await this.reconcileErpResponseBudget(
        loaded.task.id,
        loaded.step.id,
        responseReservation,
        result.responseLimitExceeded ? responseReservation : resultBytes,
      );
    } catch (error) {
      await this.prisma.msaidiziTaskStep
        .updateMany({
          where: { id: loaded.step.id, taskId: loaded.task.id },
          data: { localIoAccountingValid: false, checkpointedAt: new Date() },
        })
        .catch(() => undefined);
      await this.responsePersistenceFailure(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        loaded.step.mutation,
        result.status,
        'ERP_RESPONSE_BUDGET_RECONCILIATION_FAILED',
        (error as Error).message,
        egressSettlement,
      );
      return { data: { ok: false, uncertainOutcome: loaded.step.mutation } };
    }

    if (result.responseLimitExceeded) {
      await this.responsePersistenceFailure(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        loaded.step.mutation,
        result.status,
        'ERP_RESPONSE_BUDGET_EXCEEDED',
        result.error,
        egressSettlement,
      );
      return { data: { ok: false, responseLimitExceeded: true } };
    }

    if (egressSettlement && !egressSettlement.verified) {
      await this.erpEgressReceiptFailure(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        result.status,
        egressSettlement,
      );
      return {
        data: {
          ok: false,
          uncertainOutcome: true,
          reason: egressSettlement.errorCode,
        },
      };
    }

    if (egressSettlement?.receipt?.outcome === 'unknown') {
      await this.unknownOutcome(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        result.status,
        'ERP adapter reported an unknown external outcome',
        egressSettlement,
      );
      return { data: { ok: false, uncertainOutcome: true } };
    }

    if (result.ok) {
      let observation: Prisma.InputJsonObject;
      try {
        observation = await this.persistToolObservationArtifact(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          loaded.step.dataClass,
          result.body,
        );
      } catch (error) {
        await this.responsePersistenceFailure(
          loaded.task.id,
          loaded.step.id,
          attempt.id,
          loaded.step.mutation,
          result.status,
          'ERP_OBSERVATION_ACCOUNTING_FAILED',
          (error as Error).message,
          egressSettlement,
        );
        return { data: { ok: false, uncertainOutcome: loaded.step.mutation } };
      }
      await this.succeed(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        result.status,
        resultBytes,
        resultSha256,
        resultEntityIdentifiers,
        observation,
        emptyToolResult(result.body),
        egressSettlement,
      );
      return { data: { ok: true, status: result.status, bytes: resultBytes } };
    }

    const uncertain = loaded.step.mutation && (result.status === 0 || result.status >= 500);
    if (uncertain) {
      await this.unknownOutcome(
        loaded.task.id,
        loaded.step.id,
        attempt.id,
        result.status,
        result.error,
        egressSettlement,
      );
      return { data: { ok: false, uncertainOutcome: true } };
    }

    const transientRead =
      !loaded.step.mutation &&
      loaded.step.idempotent &&
      (result.status === 0 || result.status >= 500);
    const finalAttempt = attempt.number >= payload.maxAttempts;
    await this.failAttempt(
      loaded.task.id,
      loaded.step.id,
      attempt.id,
      result.status,
      result.error,
      !transientRead || finalAttempt,
      resultBytes,
      resultSha256,
      egressSettlement,
    );
    if (transientRead && !finalAttempt) {
      throw new Error(`Transient ERP read failed (${result.status || 'transport'})`);
    }
    return { data: { ok: false, status: result.status } };
  }

  private async load(taskId: string, stepId: string) {
    const task = await this.prisma.msaidiziTask.findUnique({
      where: { id: taskId },
      include: { principal: true, mandate: true },
    });
    const step = await this.prisma.msaidiziTaskStep.findFirst({
      where: { id: stepId, taskId },
      include: { planVersion: true },
    });
    if (!task || !step) return null;
    return { task, step, plan: step.planVersion };
  }

  private async reserveAttempt(
    task: {
      id: string;
      principalId: string;
      initiatedByUserId: string | null;
      mandateId: string | null;
      companyId: string | null;
      status: MsaidiziTaskStatus;
      attemptedToolCalls: number;
      maxAttemptedToolCalls: number;
      mutations: number;
      maxMutations: number;
      consumedWallTimeMs: bigint;
      wallTimeCheckpointAt: Date | null;
      maxWallTimeSeconds: number;
    },
    step: {
      id: string;
      status: MsaidiziTaskStepStatus;
      attemptCount: number;
      mutation: boolean;
      capability: string;
      planVersionId: string;
      arguments: Prisma.JsonValue;
      inputBindings: Prisma.JsonValue;
      startedAt: Date | null;
    },
  ): Promise<ReservedAttempt | null> {
    if (
      task.attemptedToolCalls >= task.maxAttemptedToolCalls ||
      (step.mutation && task.mutations >= task.maxMutations) ||
      // A mutation has exactly one durable dispatch opportunity. Even an
      // operator-replayed or duplicate worker job may not manufacture a second
      // attempt after the first lease generation was reserved.
      (step.mutation && step.attemptCount > 0)
    ) {
      return null;
    }

    const attemptNumber = step.attemptCount + 1;
    const attemptStartedAt = new Date();
    const id = `attempt-${step.id}-${attemptNumber}`;
    const staticInputs = hasInputBindings(step.inputBindings)
      ? null
      : staticStepInputs(task.id, step.planVersionId, step.id, id, step.arguments);
    const initialArgsDigest =
      staticInputs?.argumentsSha256 ??
      actionArgumentDigest(step.arguments as Record<string, unknown>);
    try {
      const reserved = await this.prisma.$transaction(async (tx) => {
        const authoritativeWallTime = await checkpointTaskWallTimeForAuthorization(tx, task.id);
        if (!authoritativeWallTime || authoritativeTaskWallTimeExceeded(authoritativeWallTime)) {
          return false;
        }
        const taskWon = await tx.msaidiziTask.updateMany({
          where: {
            id: task.id,
            status: MsaidiziTaskStatus.RUNNING,
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
            attemptedToolCalls: task.attemptedToolCalls,
            mutations: task.mutations,
          },
          data: {
            attemptedToolCalls: { increment: 1 },
            ...(step.mutation ? { mutations: { increment: 1 } } : {}),
            lastCheckpointAt: new Date(),
          },
        });
        const stepWon = await tx.msaidiziTaskStep.updateMany({
          where: {
            id: step.id,
            status: step.mutation
              ? MsaidiziTaskStepStatus.LEASED
              : { in: [MsaidiziTaskStepStatus.LEASED, MsaidiziTaskStepStatus.RUNNING] },
            attemptCount: step.attemptCount,
            startedAt: step.startedAt,
          },
          data: {
            status: MsaidiziTaskStepStatus.RUNNING,
            attemptCount: { increment: 1 },
            ...(step.startedAt ? {} : { startedAt: attemptStartedAt }),
          },
        });
        if (taskWon.count !== 1 || stepWon.count !== 1) throw new Error('attempt reservation lost');
        await tx.msaidiziToolAttempt.create({
          data: {
            id,
            taskId: task.id,
            stepId: step.id,
            attemptNumber,
            toolName: step.capability,
            argumentsRedacted: redactSensitiveFields(step.arguments) as Prisma.InputJsonValue,
            argsDigest: initialArgsDigest,
            ...(staticInputs
              ? {
                  resolvedInputProvenance: staticInputs.provenance,
                  inputProvenanceSha256: staticInputs.provenanceSha256,
                }
              : {}),
            idempotencyKey: `msaidizi-attempt:${step.id}:${attemptNumber}`,
            status: MsaidiziToolAttemptStatus.REQUESTED,
          },
        });
        await this.event(tx, task.id, 'tool.attempted', {
          stepId: step.id,
          attemptId: id,
          attemptNumber,
          inputProvenanceSha256: staticInputs?.provenanceSha256 ?? null,
        });
        await this.audit.logStrictInTransaction(tx, {
          action: step.mutation ? 'MSAIDIZI_ERP_MUTATION_REQUESTED' : 'MSAIDIZI_ERP_READ_REQUESTED',
          entityType: 'MsaidiziToolAttempt',
          entityId: id,
          userId: task.initiatedByUserId,
          companyId: task.companyId,
          scopeKind: task.companyId ? AuditScopeKind.COMPANY : AuditScopeKind.GROUP,
          newValue: {
            capability: step.capability,
            argsDigest: initialArgsDigest,
            inputProvenanceSha256: staticInputs?.provenanceSha256 ?? null,
            attemptNumber,
            mutation: step.mutation,
          },
          severity: step.mutation ? AuditSeverity.HIGH : AuditSeverity.LOW,
          channel: AuditChannel.AGENT,
          agentSessionId: taskSessionId(task.id),
          principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
          principalId: task.principalId,
          mandateId: task.mandateId,
          initiatedByUserId: task.initiatedByUserId,
          taskId: task.id,
          stepId: step.id,
        });
        return true;
      });
      if (!reserved) return null;
      return { id, number: attemptNumber };
    } catch (error) {
      this.logger.warn(`Could not reserve task step attempt: ${(error as Error).message}`);
      return null;
    }
  }

  private async bindResolvedInputs(
    loaded: NonNullable<Awaited<ReturnType<typeof this.load>>>,
    attemptId: string,
    resolved: ResolvedStepInputs,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziToolAttempt.updateMany({
        where: {
          id: attemptId,
          taskId: loaded.task.id,
          stepId: loaded.step.id,
          status: MsaidiziToolAttemptStatus.REQUESTED,
          resolvedInputProvenance: { equals: Prisma.AnyNull },
        },
        data: {
          argumentsRedacted: redactSensitiveFields(resolved.arguments) as Prisma.InputJsonValue,
          argsDigest: resolved.argumentsSha256,
          resolvedInputProvenance: resolved.provenance,
          inputProvenanceSha256: resolved.provenanceSha256,
        },
      });
      if (won.count !== 1) {
        const existing = await tx.msaidiziToolAttempt.findFirst({
          where: { id: attemptId, taskId: loaded.task.id, stepId: loaded.step.id },
          select: { argsDigest: true, inputProvenanceSha256: true },
        });
        if (
          !existing ||
          existing.argsDigest !== resolved.argumentsSha256 ||
          existing.inputProvenanceSha256 !== resolved.provenanceSha256
        ) {
          throw new MsaidiziInputBindingError(
            'INPUT_BINDING_ATTEMPT_TAMPERED',
            'Reserved attempt input provenance changed before dispatch',
          );
        }
        return;
      }
      await this.event(tx, loaded.task.id, 'step.inputs_resolved', {
        stepId: loaded.step.id,
        attemptId,
        argsDigest: resolved.argumentsSha256,
        inputProvenanceSha256: resolved.provenanceSha256,
        bindingCount: Array.isArray(loaded.step.inputBindings)
          ? loaded.step.inputBindings.length
          : 0,
      });
      await this.audit.logStrictInTransaction(tx, {
        action: 'MSAIDIZI_STEP_INPUTS_RESOLVED',
        entityType: 'MsaidiziToolAttempt',
        entityId: attemptId,
        userId: loaded.task.initiatedByUserId,
        companyId: loaded.task.companyId,
        scopeKind: loaded.task.companyId ? AuditScopeKind.COMPANY : AuditScopeKind.GROUP,
        newValue: {
          argsDigest: resolved.argumentsSha256,
          inputProvenanceSha256: resolved.provenanceSha256,
        },
        severity: loaded.step.mutation ? AuditSeverity.HIGH : AuditSeverity.LOW,
        channel: AuditChannel.AGENT,
        agentSessionId: taskSessionId(loaded.task.id),
        principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
        principalId: loaded.task.principalId,
        mandateId: loaded.task.mandateId,
        initiatedByUserId: loaded.task.initiatedByUserId,
        taskId: loaded.task.id,
        stepId: loaded.step.id,
      });
    });
  }

  private async policyRejection(loaded: NonNullable<Awaited<ReturnType<typeof this.load>>>) {
    const { task, step } = loaded;
    if (this.autonomy.globalKillSwitchActive) return 'GLOBAL_KILL_SWITCH';
    if (!this.autonomy.enabled) return 'AUTONOMY_DISABLED';
    if (task.principal.status !== MsaidiziPrincipalStatus.ACTIVE) {
      return 'GLOBAL_AUTOPILOT_DISABLED';
    }
    if (task.mode === MsaidiziTaskMode.ASK && step.expectedEffect !== MsaidiziEffect.READ) {
      return 'ASK_MODE_IS_READ_ONLY';
    }
    if (step.target === MsaidiziExecutionTarget.HOST) {
      if (task.mode !== MsaidiziTaskMode.AUTOPILOT) {
        return 'HOST_REQUIRES_AUTOPILOT_MANDATE';
      }
      if (!this.autonomy.hostExecutionEnabled || !task.hostExecutionAllowed) {
        return 'HOST_EXECUTION_DISABLED';
      }
      return this.devices ? null : 'HOST_CHANNEL_NOT_CONNECTED';
    }
    if (step.target === MsaidiziExecutionTarget.SELF_IMPROVEMENT) {
      if (!this.autonomy.autopilotEnabled || task.mode !== MsaidiziTaskMode.AUTOPILOT) {
        return 'UPDATE_PROPOSAL_REQUIRES_AUTOPILOT';
      }
      if (!this.updateCandidates) return 'UPDATE_PROPOSAL_PORT_UNAVAILABLE';
      if (!loaded.plan.createdByUserId || loaded.plan.createdByUserId !== task.initiatedByUserId) {
        return 'UPDATE_PROPOSAL_PLAN_NOT_REVIEWED';
      }
      try {
        assertUpdateCandidateProposalStep(step);
        if (!mandateAuthorizesUpdateCandidateProposal(task.mandate?.capabilities, step)) {
          return 'UPDATE_PROPOSAL_MANDATE_SCOPE_DENIED';
        }
      } catch (error) {
        return error instanceof UpdateCandidateProposalPolicyError
          ? error.code
          : 'UPDATE_PROPOSAL_STEP_INVALID';
      }
      return null;
    }
    if (step.target !== MsaidiziExecutionTarget.ERP) return 'UNKNOWN_EXECUTION_TARGET';
    if (this.crudCoverage.report().releaseGate.status !== 'passed') {
      return 'ERP_CRUD_RELEASE_GATE_BLOCKED';
    }
    const capability = this.manifest
      .capabilities()
      .find((candidate) => candidate.id === step.capability);
    if (!capability) return 'CAPABILITY_NOT_FOUND';
    if (capability.agentExcluded) return 'CAPABILITY_AGENT_EXCLUDED';
    if (!['permission', 'permission-any'].includes(capability.guard)) {
      return 'CAPABILITY_NOT_PERMISSION_GATED';
    }
    if (!this.msaidizi.allowedTiers.includes(capability.tier)) {
      return 'CAPABILITY_TIER_DISABLED';
    }
    if (capability.tier === 'red' && task.mode !== MsaidiziTaskMode.AUTOPILOT) {
      return 'HUMAN_RED_REQUIRES_ONE_SHOT_APPROVAL';
    }
    const declaredEffect = capabilityEffect(capability) as MsaidiziEffect;
    if (step.expectedEffect !== declaredEffect) {
      return 'EFFECT_MISMATCH';
    }
    if (step.mutation !== (declaredEffect !== MsaidiziEffect.READ)) {
      return 'MUTATION_CLASSIFICATION_MISMATCH';
    }
    if (
      !principalHasCapability(
        task.principal.grants,
        capability.permissions,
        capability.anyPermissions,
      )
    ) {
      return 'PRINCIPAL_PERMISSION_DENIED';
    }
    // The database row is an audit snapshot, not a durable source of
    // deployment-owned authority. Re-read the configured ceiling on every
    // attempt so a restart with a removed grant stops already-running tasks.
    if (
      !principalHasCapability(
        this.autonomy.principalGrants,
        capability.permissions,
        capability.anyPermissions,
      )
    ) {
      return 'DEPLOYMENT_PRINCIPAL_PERMISSION_DENIED';
    }
    if (task.mode === MsaidiziTaskMode.AUTOPILOT && !mandateAllowsErpStep(task.mandate, step)) {
      return 'MANDATE_CAPABILITY_DENIED';
    }
    if (
      task.mode === MsaidiziTaskMode.AUTOPILOT &&
      !taskFitsMandateBudget(task, task.mandate?.budgets)
    ) {
      return 'MANDATE_BUDGET_EXCEEDED';
    }
    return null;
  }

  /**
   * Reserves the manifest-declared worst case before the loopback dispatch.
   * The task CAS protects concurrent steps; the attempt marker protects the
   * immutable step ceiling across worker restarts without another schema field.
   */
  private async reserveErpEgressBudget(
    taskId: string,
    stepId: string,
    attemptId: string,
    rawStepBudgets: Prisma.JsonValue,
    requestedBytes: number,
  ): Promise<ErpEgressReservation> {
    const parsed = parseStepBudgets(rawStepBudgets);
    if (!parsed.ok) return { ok: false, code: parsed.code };
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes <= 0) {
      return { ok: false, code: 'ERP_EGRESS_MANIFEST_RESERVATION_INVALID' };
    }
    const requested = BigInt(requestedBytes);

    for (let retry = 0; retry < 3; retry += 1) {
      const [task, attempts] = await Promise.all([
        this.prisma.msaidiziTask.findUnique({
          where: { id: taskId },
          select: {
            status: true,
            externalEgressBytes: true,
            reservedExternalEgressBytes: true,
            maxExternalEgressBytes: true,
          },
        }),
        this.prisma.msaidiziToolAttempt.findMany({
          where: { taskId, stepId },
          select: { resultSummary: true },
        }),
      ]);
      if (!task || task.status !== MsaidiziTaskStatus.RUNNING) {
        return { ok: false, code: 'TASK_STATE_CHANGED_BEFORE_EGRESS_RESERVATION' };
      }
      const stepAccounted = attempts.reduce(
        (total, prior) => total + resultSummaryExternalEgressBytes(prior.resultSummary),
        0n,
      );
      const stepLimit = parsed.limits.maxExternalEgressBytes;
      if (stepLimit !== undefined && stepAccounted + requested > BigInt(stepLimit)) {
        return { ok: false, code: 'STEP_EXTERNAL_EGRESS_BUDGET_EXHAUSTED' };
      }
      const spent = persistedBigInt(task.externalEgressBytes, 0n);
      const reserved = persistedBigInt(task.reservedExternalEgressBytes, 0n);
      const maximum = persistedBigInt(task.maxExternalEgressBytes, 0n);
      if (spent + reserved + requested > maximum) {
        return { ok: false, code: 'TASK_EXTERNAL_EGRESS_BUDGET_EXHAUSTED' };
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          const taskWon = await tx.msaidiziTask.updateMany({
            where: {
              id: taskId,
              status: MsaidiziTaskStatus.RUNNING,
              externalEgressBytes: spent,
              reservedExternalEgressBytes: reserved,
            },
            data: {
              reservedExternalEgressBytes: { increment: requested },
              lastCheckpointAt: new Date(),
            },
          });
          const attemptWon = await tx.msaidiziToolAttempt.updateMany({
            where: {
              id: attemptId,
              taskId,
              stepId,
              status: MsaidiziToolAttemptStatus.REQUESTED,
            },
            data: {
              resultSummary: {
                externalEgress: {
                  settlementStatus: 'RESERVED',
                  reservedExternalEgressBytes: requestedBytes,
                  chargedExternalEgressBytes: 0,
                  metering: 'adapter-receipt-v1',
                },
              },
            },
          });
          if (taskWon.count !== 1 || attemptWon.count !== 1) {
            throw new Error('ERP egress reservation CAS lost');
          }
          await this.event(tx, taskId, 'tool.egress_reserved', {
            stepId,
            attemptId,
            reservedExternalEgressBytes: requestedBytes,
          });
        });
        return { ok: true, bytes: requestedBytes };
      } catch (error) {
        if (retry === 2) {
          this.logger.warn(`Could not reserve ERP egress: ${(error as Error).message}`);
          return { ok: false, code: 'ERP_EGRESS_RESERVATION_CONFLICT' };
        }
      }
    }
    return { ok: false, code: 'ERP_EGRESS_RESERVATION_CONFLICT' };
  }

  /** Releases a reservation only while the exact attempt is still undispatched. */
  private async releaseErpEgressReservation(
    taskId: string,
    stepId: string,
    attemptId: string,
    reservedBytes: number,
  ): Promise<void> {
    const reserved = BigInt(reservedBytes);
    await this.prisma.$transaction(async (tx) => {
      const attemptWon = await tx.msaidiziToolAttempt.updateMany({
        where: {
          id: attemptId,
          taskId,
          stepId,
          status: MsaidiziToolAttemptStatus.REQUESTED,
        },
        data: {
          resultSummary: {
            externalEgress: {
              settlementStatus: 'RELEASED_BEFORE_DISPATCH',
              reservedExternalEgressBytes: reservedBytes,
              chargedExternalEgressBytes: 0,
              metering: 'adapter-receipt-v1',
            },
          },
        },
      });
      const taskWon = await tx.msaidiziTask.updateMany({
        where: { id: taskId, reservedExternalEgressBytes: { gte: reserved } },
        data: {
          reservedExternalEgressBytes: { decrement: reserved },
          lastCheckpointAt: new Date(),
        },
      });
      if (attemptWon.count !== 1 || taskWon.count !== 1) {
        throw new Error('ERP egress reservation release CAS lost');
      }
      await this.event(tx, taskId, 'tool.egress_released', {
        stepId,
        attemptId,
        reservedExternalEgressBytes: reservedBytes,
      });
    });
  }

  /**
   * Reserve the maximum response bytes before dispatch. Concurrent steps can
   * therefore never jointly authorize more local I/O than the persisted task
   * ceiling. A crashed worker leaves a conservative reservation in place.
   */
  private async reserveErpResponseBudget(
    taskId: string,
    stepId: string,
    rawStepBudgets: Prisma.JsonValue = {},
  ): Promise<number | null> {
    const parsedStepBudget = parseStepBudgets(rawStepBudgets);
    if (!parsedStepBudget.ok) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${taskId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_task_steps" WHERE "id" = ${stepId} FOR UPDATE`;
      const [task, step] = await Promise.all([
        tx.msaidiziTask.findUnique({
          where: { id: taskId },
          select: {
            status: true,
            bytesRead: true,
            bytesWritten: true,
            maxLocalBytes: true,
          },
        }),
        tx.msaidiziTaskStep.findFirst({
          where: { id: stepId, taskId },
          select: {
            id: true,
            taskId: true,
            status: true,
            budgets: true,
            bytesRead: true,
            bytesWritten: true,
            localIoAccountingValid: true,
          },
        }),
      ]);
      if (
        !task ||
        !step ||
        task.status !== MsaidiziTaskStatus.RUNNING ||
        step.status !== MsaidiziTaskStepStatus.RUNNING
      ) {
        return null;
      }
      const taskRead = persistedBigInt(task.bytesRead, 0n);
      const taskWritten = persistedBigInt(task.bytesWritten, 0n);
      const taskMaximum = persistedBigInt(
        task.maxLocalBytes,
        BigInt(MAX_CAPABILITY_RESPONSE_BYTES),
      );
      const stepIo = stepLocalIoState(step);
      if (!stepIo.ok) throw new Error(`${stepIo.code}: ${stepIo.detail}`);
      let remaining = taskMaximum - taskRead - taskWritten;
      if (stepIo.remaining !== null && stepIo.remaining < remaining) {
        remaining = stepIo.remaining;
      }
      if (remaining <= 0n) return null;
      const reservation =
        remaining < BigInt(MAX_CAPABILITY_RESPONSE_BYTES)
          ? remaining
          : BigInt(MAX_CAPABILITY_RESPONSE_BYTES);
      const taskWon = await tx.msaidiziTask.updateMany({
        where: {
          id: taskId,
          status: MsaidiziTaskStatus.RUNNING,
          bytesRead: taskRead,
          bytesWritten: taskWritten,
        },
        data: { bytesRead: { increment: reservation }, lastCheckpointAt: new Date() },
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
        data: { bytesRead: { increment: reservation }, checkpointedAt: new Date() },
      });
      if (taskWon.count !== 1 || stepWon.count !== 1) {
        throw new Error('ERP response byte reservation CAS lost');
      }
      return Number(reservation);
    });
  }

  private async persistToolObservationArtifact(
    taskId: string,
    stepId: string,
    attemptId: string,
    dataClass: string,
    value: unknown,
  ): Promise<Prisma.InputJsonObject> {
    const prepared = preparePersistedUntrustedObservation(value, 'ERP_RESULT');
    if (!prepared.artifact) return prepared.observation;
    try {
      if (!this.artifacts) return prepared.observation;
      const stored = (await this.artifacts.ingestToolObservation({
        taskId,
        stepId,
        attemptId,
        dataClass,
        sourceType: 'ERP_RESULT',
        ...prepared.artifact,
      })) as {
        artifact?: { id?: unknown; sha256?: unknown; byteSize?: unknown };
        replay?: unknown;
      };
      const artifactId = stored.artifact?.id;
      if (
        typeof artifactId !== 'string' ||
        stored.artifact?.sha256 !== prepared.artifact.persistedSha256
      ) {
        throw new Error('Encrypted observation artifact response did not match its digest');
      }
      return {
        ...prepared.observation,
        reason: 'ARTIFACT_STORED',
        artifactId,
        artifactSha256: prepared.artifact.persistedSha256,
        artifactBytes: prepared.artifact.persistedBytes,
        redactionsApplied: prepared.artifact.redactionsApplied,
        replay: stored.replay === true,
      };
    } catch (error) {
      this.logger.error(
        `Could not persist encrypted observation artifact for step ${stepId}: ${(error as Error).message}`,
      );
      throw error;
    } finally {
      prepared.artifact.content.fill(0);
    }
  }

  private async reconcileErpResponseBudget(
    taskId: string,
    stepId: string,
    reservedBytes: number,
    usedBytes: number,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(reservedBytes) ||
      reservedBytes <= 0 ||
      !Number.isSafeInteger(usedBytes) ||
      usedBytes < 0 ||
      usedBytes > reservedBytes
    ) {
      throw new Error('ERP response byte accounting exceeded its reservation');
    }
    const refund = BigInt(reservedBytes - usedBytes);
    if (refund === 0n) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_tasks" WHERE "id" = ${taskId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "msaidizi_task_steps" WHERE "id" = ${stepId} FOR UPDATE`;
      const taskWon = await tx.msaidiziTask.updateMany({
        where: { id: taskId, bytesRead: { gte: BigInt(reservedBytes) } },
        data: { bytesRead: { decrement: refund }, lastCheckpointAt: new Date() },
      });
      const stepWon = await tx.msaidiziTaskStep.updateMany({
        where: {
          id: stepId,
          taskId,
          localIoAccountingValid: true,
          bytesRead: { gte: BigInt(reservedBytes) },
        },
        data: { bytesRead: { decrement: refund }, checkpointedAt: new Date() },
      });
      if (taskWon.count !== 1 || stepWon.count !== 1) {
        throw new Error('ERP response byte reservation could not be reconciled');
      }
    });
  }

  private async markAttemptRunning(taskId: string, attemptId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // This is the durable dispatch boundary. If cancellation wins first, the
      // attempt remains REQUESTED and no ERP/self-improvement mutation escapes.
      const taskWon = await tx.msaidiziTask.updateMany({
        where: { id: taskId, status: MsaidiziTaskStatus.RUNNING },
        data: { executedToolCalls: { increment: 1 }, lastCheckpointAt: new Date() },
      });
      if (taskWon.count !== 1) return false;
      await tx.msaidiziToolAttempt.update({
        where: { id: attemptId, status: MsaidiziToolAttemptStatus.REQUESTED },
        data: { status: MsaidiziToolAttemptStatus.RUNNING, startedAt: new Date() },
      });
      return true;
    });
  }

  private async shouldDeferForOperatorPause(taskId: string): Promise<boolean> {
    const task = await this.prisma.msaidiziTask.findUnique({
      where: { id: taskId },
      select: { status: true, principal: { select: { status: true } } },
    });
    return Boolean(
      task &&
      (task.status !== MsaidiziTaskStatus.RUNNING ||
        task.principal.status !== MsaidiziPrincipalStatus.ACTIVE),
    );
  }

  private async reconcileBlockedMutationRetry(
    jobId: string,
    taskId: string,
    stepId: string,
  ): Promise<'ACTIVE_OWNER' | 'RECONCILED' | 'TERMINAL_ATTEMPT'> {
    const [otherLiveJob, activeHostAction] = await Promise.all([
      this.prisma.backgroundJob.findFirst({
        where: {
          id: { not: jobId },
          jobType: BackgroundJobType.MSAIDIZI_TASK_STEP,
          correlationId: taskId,
          status: BackgroundJobStatus.RUNNING,
        },
        select: { id: true },
      }),
      this.prisma.msaidiziHostAction.findFirst({
        where: {
          taskId,
          stepId,
          status: {
            in: [
              MsaidiziHostActionStatus.QUEUED,
              MsaidiziHostActionStatus.DISPATCHED,
              MsaidiziHostActionStatus.RUNNING,
            ],
          },
        },
        select: { id: true },
      }),
    ]);
    if (otherLiveJob || activeHostAction) return 'ACTIVE_OWNER';

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.msaidiziToolAttempt.findFirst({
        where: { taskId, stepId },
        orderBy: { attemptNumber: 'desc' },
        select: { id: true, status: true, resultSummary: true },
      });
      if (!latest) return 'TERMINAL_ATTEMPT';
      const unsettled =
        latest.status === MsaidiziToolAttemptStatus.REQUESTED ||
        latest.status === MsaidiziToolAttemptStatus.RUNNING;
      if (!unsettled && latest.status !== MsaidiziToolAttemptStatus.UNKNOWN) {
        return 'TERMINAL_ATTEMPT';
      }

      const stepWon = await tx.msaidiziTaskStep.updateMany({
        where: { id: stepId, taskId, status: MsaidiziTaskStepStatus.RUNNING },
        data: {
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      if (stepWon.count !== 1) return 'TERMINAL_ATTEMPT';

      if (unsettled) {
        const reservation = activeAttemptEgressReservation(latest.resultSummary);
        const escaped = latest.status === MsaidiziToolAttemptStatus.RUNNING;
        const attemptWon = await tx.msaidiziToolAttempt.updateMany({
          where: { id: latest.id, status: latest.status },
          data: {
            status: MsaidiziToolAttemptStatus.UNKNOWN,
            uncertainOutcome: true,
            errorCode: 'MUTATION_RETRY_BLOCKED',
            endedAt: new Date(),
            ...(reservation === null
              ? {}
              : {
                  resultSummary: {
                    externalEgress: erpEgressSummary({
                      reservedExternalEgressBytes: reservation,
                      chargedExternalEgressBytes: escaped ? reservation : 0,
                      verified: false,
                      errorCode: escaped
                        ? 'ERP_EGRESS_RECEIPT_MISSING'
                        : 'RELEASED_BEFORE_DISPATCH',
                    }),
                  },
                }),
          },
        });
        if (attemptWon.count !== 1) {
          throw new Error('Mutation retry attempt reconciliation CAS lost');
        }
        if (reservation !== null) {
          const taskAccountingWon = await tx.msaidiziTask.updateMany({
            where: {
              id: taskId,
              reservedExternalEgressBytes: { gte: BigInt(reservation) },
            },
            data: {
              reservedExternalEgressBytes: { decrement: BigInt(reservation) },
              ...(escaped ? { externalEgressBytes: { increment: BigInt(reservation) } } : {}),
              lastCheckpointAt: new Date(),
            },
          });
          if (taskAccountingWon.count !== 1) {
            throw new Error('Mutation retry egress accounting CAS lost');
          }
        }
      }
      await this.setTaskNeedsAttention(tx, taskId, 'MUTATION_RETRY_BLOCKED', true);
      await this.event(tx, taskId, 'step.outcome_unknown', {
        stepId,
        attemptId: latest.id,
        reason: 'MUTATION_RETRY_BLOCKED',
      });
      return 'RECONCILED';
    });
  }

  private async deferReservedAttempt(
    taskId: string,
    stepId: string,
    attemptId: string,
    reason: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.msaidiziToolAttempt.updateMany({
        where: { id: attemptId, status: MsaidiziToolAttemptStatus.REQUESTED },
        data: {
          status: MsaidiziToolAttemptStatus.CANCELLED,
          errorCode: reason,
          endedAt: new Date(),
        },
      });
      await tx.msaidiziTaskStep.updateMany({
        where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
        data: { status: MsaidiziTaskStepStatus.READY },
      });
      await this.event(tx, taskId, 'tool.dispatch_deferred', { stepId, attemptId, reason });
    });
  }

  private async settleRejected(taskId: string, stepId: string, attemptId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      // Rejection can happen on either side of the durable dispatch boundary:
      // policy checks reject a REQUESTED attempt, while an exact-action or
      // live-mandate check can consume the one-shot credential only after the
      // attempt has become RUNNING. Both are confirmed no-effect outcomes and
      // must settle as REJECTED, without undoing the conservative attempted /
      // executed / mutation counters already charged at their boundaries.
      const attemptWon = await tx.msaidiziToolAttempt.updateMany({
        where: {
          id: attemptId,
          taskId,
          stepId,
          status: {
            in: [MsaidiziToolAttemptStatus.REQUESTED, MsaidiziToolAttemptStatus.RUNNING],
          },
        },
        data: {
          status: MsaidiziToolAttemptStatus.REJECTED,
          rejectionReason: reason,
          endedAt: new Date(),
        },
      });
      if (attemptWon.count !== 1) {
        // A terminal attempt (or a mismatched task/step tuple) is
        // authoritative. Losing this CAS aborts the transaction before an
        // event or audit row can be duplicated.
        throw new Error('Rejected tool-attempt settlement CAS lost');
      }
      const stepWon = await tx.msaidiziTaskStep.updateMany({
        where: { id: stepId, taskId, status: MsaidiziTaskStepStatus.RUNNING },
        data: {
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      if (stepWon.count !== 1) {
        throw new Error('Rejected task-step settlement CAS lost');
      }
      await this.setTaskNeedsAttention(tx, taskId, reason);
      await this.event(tx, taskId, 'tool.rejected', { stepId, attemptId, reason });
      await this.auditAttemptResult(tx, taskId, stepId, attemptId, 'REJECTED', { reason });
    });
  }

  /**
   * For classified ERP egress, attempt CAS and task charging share one database
   * transaction. A duplicate settlement either observes the prior terminal row
   * at the handler entrance or loses this CAS and cannot charge twice.
   */
  private async settleAttemptInTransaction(
    tx: Prisma.TransactionClient,
    taskId: string,
    attemptId: string,
    data: Prisma.MsaidiziToolAttemptUpdateManyMutationInput,
    egress?: ErpEgressSettlement,
  ): Promise<void> {
    if (!egress) {
      await tx.msaidiziToolAttempt.update({
        where: { id: attemptId, status: MsaidiziToolAttemptStatus.RUNNING },
        data,
      });
      return;
    }
    const attemptWon = await tx.msaidiziToolAttempt.updateMany({
      where: { id: attemptId, status: MsaidiziToolAttemptStatus.RUNNING },
      data,
    });
    if (attemptWon.count !== 1) throw new Error('ERP egress attempt was already settled');
    const reserved = BigInt(egress.reservedExternalEgressBytes);
    const charged = BigInt(egress.chargedExternalEgressBytes);
    const taskWon = await tx.msaidiziTask.updateMany({
      where: {
        id: taskId,
        reservedExternalEgressBytes: { gte: reserved },
      },
      data: {
        reservedExternalEgressBytes: { decrement: reserved },
        externalEgressBytes: { increment: charged },
        lastCheckpointAt: new Date(),
      },
    });
    if (taskWon.count !== 1) throw new Error('ERP egress task settlement CAS lost');
  }

  private async erpEgressReceiptFailure(
    taskId: string,
    stepId: string,
    attemptId: string,
    status: number,
    egress: ErpEgressSettlement,
  ): Promise<void> {
    const reason = egress.errorCode ?? 'ERP_EGRESS_RECEIPT_UNVERIFIABLE';
    await this.prisma.$transaction(async (tx) => {
      await this.settleAttemptInTransaction(
        tx,
        taskId,
        attemptId,
        {
          status: MsaidiziToolAttemptStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: reason,
          resultSummary: { externalEgress: erpEgressSummary(egress) },
          endedAt: new Date(),
        },
        egress,
      );
      await tx.msaidiziTaskStep.update({
        where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
        data: {
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await this.setTaskNeedsAttention(tx, taskId, reason, true);
      await this.event(tx, taskId, 'step.egress_receipt_unverifiable', {
        stepId,
        attemptId,
        status,
        reason,
        chargedExternalEgressBytes: egress.chargedExternalEgressBytes,
      });
      await this.auditAttemptResult(tx, taskId, stepId, attemptId, 'UNKNOWN', {
        httpStatus: status,
        reason,
        externalEgress: erpEgressSummary(egress),
      });
    });
  }

  private async succeed(
    taskId: string,
    stepId: string,
    attemptId: string,
    status: number,
    bytes: number,
    resultSha256: string,
    entityIdentifiers: Record<string, string>,
    observation?: Prisma.InputJsonObject,
    emptyResult?: boolean,
    egress?: ErpEgressSettlement,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.settleAttemptInTransaction(
        tx,
        taskId,
        attemptId,
        {
          status: MsaidiziToolAttemptStatus.SUCCEEDED,
          resultSummary: {
            ok: true,
            httpStatus: status,
            responseBytes: bytes,
            responseSha256: resultSha256,
            entityIdentifiers,
            ...(emptyResult !== undefined ? { emptyResult } : {}),
            ...(observation ? { observation } : {}),
            ...(egress ? { externalEgress: erpEgressSummary(egress) } : {}),
          },
          endedAt: new Date(),
        },
        egress,
      );
      await tx.msaidiziTaskStep.update({
        where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
        data: {
          status: MsaidiziTaskStepStatus.SUCCEEDED,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await tx.msaidiziTask.update({
        where: { id: taskId },
        data: { lastCheckpointAt: new Date() },
      });
      await this.event(tx, taskId, 'step.succeeded', { stepId, attemptId, status, bytes });
      await this.auditAttemptResult(tx, taskId, stepId, attemptId, 'SUCCEEDED', {
        httpStatus: status,
        responseBytes: bytes,
        responseSha256: resultSha256,
        entityIdentifiers,
        ...(egress ? { externalEgress: erpEgressSummary(egress) } : {}),
      });
    });
  }

  private async unknownOutcome(
    taskId: string,
    stepId: string,
    attemptId: string,
    status: number,
    error?: string,
    egress?: ErpEgressSettlement,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.settleAttemptInTransaction(
        tx,
        taskId,
        attemptId,
        {
          status: MsaidiziToolAttemptStatus.UNKNOWN,
          uncertainOutcome: true,
          errorCode: status ? `HTTP_${status}` : 'TRANSPORT_UNKNOWN',
          errorMessage: error ? redactSensitiveFields(error) : undefined,
          ...(egress ? { resultSummary: { externalEgress: erpEgressSummary(egress) } } : {}),
          endedAt: new Date(),
        },
        egress,
      );
      await tx.msaidiziTaskStep.update({
        where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
        data: {
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await this.setTaskNeedsAttention(tx, taskId, 'UNKNOWN_WRITE_OUTCOME', true);
      await this.event(tx, taskId, 'step.outcome_unknown', { stepId, attemptId, status });
      await this.auditAttemptResult(tx, taskId, stepId, attemptId, 'UNKNOWN', {
        httpStatus: status,
        ...(egress ? { externalEgress: erpEgressSummary(egress) } : {}),
      });
    });
  }

  private async responsePersistenceFailure(
    taskId: string,
    stepId: string,
    attemptId: string,
    mutation: boolean,
    status: number,
    reason: string,
    error?: string,
    egress?: ErpEgressSettlement,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.settleAttemptInTransaction(
        tx,
        taskId,
        attemptId,
        {
          status: mutation ? MsaidiziToolAttemptStatus.UNKNOWN : MsaidiziToolAttemptStatus.FAILED,
          uncertainOutcome: mutation,
          errorCode: reason,
          errorMessage: error ? redactSensitiveFields(error) : undefined,
          ...(egress ? { resultSummary: { externalEgress: erpEgressSummary(egress) } } : {}),
          endedAt: new Date(),
        },
        egress,
      );
      await tx.msaidiziTaskStep.update({
        where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
        data: {
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await this.setTaskNeedsAttention(tx, taskId, reason, mutation);
      await this.event(tx, taskId, 'step.response_persistence_failed', {
        stepId,
        attemptId,
        status,
        reason,
        uncertainOutcome: mutation,
      });
      await this.auditAttemptResult(
        tx,
        taskId,
        stepId,
        attemptId,
        mutation ? 'UNKNOWN' : 'FAILED',
        {
          httpStatus: status,
          reason,
          ...(egress ? { externalEgress: erpEgressSummary(egress) } : {}),
        },
      );
    });
  }

  private async failAttempt(
    taskId: string,
    stepId: string,
    attemptId: string,
    status: number,
    error: string | undefined,
    final: boolean,
    responseBytes: number,
    responseSha256: string,
    egress?: ErpEgressSettlement,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.settleAttemptInTransaction(
        tx,
        taskId,
        attemptId,
        {
          status: MsaidiziToolAttemptStatus.FAILED,
          errorCode: status ? `HTTP_${status}` : 'TRANSPORT_FAILURE',
          errorMessage: error ? redactSensitiveFields(error) : undefined,
          resultSummary: {
            ok: false,
            httpStatus: status,
            responseBytes,
            responseSha256,
            ...(egress ? { externalEgress: erpEgressSummary(egress) } : {}),
          },
          endedAt: new Date(),
        },
        egress,
      );
      if (final) {
        await tx.msaidiziTaskStep.update({
          where: { id: stepId, status: MsaidiziTaskStepStatus.RUNNING },
          data: {
            status: MsaidiziTaskStepStatus.FAILED,
            checkpointedAt: new Date(),
            endedAt: new Date(),
          },
        });
      }
      await tx.msaidiziTask.updateMany({
        where: { id: taskId, status: MsaidiziTaskStatus.RUNNING },
        data: { lastCheckpointAt: new Date() },
      });
      await this.event(tx, taskId, final ? 'step.failed' : 'step.retry_scheduled', {
        stepId,
        attemptId,
        status,
      });
      await this.auditAttemptResult(
        tx,
        taskId,
        stepId,
        attemptId,
        final ? 'FAILED' : 'RETRY_SCHEDULED',
        {
          httpStatus: status,
          ...(egress ? { externalEgress: erpEgressSummary(egress) } : {}),
        },
      );
    });
  }

  private async rejectWithoutDispatch(taskId: string, stepId: string, reason: string) {
    await this.needsAttention(taskId, stepId, reason);
  }

  private async needsAttention(taskId: string, stepId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.msaidiziTaskStep.updateMany({
        where: {
          id: stepId,
          status: {
            in: [
              MsaidiziTaskStepStatus.PENDING,
              MsaidiziTaskStepStatus.READY,
              MsaidiziTaskStepStatus.LEASED,
              MsaidiziTaskStepStatus.RUNNING,
            ],
          },
        },
        data: {
          status: MsaidiziTaskStepStatus.NEEDS_ATTENTION,
          checkpointedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await this.setTaskNeedsAttention(tx, taskId, reason);
      await this.event(tx, taskId, 'step.needs_attention', { stepId, reason });
    });
  }

  private async setTaskNeedsAttention(
    tx: Prisma.TransactionClient,
    taskId: string,
    reason: string,
    includeStopping = false,
  ) {
    const won = await tx.msaidiziTask.updateMany({
      where: {
        id: taskId,
        status: includeStopping
          ? {
              in: [
                MsaidiziTaskStatus.RUNNING,
                MsaidiziTaskStatus.PAUSING,
                MsaidiziTaskStatus.CANCELLING,
              ],
            }
          : MsaidiziTaskStatus.RUNNING,
      },
      data: {
        status: MsaidiziTaskStatus.NEEDS_ATTENTION,
        failureCode: reason,
        statusDetail: reason,
        endedAt: new Date(),
        wallTimeCheckpointAt: null,
        lastCheckpointAt: new Date(),
        stateVersion: { increment: 1 },
      },
    });
    if (won.count === 1) {
      await this.notifications?.notifyMsaidiziTaskTerminal(
        tx,
        taskId,
        MsaidiziTaskStatus.NEEDS_ATTENTION,
      );
    }
  }

  /**
   * Autonomous action evidence is fail-closed even though legacy business
   * auditing remains best-effort. This row is created in the same transaction
   * that settles the tool attempt; if the central ledger is unavailable the
   * attempt cannot be reported as reconciled.
   */
  private async auditAttemptResult(
    tx: Prisma.TransactionClient,
    taskId: string,
    stepId: string,
    attemptId: string,
    outcome: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const task = await tx.msaidiziTask.findUnique({
      where: { id: taskId },
      select: {
        principalId: true,
        initiatedByUserId: true,
        mandateId: true,
        companyId: true,
      },
    });
    if (!task) throw new Error('Msaidizi task disappeared while writing action evidence');
    await this.audit.logStrictInTransaction(tx, {
      action: `MSAIDIZI_ERP_ACTION_${outcome}`,
      entityType: 'MsaidiziToolAttempt',
      entityId: attemptId,
      userId: task.initiatedByUserId,
      companyId: task.companyId,
      scopeKind: task.companyId ? AuditScopeKind.COMPANY : AuditScopeKind.GROUP,
      newValue: redactSensitiveFields({ outcome, ...metadata }) as Prisma.InputJsonObject,
      severity: outcome === 'SUCCEEDED' ? AuditSeverity.LOW : AuditSeverity.HIGH,
      channel: AuditChannel.AGENT,
      agentSessionId: taskSessionId(taskId),
      principalType: MSAIDIZI_SERVICE_PRINCIPAL_TYPE,
      principalId: task.principalId,
      mandateId: task.mandateId,
      initiatedByUserId: task.initiatedByUserId,
      taskId,
      stepId,
    });
  }

  private async event(
    tx: Prisma.TransactionClient,
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type,
        actorType: 'SERVICE',
        payload: redactSensitiveFields(payload) as Prisma.InputJsonObject,
      },
    });
  }
}

function parsePayload(payload: Record<string, unknown>): StepPayload {
  if (
    payload.kind !== 'msaidizi-task-step/v1' ||
    typeof payload.taskId !== 'string' ||
    typeof payload.stepId !== 'string'
  ) {
    throw new Error('Invalid Msaidizi task-step payload');
  }
  const maxAttempts = Number(payload.maxAttempts);
  return {
    kind: 'msaidizi-task-step/v1',
    taskId: payload.taskId,
    stepId: payload.stepId,
    maxAttempts: Number.isSafeInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1,
  };
}

function persistedBigInt(value: unknown, fallback: bigint): bigint {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  throw new Error('Persisted task byte budget is invalid');
}

export function deriveErpEgressSettlement(
  result: InvocationResult,
  binding: ErpEgressInvocationBinding,
  resultSha256: string,
): ErpEgressSettlement {
  const fullCharge = (code: string): ErpEgressSettlement => ({
    reservedExternalEgressBytes: binding.reservedExternalEgressBytes,
    chargedExternalEgressBytes: binding.reservedExternalEgressBytes,
    verified: false,
    errorCode: code,
  });
  if (!Number.isSafeInteger(result.status) || result.status < 100 || result.status > 599) {
    return fullCharge(result.egressReceiptError ?? 'ERP_EGRESS_RECEIPT_MISSING');
  }
  if (result.egressReceiptError) return fullCharge(result.egressReceiptError);
  const verified = verifyErpEgressMeteringReceipt(result.egressReceipt, {
    binding,
    httpStatus: result.status,
    resultSha256,
  });
  if (!verified.ok) return fullCharge(verified.code);
  return {
    reservedExternalEgressBytes: binding.reservedExternalEgressBytes,
    chargedExternalEgressBytes: verified.receipt.chargedExternalEgressBytes,
    verified: true,
    receipt: verified.receipt,
  };
}

function erpEgressSummary(settlement: ErpEgressSettlement): Prisma.InputJsonObject {
  const receipt = settlement.receipt;
  return {
    settlementStatus: 'SETTLED',
    metering: 'adapter-receipt-v1',
    verified: settlement.verified,
    reservedExternalEgressBytes: settlement.reservedExternalEgressBytes,
    chargedExternalEgressBytes: settlement.chargedExternalEgressBytes,
    ...(settlement.errorCode ? { errorCode: settlement.errorCode } : {}),
    ...(receipt
      ? {
          receiptId: receipt.receiptId,
          measurementId: receipt.measurementId,
          destinationSha256: receipt.destinationSha256,
          contextSha256: receipt.contextSha256,
          resultSha256: receipt.resultSha256,
          outcome: receipt.outcome,
          measuredExternalEgressBytes: receipt.measuredExternalEgressBytes,
          uncertainExternalEgressBytes: receipt.uncertainExternalEgressBytes,
        }
      : {}),
  };
}

function activeAttemptEgressReservation(value: Prisma.JsonValue | null): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const egress = (value as Prisma.JsonObject).externalEgress;
  if (!egress || typeof egress !== 'object' || Array.isArray(egress)) return null;
  const summary = egress as Prisma.JsonObject;
  const reservation = summary.reservedExternalEgressBytes;
  return summary.settlementStatus === 'RESERVED' &&
    typeof reservation === 'number' &&
    Number.isSafeInteger(reservation) &&
    reservation >= 0
    ? reservation
    : null;
}

/** Settled charge or active reservation already attributable to this step. */
function resultSummaryExternalEgressBytes(value: Prisma.JsonValue | null): bigint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0n;
  const egress = (value as Prisma.JsonObject).externalEgress;
  if (!egress || typeof egress !== 'object' || Array.isArray(egress)) return 0n;
  const summary = egress as Prisma.JsonObject;
  if (summary.settlementStatus === 'RELEASED_BEFORE_DISPATCH') return 0n;
  const field =
    summary.settlementStatus === 'RESERVED'
      ? summary.reservedExternalEgressBytes
      : summary.settlementStatus === 'SETTLED'
        ? summary.chargedExternalEgressBytes
        : undefined;
  if (typeof field === 'number' && Number.isSafeInteger(field) && field >= 0) {
    return BigInt(field);
  }
  // A malformed persisted accounting record must never widen a step ceiling.
  return BigInt(Number.MAX_SAFE_INTEGER);
}

function stepTraceResult(result: JobResult): FinishMsaidiziSpan {
  const data = result.data ?? {};
  const measurements = {
    httpStatus: finiteNumber(data.status),
    responseBytes: finiteNumber(data.bytes),
    rejected: data.rejected === true ? true : undefined,
    skipped: data.skipped === true ? true : undefined,
    uncertainOutcome: data.uncertainOutcome === true ? true : undefined,
  };
  if (data.uncertainOutcome === true) {
    return { outcome: 'FAILED', outcomeCode: 'OUTCOME_UNKNOWN', measurements };
  }
  if (data.rejected === true) {
    return { outcome: 'WARNING', outcomeCode: 'DISPATCH_REJECTED', measurements };
  }
  if (data.ok === false) {
    return { outcome: 'WARNING', outcomeCode: 'STEP_FAILED', measurements };
  }
  if (data.skipped === true) {
    return { outcome: 'SUCCESS', outcomeCode: 'STEP_SKIPPED', measurements };
  }
  return { outcome: 'SUCCESS', outcomeCode: 'STEP_ACCEPTED', measurements };
}

function hasInputBindings(value: Prisma.JsonValue | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stepBudgetPolicyError(
  task: {
    maxWallTimeSeconds?: number;
    maxModelTurns?: number;
    maxAttemptedToolCalls?: number;
    maxMutations?: number;
    maxLocalBytes?: bigint;
    maxExternalEgressBytes?: bigint;
    maxModelCostUsd?: Prisma.Decimal;
  },
  step: {
    budgets?: Prisma.JsonValue;
    stopConditions?: Prisma.JsonValue;
    attemptCount: number;
    mutation: boolean;
    startedAt?: Date | null;
    bytesRead?: bigint;
    bytesWritten?: bigint;
    localIoAccountingValid?: boolean;
  },
): string | null {
  const raw = step.budgets ?? {};
  const parsed = parseStepBudgets(raw);
  if (!parsed.ok) return parsed.code;
  const stopConditions = validateStepStopConditions(step.stopConditions ?? {});
  if (!stopConditions.ok) return stopConditions.code;
  const numericCeilings: Array<[keyof typeof parsed.limits, number | undefined]> = [
    ['maxWallTimeSeconds', task.maxWallTimeSeconds],
    ['maxModelTurns', task.maxModelTurns],
    ['maxAttemptedToolCalls', task.maxAttemptedToolCalls],
    ['maxMutations', task.maxMutations],
    ['maxLocalBytes', task.maxLocalBytes === undefined ? undefined : Number(task.maxLocalBytes)],
    [
      'maxExternalEgressBytes',
      task.maxExternalEgressBytes === undefined ? undefined : Number(task.maxExternalEgressBytes),
    ],
    [
      'maxModelCostUsd',
      task.maxModelCostUsd === undefined ? undefined : task.maxModelCostUsd.toNumber(),
    ],
  ];
  if (
    numericCeilings.some(
      ([key, taskLimit]) =>
        parsed.limits[key] !== undefined &&
        taskLimit !== undefined &&
        parsed.limits[key]! > taskLimit,
    )
  ) {
    return 'STEP_BUDGET_EXCEEDS_TASK_CEILING';
  }
  return stepDispatchBudgetExhaustion({
    budgets: raw,
    attemptCount: step.attemptCount,
    mutation: step.mutation,
    startedAt: step.startedAt ?? null,
    bytesRead: step.bytesRead,
    bytesWritten: step.bytesWritten,
    localIoAccountingValid: step.localIoAccountingValid,
  });
}

function emptyToolResult(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) return true;
  for (const key of ['data', 'items', 'results', 'rows', 'records']) {
    if (Array.isArray(record[key])) return record[key].length === 0;
  }
  return (
    (record.total === 0 || record.count === 0 || record.totalCount === 0) &&
    !Object.keys(record).some((key) => /(?:^id$|Id$|_id$)/.test(key))
  );
}

function principalHasCapability(
  grants: unknown,
  required: string[],
  requiredAny: string[],
): boolean {
  const permissions = Array.isArray(grants)
    ? grants.filter((item): item is string => typeof item === 'string')
    : grants && typeof grants === 'object' && !Array.isArray(grants)
      ? Array.isArray((grants as Prisma.JsonObject).permissions)
        ? ((grants as Prisma.JsonObject).permissions as Prisma.JsonArray).filter(
            (item): item is string => typeof item === 'string',
          )
        : []
      : [];
  if (permissions.includes('*')) return true;
  const set = new Set(permissions);
  return (
    required.every((permission) => set.has(permission)) &&
    (requiredAny.length === 0 || requiredAny.some((permission) => set.has(permission)))
  );
}

function mandateAllowsErpStep(
  mandate: {
    status: string;
    startsAt: Date | null;
    expiresAt: Date | null;
    capabilities: Prisma.JsonValue;
  } | null,
  step: {
    capability: string;
    capabilityVersion: string;
    expectedEffect: MsaidiziEffect;
    dataClass: string;
  },
): boolean {
  const now = Date.now();
  if (
    !mandate ||
    mandate.status !== 'ACTIVE' ||
    (mandate.startsAt && mandate.startsAt.getTime() > now) ||
    (mandate.expiresAt && mandate.expiresAt.getTime() <= now) ||
    !Array.isArray(mandate.capabilities)
  ) {
    return false;
  }
  return mandate.capabilities.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const grant = entry as Prisma.JsonObject;
    const effects = jsonStrings(grant.effects);
    const dataClasses = jsonStrings(grant.dataClasses);
    return (
      grant.capability === step.capability &&
      (grant.version === undefined || grant.version === step.capabilityVersion) &&
      effects.includes(step.expectedEffect) &&
      (dataClasses.includes('*') || dataClasses.includes(step.dataClass))
    );
  });
}

function taskFitsMandateBudget(
  task: {
    maxWallTimeSeconds: number;
    maxModelTurns: number;
    maxAttemptedToolCalls: number;
    maxMutations: number;
    maxLocalBytes: bigint;
    maxExternalEgressBytes: bigint;
    maxModelCostUsd: Prisma.Decimal;
  },
  rawBudget: Prisma.JsonValue | null | undefined,
): boolean {
  if (!rawBudget || typeof rawBudget !== 'object' || Array.isArray(rawBudget)) return false;
  const budget = rawBudget as Prisma.JsonObject;
  const values: Array<[string, number]> = [
    ['maxWallTimeSeconds', task.maxWallTimeSeconds],
    ['maxModelTurns', task.maxModelTurns],
    ['maxAttemptedToolCalls', task.maxAttemptedToolCalls],
    ['maxMutations', task.maxMutations],
    ['maxLocalBytes', Number(task.maxLocalBytes)],
    ['maxExternalEgressBytes', Number(task.maxExternalEgressBytes)],
    ['maxModelCostUsd', task.maxModelCostUsd.toNumber()],
  ];
  return values.every(([key, taskLimit]) => {
    const mandateLimit = budget[key];
    return (
      mandateLimit === undefined ||
      (typeof mandateLimit === 'number' &&
        Number.isFinite(mandateLimit) &&
        mandateLimit >= 0 &&
        taskLimit <= mandateLimit)
    );
  });
}

function jsonStrings(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function taskSessionId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '')}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Bounded identifiers from successful responses; never persist the response body itself. */
function extractEntityIdentifiers(value: unknown): Record<string, string> {
  const identifiers: Record<string, string> = {};
  const visit = (current: unknown, path: string, depth: number): void => {
    if (depth > 4 || Object.keys(identifiers).length >= 50 || current == null) return;
    if (Array.isArray(current)) {
      current.slice(0, 50).forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1));
      return;
    }
    if (typeof current !== 'object') return;
    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      if (Object.keys(identifiers).length >= 50) break;
      const nextPath = path ? `${path}.${key}` : key;
      if (/(?:^id$|Id$|_id$)/.test(key) && (typeof item === 'string' || typeof item === 'number')) {
        identifiers[nextPath] = String(item).slice(0, 160);
      } else {
        visit(item, nextPath, depth + 1);
      }
    }
  };
  visit(value, '', 0);
  return identifiers;
}
