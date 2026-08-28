import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuditChannel,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import {
  redactPersistedSecrets,
  sanitizePersistedValue,
} from '../../common/utils/persistent-secret-redaction';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  nextCronOccurrence,
  UnsupportedMsaidiziCronError,
} from '../msaidizi-control-plane/msaidizi-cron';
import {
  assertTemplateWithinMandate,
  MsaidiziScheduleTemplateError,
  ValidatedScheduleTaskTemplate,
  validateScheduleTaskTemplate,
} from '../msaidizi-control-plane/msaidizi-schedule-template';
import { msaidiziScheduleVersionSnapshot } from '../msaidizi-control-plane/msaidizi-version-history';
import { AutonomyBudgetCeilings, AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { persistableUpdateProposalStepArguments } from '../msaidizi-updates/update-candidate-proposal.port';
import { parseStepBudgets, validateStepStopConditions } from './msaidizi-step-controls';

const DEFAULT_BATCH = 20;

const DUE_SCHEDULE_INCLUDE = {
  principal: { select: { status: true } },
  mandate: true,
} satisfies Prisma.MsaidiziScheduleInclude;

type DueSchedule = Prisma.MsaidiziScheduleGetPayload<{ include: typeof DUE_SCHEDULE_INCLUDE }>;

const OVERLAPPING_TASK_STATUSES = [
  MsaidiziTaskStatus.PLANNING,
  MsaidiziTaskStatus.READY,
  MsaidiziTaskStatus.QUEUED,
  MsaidiziTaskStatus.RUNNING,
  MsaidiziTaskStatus.PAUSING,
  MsaidiziTaskStatus.PAUSED,
  MsaidiziTaskStatus.CANCELLING,
  MsaidiziTaskStatus.NEEDS_ATTENTION,
] as const;

type ResolvedBudget = AutonomyBudgetCeilings;

export interface ScheduleDispatchSummary {
  inspected: number;
  dispatched: number;
  skipped: number;
  blocked: number;
  failed: number;
}

/**
 * Claims one durable cron occurrence and creates its immutable task, plan,
 * steps, task events, audit evidence, and next schedule cursor in one database
 * transaction. The exact `(schedule, occurrence)` idempotency key is a second
 * line of defence behind the nextRunAt CAS, so restarts and ambiguous client
 * outcomes cannot create a second mutation-bearing task.
 */
@Injectable()
export class MsaidiziScheduleDispatcherService {
  private readonly logger = new Logger(MsaidiziScheduleDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly autonomy: AutonomyConfig,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async dispatchDueSchedules(
    batch = DEFAULT_BATCH,
    now = new Date(),
  ): Promise<ScheduleDispatchSummary> {
    const summary: ScheduleDispatchSummary = {
      inspected: 0,
      dispatched: 0,
      skipped: 0,
      blocked: 0,
      failed: 0,
    };
    if (!this.enabled()) return summary;

    const schedules = await this.prisma.msaidiziSchedule.findMany({
      where: {
        status: MsaidiziScheduleStatus.ACTIVE,
        nextRunAt: { not: null, lte: now },
      },
      include: DUE_SCHEDULE_INCLUDE,
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
      take: Math.max(1, Math.min(batch, 100)),
    });
    summary.inspected = schedules.length;

    for (const schedule of schedules) {
      try {
        const outcome = await this.dispatchOccurrence(schedule, now);
        if (outcome === 'dispatched') summary.dispatched += 1;
        if (outcome === 'skipped') summary.skipped += 1;
      } catch (error) {
        if (isPolicyFailure(error)) {
          if (await this.blockSchedule(schedule, policyFailureCode(error), error.message)) {
            summary.blocked += 1;
          }
          continue;
        }
        // A transient/unknown database failure deliberately leaves nextRunAt
        // untouched. A later worker retries the same occurrence and the CAS +
        // unique task key determine whether the prior transaction committed.
        summary.failed += 1;
        this.logger.error(
          `Routine ${schedule.id} occurrence ${schedule.nextRunAt?.toISOString()} was not acknowledged: ${safeError(error)}`,
        );
      }
    }
    return summary;
  }

  private async dispatchOccurrence(
    schedule: DueSchedule,
    now: Date,
  ): Promise<'dispatched' | 'skipped'> {
    const dueAt = schedule.nextRunAt;
    if (!dueAt)
      throw new ScheduleDispatchPolicyError('SCHEDULE_CURSOR_MISSING', 'nextRunAt is missing');
    this.assertAuthority(schedule, now);

    const template = validateScheduleTaskTemplate(schedule.taskTemplate);
    assertTemplateWithinMandate(template, schedule.mandate.capabilities);
    const budget = this.resolveBudget(template, schedule.mandate.budgets);
    this.assertPlanFitsBudget(template, budget);
    const nextRunAt = nextCronOccurrence(schedule.cronExpression, schedule.timezone, dueAt);

    const taskId = randomUUID();
    const planVersionId = randomUUID();
    const queuedAt = new Date();
    const createdAt = queuedAt;
    const idempotencyKey = occurrenceKey(schedule.id, dueAt);
    const objective = redactPersistedSecrets(template.objective);
    const title = redactPersistedSecrets(template.title);
    const summary = redactPersistedSecrets(template.summary);
    const inputs = persistedJson(template.inputs);
    const stopConditions = persistedJson(template.stopConditions);
    const budgetSnapshot = this.budgetSnapshot(budget);
    const steps = template.steps.map(
      (step, index): Prisma.MsaidiziTaskStepCreateManyInput => ({
        id: randomUUID(),
        taskId,
        planVersionId,
        createdAt,
        stepKey: step.key,
        sequence: index + 1,
        name: redactPersistedSecrets(step.name.trim()),
        target: step.target,
        capability: step.capability,
        capabilityVersion: step.capabilityVersion,
        arguments: persistableUpdateProposalStepArguments(step) as Prisma.InputJsonValue,
        dependencies: persistedJson(step.dependsOn),
        expectedEffect: step.expectedEffect,
        dataClass: step.dataClass,
        preconditions: persistedJson(step.preconditions),
        recovery: step.recovery ? persistedJson(step.recovery) : Prisma.JsonNull,
        budgets: persistedJson(step.budgets),
        stopConditions: persistedJson(step.stopConditions),
        idempotent: step.idempotent,
        mutation: step.mutation,
      }),
    );
    const planDigest = digest({ objective, inputs, stopConditions, budgetSnapshot, steps });

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.msaidiziSchedule.updateMany({
        where: {
          id: schedule.id,
          principalId: schedule.principalId,
          mandateId: schedule.mandateId,
          status: MsaidiziScheduleStatus.ACTIVE,
          nextRunAt: dueAt,
        },
        data: { lastRunAt: dueAt, nextRunAt },
      });
      if (claimed.count !== 1) return 'skipped';

      if (schedule.concurrencyMode === 'SKIP') {
        const overlapping = await tx.msaidiziTask.findFirst({
          where: {
            scheduleId: schedule.id,
            status: { in: [...OVERLAPPING_TASK_STATUSES] },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, status: true },
        });
        if (overlapping) {
          await this.event(
            tx,
            overlapping.id,
            'schedule.occurrence_skipped',
            schedule.principalId,
            {
              scheduleId: schedule.id,
              occurrenceAt: dueAt.toISOString(),
              reason: 'PRIOR_TASK_NOT_SETTLED',
              priorTaskStatus: overlapping.status,
              nextRunAt: nextRunAt.toISOString(),
            },
          );
          await this.audit(tx, {
            action: 'MSAIDIZI_SCHEDULE_OCCURRENCE_SKIPPED',
            schedule,
            taskId: overlapping.id,
            channel: AuditChannel.AGENT,
            values: {
              occurrenceAt: dueAt.toISOString(),
              nextRunAt: nextRunAt.toISOString(),
              reason: 'PRIOR_TASK_NOT_SETTLED',
              priorTaskId: overlapping.id,
              priorTaskStatus: overlapping.status,
            },
          });
          return 'skipped';
        }
      }

      const recovered = await tx.msaidiziTask.findUnique({
        where: { idempotencyKey },
        select: { id: true, scheduleId: true, status: true, stateVersion: true },
      });
      if (recovered) {
        if (recovered.scheduleId !== schedule.id) {
          throw new Error('schedule occurrence idempotency key collision');
        }
        if (recovered.status === MsaidiziTaskStatus.READY) {
          const queued = await tx.msaidiziTask.updateMany({
            where: {
              id: recovered.id,
              status: MsaidiziTaskStatus.READY,
              stateVersion: recovered.stateVersion,
            },
            data: {
              status: MsaidiziTaskStatus.QUEUED,
              queuedAt,
              stateVersion: { increment: 1 },
            },
          });
          if (queued.count === 1) {
            await this.event(tx, recovered.id, 'task.queued', schedule.principalId, {
              scheduleId: schedule.id,
              occurrenceAt: dueAt.toISOString(),
              recovered: true,
            });
          }
        }
        await this.audit(tx, {
          action: 'MSAIDIZI_SCHEDULE_DISPATCH_RECONCILED',
          schedule,
          taskId: recovered.id,
          channel: AuditChannel.AGENT,
          values: {
            occurrenceAt: dueAt.toISOString(),
            nextRunAt: nextRunAt.toISOString(),
            taskId: recovered.id,
            taskStatus: recovered.status,
          },
        });
        return 'dispatched';
      }

      // Deployment configuration, never the task template, is the service
      // principal permission ceiling. Reconcile it before this task exists so
      // revoked grants take effect for the very next scheduled step.
      const principalUpdated = await tx.msaidiziPrincipal.updateMany({
        where: { id: schedule.principalId, status: MsaidiziPrincipalStatus.ACTIVE },
        data: {
          grants: {
            scope: 'GROUP',
            authoritySource: 'deployment-policy',
            permissions: this.autonomy.principalGrants,
          },
        },
      });
      if (principalUpdated.count !== 1) {
        throw new ScheduleDispatchPolicyError(
          'PRINCIPAL_DISABLED',
          'the global Msaidizi principal is disabled',
        );
      }

      await tx.msaidiziTask.create({
        data: {
          id: taskId,
          principalId: schedule.principalId,
          initiatedByUserId: schedule.createdByUserId,
          companyId: schedule.mandate.companyId,
          mandateId: schedule.mandateId,
          scheduleId: schedule.id,
          idempotencyKey,
          mode: MsaidiziTaskMode.AUTOPILOT,
          title,
          objective,
          createdAt,
          status: MsaidiziTaskStatus.QUEUED,
          activePlanVersion: 1,
          hostExecutionAllowed: this.autonomy.hostExecutionEnabled,
          queuedAt,
          consumedWallTimeMs: 0n,
          wallTimeCheckpointAt: null,
          ...budget,
        },
      });
      await tx.msaidiziPlanVersion.create({
        data: {
          id: planVersionId,
          taskId,
          version: 1,
          createdByUserId: schedule.createdByUserId,
          summary,
          objective,
          inputs,
          stopConditions,
          budgetSnapshot,
          planDigest,
        },
      });
      await tx.msaidiziTaskStep.createMany({ data: steps });
      await tx.msaidiziTaskEvent.createMany({
        data: [
          eventRow(taskId, 'task.created', schedule.principalId, {
            status: MsaidiziTaskStatus.PLANNING,
            mode: MsaidiziTaskMode.AUTOPILOT,
            scheduleId: schedule.id,
            occurrenceAt: dueAt.toISOString(),
          }),
          eventRow(taskId, 'task.ready', schedule.principalId, {
            from: MsaidiziTaskStatus.PLANNING,
            to: MsaidiziTaskStatus.READY,
            planVersion: 1,
            planDigest,
          }),
          eventRow(taskId, 'task.queued', schedule.principalId, {
            from: MsaidiziTaskStatus.READY,
            to: MsaidiziTaskStatus.QUEUED,
            scheduleId: schedule.id,
            occurrenceAt: dueAt.toISOString(),
            nextRunAt: nextRunAt.toISOString(),
          }),
        ],
      });
      await this.audit(tx, {
        action: 'MSAIDIZI_SCHEDULE_DISPATCH',
        schedule,
        taskId,
        channel: AuditChannel.AGENT,
        values: {
          occurrenceAt: dueAt.toISOString(),
          nextRunAt: nextRunAt.toISOString(),
          taskId,
          taskStatus: MsaidiziTaskStatus.QUEUED,
          planDigest,
        },
      });
      return 'dispatched';
    });
  }

  private assertAuthority(schedule: DueSchedule, now: Date): void {
    if (schedule.principal.status !== MsaidiziPrincipalStatus.ACTIVE) {
      throw new ScheduleDispatchPolicyError(
        'PRINCIPAL_DISABLED',
        'the global Msaidizi principal is disabled',
      );
    }
    if (
      schedule.mandate.status !== MsaidiziMandateStatus.ACTIVE ||
      (schedule.mandate.startsAt && schedule.mandate.startsAt > now) ||
      (schedule.mandate.expiresAt && schedule.mandate.expiresAt <= now)
    ) {
      throw new ScheduleDispatchPolicyError(
        'MANDATE_INACTIVE',
        'the schedule mandate is not active for this occurrence',
      );
    }
    if (schedule.mandate.principalId !== schedule.principalId) {
      throw new ScheduleDispatchPolicyError(
        'MANDATE_PRINCIPAL_MISMATCH',
        'the schedule mandate belongs to a different principal',
      );
    }
    if (!schedule.createdByUserId) {
      throw new ScheduleDispatchPolicyError(
        'INITIATOR_MISSING',
        'the schedule no longer has a human attribution anchor',
      );
    }
    if (!['SKIP', 'QUEUE'].includes(schedule.concurrencyMode)) {
      throw new ScheduleDispatchPolicyError(
        'CONCURRENCY_MODE_INVALID',
        'the schedule concurrency mode is invalid',
      );
    }
  }

  private resolveBudget(
    template: ValidatedScheduleTaskTemplate,
    rawMandateBudget: Prisma.JsonValue,
  ): ResolvedBudget {
    const ceiling = this.autonomy.budgetCeilings;
    const mandate = isRecord(rawMandateBudget) ? rawMandateBudget : {};
    const requested = template.budgets ?? {};
    return {
      maxWallTimeSeconds: minimumNumber(
        ceiling.maxWallTimeSeconds,
        requested.maxWallTimeSeconds,
        budgetNumber(mandate, 'maxWallTimeSeconds', 1, true),
      ),
      maxModelTurns: minimumNumber(
        ceiling.maxModelTurns,
        requested.maxModelTurns,
        budgetNumber(mandate, 'maxModelTurns', 1, true),
      ),
      maxAttemptedToolCalls: minimumNumber(
        ceiling.maxAttemptedToolCalls,
        requested.maxAttemptedToolCalls,
        budgetNumber(mandate, 'maxAttemptedToolCalls', 1, true),
      ),
      maxMutations: minimumNumber(
        ceiling.maxMutations,
        requested.maxMutations,
        budgetNumber(mandate, 'maxMutations', 0, true),
      ),
      maxLocalBytes: BigInt(
        minimumNumber(
          Number(ceiling.maxLocalBytes),
          requested.maxLocalBytes,
          budgetNumber(mandate, 'maxLocalBytes', 1, true),
        ),
      ),
      maxExternalEgressBytes: BigInt(
        minimumNumber(
          Number(ceiling.maxExternalEgressBytes),
          requested.maxExternalEgressBytes,
          budgetNumber(mandate, 'maxExternalEgressBytes', 0, true),
        ),
      ),
      maxModelCostUsd: minimumNumber(
        ceiling.maxModelCostUsd,
        requested.maxModelCostUsd,
        budgetNumber(mandate, 'maxModelCostUsd', 0, false),
      ),
    };
  }

  private assertPlanFitsBudget(
    template: ValidatedScheduleTaskTemplate,
    budget: ResolvedBudget,
  ): void {
    const mutations = template.steps.filter((step) => step.mutation).length;
    if (mutations > budget.maxMutations) {
      throw new ScheduleDispatchPolicyError(
        'PLAN_EXCEEDS_MUTATION_BUDGET',
        'the task template contains more mutation steps than the mandate permits',
      );
    }
    if (template.steps.length > budget.maxAttemptedToolCalls) {
      throw new ScheduleDispatchPolicyError(
        'PLAN_EXCEEDS_TOOL_BUDGET',
        'the task template contains more steps than the mandate tool-attempt budget permits',
      );
    }
    for (const step of template.steps) {
      const stopConditions = validateStepStopConditions(step.stopConditions as Prisma.JsonValue);
      if (!stopConditions.ok) {
        throw new ScheduleDispatchPolicyError(
          stopConditions.code,
          `task template step ${step.key} has invalid stop conditions: ${stopConditions.detail}`,
        );
      }
      const parsed = parseStepBudgets(step.budgets as Prisma.JsonValue);
      if (!parsed.ok) {
        throw new ScheduleDispatchPolicyError(
          parsed.code,
          `task template step ${step.key} has an invalid budget: ${parsed.detail}`,
        );
      }
      const comparisons: Array<[keyof typeof parsed.limits, number]> = [
        ['maxWallTimeSeconds', budget.maxWallTimeSeconds],
        ['maxModelTurns', budget.maxModelTurns],
        ['maxAttemptedToolCalls', budget.maxAttemptedToolCalls],
        ['maxMutations', budget.maxMutations],
        ['maxLocalBytes', Number(budget.maxLocalBytes)],
        ['maxExternalEgressBytes', Number(budget.maxExternalEgressBytes)],
        ['maxModelCostUsd', budget.maxModelCostUsd],
      ];
      if (comparisons.some(([key, ceiling]) => (parsed.limits[key] ?? 0) > ceiling)) {
        throw new ScheduleDispatchPolicyError(
          'STEP_BUDGET_EXCEEDS_TASK_CEILING',
          `task template step ${step.key} budget exceeds its immutable task ceiling`,
        );
      }
    }
  }

  private budgetSnapshot(budget: ResolvedBudget): Prisma.InputJsonObject {
    return {
      maxWallTimeSeconds: budget.maxWallTimeSeconds,
      maxModelTurns: budget.maxModelTurns,
      maxAttemptedToolCalls: budget.maxAttemptedToolCalls,
      maxMutations: budget.maxMutations,
      maxLocalBytes: budget.maxLocalBytes.toString(),
      maxExternalEgressBytes: budget.maxExternalEgressBytes.toString(),
      maxModelCostUsd: budget.maxModelCostUsd,
    };
  }

  private async blockSchedule(
    schedule: DueSchedule,
    code: string,
    detail: string,
  ): Promise<boolean> {
    const dueAt = schedule.nextRunAt;
    if (!dueAt) return false;
    const blocked = await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziSchedule.updateMany({
        where: {
          id: schedule.id,
          status: MsaidiziScheduleStatus.ACTIVE,
          version: schedule.version,
          nextRunAt: dueAt,
          updatedAt: schedule.updatedAt,
        },
        data: {
          status: MsaidiziScheduleStatus.PAUSED,
          version: { increment: 1 },
        },
      });
      if (won.count !== 1) return false;
      const current = await tx.msaidiziSchedule.findUnique({
        where: { id: schedule.id },
        include: DUE_SCHEDULE_INCLUDE,
      });
      if (!current) throw new Error('Paused Msaidizi schedule disappeared during transaction');
      await tx.msaidiziScheduleVersion.create({
        data: msaidiziScheduleVersionSnapshot(current, 'MSAIDIZI_SCHEDULE_DISPATCH_BLOCKED', null),
      });
      await this.audit(tx, {
        action: 'MSAIDIZI_SCHEDULE_DISPATCH_BLOCKED',
        schedule,
        channel: AuditChannel.SYSTEM,
        values: {
          occurrenceAt: dueAt.toISOString(),
          status: MsaidiziScheduleStatus.PAUSED,
          reason: code,
          detail: detail.slice(0, 1_000),
        },
      });
      return true;
    });
    if (blocked) {
      this.logger.warn(`Paused routine ${schedule.id}: ${code} (${detail})`);
    }
    return blocked;
  }

  private async event(
    tx: Prisma.TransactionClient,
    taskId: string,
    type: string,
    principalId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.msaidiziTaskEvent.create({
      data: eventRow(taskId, type, principalId, payload),
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    input: {
      action: string;
      schedule: DueSchedule;
      taskId?: string;
      channel: AuditChannel;
      values: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.auditLogs.logStrictInTransaction(tx, {
      action: input.action,
      entityType: 'MsaidiziSchedule',
      entityId: input.schedule.id,
      userId: input.schedule.createdByUserId ?? undefined,
      companyId: input.schedule.mandate.companyId,
      newValue: input.values,
      channel: input.channel,
      agentSessionId:
        input.channel === AuditChannel.AGENT && input.taskId
          ? taskSessionId(input.taskId)
          : undefined,
      principalType: 'MSAIDIZI',
      principalId: input.schedule.principalId,
      mandateId: input.schedule.mandateId,
      initiatedByUserId: input.schedule.createdByUserId ?? undefined,
      taskId: input.taskId,
    });
  }

  private enabled(): boolean {
    return (
      this.autonomy.enabled &&
      this.autonomy.autopilotEnabled &&
      truthy(this.config.get<string>('MSAIDIZI_TASK_WORKER_ENABLED', 'false')) &&
      truthy(this.config.get<string>('JOB_WORKER_ENABLED', 'false')) &&
      !truthy(this.config.get<string>('MSAIDIZI_GLOBAL_KILL_SWITCH', 'false'))
    );
  }
}

class ScheduleDispatchPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ScheduleDispatchPolicyError';
  }
}

function isPolicyFailure(
  error: unknown,
): error is
  | ScheduleDispatchPolicyError
  | MsaidiziScheduleTemplateError
  | UnsupportedMsaidiziCronError {
  return (
    error instanceof ScheduleDispatchPolicyError ||
    error instanceof MsaidiziScheduleTemplateError ||
    error instanceof UnsupportedMsaidiziCronError
  );
}

function policyFailureCode(
  error: ScheduleDispatchPolicyError | MsaidiziScheduleTemplateError | UnsupportedMsaidiziCronError,
): string {
  return error instanceof UnsupportedMsaidiziCronError ? 'CRON_UNSUPPORTED' : error.code;
}

function eventRow(
  taskId: string,
  type: string,
  principalId: string,
  payload: Record<string, unknown>,
): Prisma.MsaidiziTaskEventCreateManyInput {
  return {
    taskId,
    type,
    actorType: 'SERVICE',
    actorId: principalId,
    payload: persistedJson(payload),
  };
}

function persistedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(sanitizePersistedValue(value).value)) as Prisma.InputJsonValue;
}

function occurrenceKey(scheduleId: string, dueAt: Date): string {
  return `msaidizi-schedule:${scheduleId}:${dueAt.getTime()}`;
}

function taskSessionId(taskId: string): string {
  return `task_${taskId.replace(/-/g, '')}`;
}

function minimumNumber(ceiling: number, ...values: Array<number | undefined>): number {
  return Math.min(ceiling, ...values.filter((value): value is number => value !== undefined));
}

function budgetNumber(
  budget: Prisma.JsonObject,
  key: string,
  minimum: number,
  integer: boolean,
): number | undefined {
  const value = budget[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new ScheduleDispatchPolicyError(
      'MANDATE_BUDGET_INVALID',
      `the persisted mandate budget ${key} is invalid`,
    );
  }
  return value;
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function truthy(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? redactPersistedSecrets(error.message).slice(0, 1_000)
    : 'unknown error';
}
