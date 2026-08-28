import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AccessLevel,
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziHostActionStatus,
  MsaidiziMandateStatus,
  MsaidiziPrincipalStatus,
  MsaidiziScheduleStatus,
  MsaidiziTaskMode,
  MsaidiziTaskStatus,
  MsaidiziTaskStepStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { capabilityEffect } from '../../common/capabilities/capability-manifest';
import {
  assertCanAccessCompanyFromUser,
  companyWhereForUser,
  isGroupScopedUser,
} from '../../common/services/company-scope.service';
import {
  redactPersistedSecrets,
  sanitizePersistedValue,
} from '../../common/utils/persistent-secret-redaction';
import { normaliseHttpActionEnvelope } from '../../common/utils/action-envelope';
import {
  grantAllowsExternalDestinationAuthority,
  requestedExternalDestinationAuthority,
} from '../../common/policies/external-destination-authority';
import { PrismaService } from '../../prisma/prisma.service';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { CrudCoverageService } from '../msaidizi/crud-coverage.service';
import { buildRegistry } from '../msaidizi/tool-registry';
import { planningArgumentsSchema } from '../msaidizi/planning-capability-schema';
import {
  capabilityDataClass,
  capabilityEffect as hostCapabilityEffect,
  findCapability,
} from '../msaidizi-devices/device-security';
import {
  ConsumableProposalUsage,
  MsaidiziProposalUsageService,
} from '../msaidizi-reasoning/msaidizi-proposal-usage.service';
import type { MsaidiziDraftProposalAuthority } from '../msaidizi-reasoning/msaidizi-proposal-lease';
import {
  assertUpdateCandidateProposalStep,
  updateProposalStepContainsPersistedSecret,
  mandateAuthorizesUpdateCandidateProposal,
  persistableUpdateProposalStepArguments,
  UpdateCandidateProposalPolicyError,
} from '../msaidizi-updates/update-candidate-proposal.port';
import { AutonomyBudgetCeilings, AutonomyConfig } from './autonomy.config';
import {
  CreateMsaidiziTaskDraftDto,
  MsaidiziPlanStepDto,
  MsaidiziTaskBudgetDto,
  PlanMsaidiziTaskDto,
  QueryMsaidiziTaskDto,
  QueryMsaidiziTaskEventsDto,
  ReplanMsaidiziTaskDto,
} from './dto/msaidizi-task.dto';
import {
  parseStepBudgets,
  validateStepStopConditions,
} from '../msaidizi-task-runtime/msaidizi-step-controls';
import { assertPlanInputBindings, MsaidiziInputBindingError } from './msaidizi-input-bindings';
import {
  bindingAuthorityIssues,
  bindingSafeDlpProjection,
  restoreBoundNullPlaceholders,
} from './msaidizi-binding-authority';
import { validateBoundCapabilityArguments } from './msaidizi-bound-capability-schema';
import { msaidiziProposalDigest } from './msaidizi-proposal-digest';

const TASK_DETAIL_INCLUDE = {
  principal: { select: { status: true } },
  mandate: {
    select: {
      id: true,
      principalId: true,
      createdByUserId: true,
      name: true,
      status: true,
      capabilities: true,
      budgets: true,
      startsAt: true,
      expiresAt: true,
    },
  },
  schedule: {
    select: { id: true, name: true, status: true, nextRunAt: true },
  },
  planVersions: {
    orderBy: { version: 'asc' as const },
    include: { steps: { orderBy: { sequence: 'asc' as const } } },
  },
  toolAttempts: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      stepId: true,
      attemptNumber: true,
      toolName: true,
      status: true,
      rejectionReason: true,
      resultSummary: true,
      errorCode: true,
      errorMessage: true,
      uncertainOutcome: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
    },
  },
  artifacts: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      stepId: true,
      kind: true,
      name: true,
      mimeType: true,
      sha256: true,
      byteSize: true,
      encrypted: true,
      dataClass: true,
      trustLevel: true,
      provenance: true,
      createdAt: true,
    },
  },
  deviceLeases: {
    orderBy: { acquiredAt: 'asc' as const },
    select: {
      id: true,
      stepId: true,
      deviceId: true,
      status: true,
      fencingToken: true,
      acquiredAt: true,
      heartbeatAt: true,
      expiresAt: true,
      releasedAt: true,
      device: { select: { name: true, status: true, lastSeenAt: true } },
    },
  },
  hostActions: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      stepId: true,
      deviceId: true,
      actionId: true,
      capability: true,
      capabilityVersion: true,
      argsDigest: true,
      idempotencyKey: true,
      dataClass: true,
      effect: true,
      consent: true,
      recovery: true,
      status: true,
      uncertainOutcome: true,
      journalPrepareSequence: true,
      journalPreparePreviousHash: true,
      journalPrepareHash: true,
      journalSequence: true,
      journalPreviousHash: true,
      journalHash: true,
      resultSummary: true,
      errorCode: true,
      queuedAt: true,
      dispatchedAt: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.MsaidiziTaskInclude;

type TaskDetail = Prisma.MsaidiziTaskGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>;
type DatabaseClient = PrismaService | Prisma.TransactionClient;

type ResolvedBudget = AutonomyBudgetCeilings;

const LOCAL_STT_CAPABILITY = 'speech.audio.transcribe';
const PRIVILEGED_COMMAND_CAPABILITY = 'command.privileged.execute';
const ONE_SHOT_CONSENT_CAPABILITIES = new Set([
  LOCAL_STT_CAPABILITY,
  PRIVILEGED_COMMAND_CAPABILITY,
]);
const ONE_SHOT_CONSENT_PROTOCOL = 'msaidizi-one-shot-step-consent/v1';
const RAW_MICROPHONE_CAPABILITY = 'audio.microphone.capture';

const REPLANNABLE = new Set<MsaidiziTaskStatus>([
  MsaidiziTaskStatus.READY,
  MsaidiziTaskStatus.PAUSED,
  MsaidiziTaskStatus.PARTIAL,
  MsaidiziTaskStatus.FAILED,
  MsaidiziTaskStatus.NEEDS_ATTENTION,
]);

/**
 * Persistence and state-machine boundary for durable Msaidizi work.
 *
 * This service deliberately does not execute a plan. The task-runtime worker leases
 * one step at a time; these APIs only create immutable plans and make CAS-governed
 * task state transitions. That separation prevents an HTTP retry from becoming
 * a second host or financial mutation.
 */
@Injectable()
export class MsaidiziTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AutonomyConfig,
    private readonly manifest: ManifestProvider,
    private readonly msaidizi: MsaidiziConfig,
    private readonly crudCoverage: CrudCoverageService,
    private readonly proposalUsage: MsaidiziProposalUsageService,
  ) {}

  /**
   * Persists the governed ownership/budget envelope before media is captured.
   * There is deliberately no plan row or executable step until `plan()` wins
   * the later PLANNING -> READY CAS for this exact task.
   */
  async createDraft(dto: CreateMsaidiziTaskDraftDto, user: AuthUser) {
    this.assertEnabled();
    this.assertCrudReleaseQualified();
    if (dto.mode === MsaidiziTaskMode.AUTOPILOT && !this.config.autopilotEnabled) {
      throw new ServiceUnavailableException('Msaidizi Autopilot is disabled by deployment policy');
    }

    if (dto.idempotencyKey) {
      const existing = await this.prisma.msaidiziTask.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        select: { id: true, initiatedByUserId: true },
      });
      if (existing) {
        if (existing.initiatedByUserId !== user.id) {
          throw new ConflictException('Task idempotency key is unavailable');
        }
        return this.findOne(existing.id, user);
      }
    }

    const companyId = dto.companyId ?? user.companyId ?? null;
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.READ);
    const principal = await this.activePrincipal(user.id);
    const mandate = await this.assertAuthority(
      principal.id,
      companyId,
      dto.mode,
      user.id,
      dto.mandateId,
    );
    const budgets = this.resolveBudgets(dto.budgets, mandate?.budgets);
    const objective = redactPersistedSecrets(dto.objective.trim());
    const title = redactPersistedSecrets(
      (dto.title?.trim() || objective.slice(0, 160) || 'Msaidizi task draft').slice(0, 160),
    );
    const taskId = randomUUID();
    const createdAt = new Date();

    const draft = await this.prisma.$transaction(async (tx) => {
      await tx.msaidiziTask.create({
        data: {
          id: taskId,
          principalId: principal.id,
          initiatedByUserId: user.id,
          companyId,
          mandateId: dto.mandateId ?? null,
          scheduleId: null,
          idempotencyKey: dto.idempotencyKey ?? null,
          mode: dto.mode,
          title,
          objective,
          createdAt,
          status: MsaidiziTaskStatus.PLANNING,
          activePlanVersion: 0,
          hostExecutionAllowed: this.config.hostExecutionEnabled,
          consumedWallTimeMs: 0n,
          wallTimeCheckpointAt: null,
          ...budgets,
        },
      });
      await this.appendEvent(tx, taskId, 'task.created', user, {
        status: MsaidiziTaskStatus.PLANNING,
        mode: dto.mode,
        draft: true,
        activePlanVersion: 0,
      });
      return this.findScopedTask(tx, taskId, user);
    });
    return jsonSafe(draft);
  }

  async plan(dto: PlanMsaidiziTaskDto, user: AuthUser) {
    this.assertEnabled();
    this.assertCrudReleaseQualified();
    let draft = dto.taskId ? await this.findScopedTask(this.prisma, dto.taskId, user) : null;
    if (draft) draft = await this.recoverPlanningProposalLease(draft, user);
    if (draft) this.assertDraftPlanRequest(draft, dto);
    const reviewedInputs = this.verifiedArtifactInputs(dto.inputs ?? {}, draft);
    this.validateGraph(dto.steps, reviewedInputs);
    // Fail before touching the global principal for authority defects that do
    // not depend on a selected mandate. Mandate containment is checked again
    // after the caller-owned active mandate is loaded below.
    this.validateStepAuthority(dto.steps, dto.mode, user);
    await this.validateStepCapabilitySchemas(dto.steps, reviewedInputs, user);

    if (dto.mode === MsaidiziTaskMode.AUTOPILOT && !this.config.autopilotEnabled) {
      throw new ServiceUnavailableException('Msaidizi Autopilot is disabled by deployment policy');
    }

    if (!draft && dto.idempotencyKey) {
      const existing = await this.prisma.msaidiziTask.findUnique({
        where: { idempotencyKey: dto.idempotencyKey },
        select: { id: true, initiatedByUserId: true },
      });
      if (existing) {
        if (existing.initiatedByUserId !== user.id) {
          throw new ConflictException('Task idempotency key is unavailable');
        }
        return this.findOne(existing.id, user);
      }
    }

    const companyId = draft?.companyId ?? dto.companyId ?? user.companyId ?? null;
    assertCanAccessCompanyFromUser(user, companyId, AccessLevel.READ);
    if ((dto.proposalUsageId === undefined) !== (dto.proposalDigest === undefined)) {
      throw new BadRequestException(
        'proposalUsageId and proposalDigest must be supplied together or both omitted',
      );
    }
    const proposalUsage = dto.proposalUsageId
      ? await this.proposalUsage.inspectConsumable({
          receiptId: dto.proposalUsageId,
          proposalDigest: dto.proposalDigest!,
          userId: user.id,
          companyId,
          mode: dto.mode,
        })
      : null;

    const principal = await this.activePrincipal(user.id);
    if (draft && draft.principalId !== principal.id) {
      throw new ConflictException('Task draft principal no longer matches deployment policy');
    }

    const mandate = await this.assertAuthority(
      principal.id,
      companyId,
      dto.mode,
      user.id,
      draft?.mandateId ?? dto.mandateId,
      draft?.scheduleId ?? dto.scheduleId,
    );
    this.validateStepAuthority(dto.steps, dto.mode, user, mandate?.capabilities);

    const budgets = draft
      ? this.budgetsFromDraft(draft, dto.budgets, mandate?.budgets)
      : this.resolveBudgets(dto.budgets, mandate?.budgets);
    this.assertProposalUsageFitsBudget(proposalUsage, budgets);
    this.assertPlanFitsBudget(dto.steps, budgets);
    const objective = redactPersistedSecrets(dto.objective.trim());
    const title = redactPersistedSecrets(dto.title.trim());
    const summary = redactPersistedSecrets((dto.summary ?? objective).trim());
    const inputs = persistedJson(reviewedInputs);
    const stopConditions = persistedJson(dto.stopConditions);
    const taskId = draft?.id ?? randomUUID();
    const planVersionId = randomUUID();
    // Prisma Date values are UTC instants. Persist one shared value explicitly
    // for the task and all of its steps so a database session timezone can
    // never make a later UTC startedAt appear to predate its row.
    const createdAt = new Date();
    const stepRows = this.stepRows(taskId, planVersionId, dto.steps, createdAt);
    const budgetSnapshot = this.budgetSnapshot(budgets);
    if (proposalUsage) {
      const submittedProposalDigest = msaidiziProposalDigest({
        ...(draft && { taskId: draft.id }),
        title,
        objective,
        summary,
        mode: dto.mode,
        ...(companyId && { companyId }),
        ...((draft?.mandateId ?? dto.mandateId) && {
          mandateId: draft?.mandateId ?? dto.mandateId,
        }),
        ...((draft?.scheduleId ?? dto.scheduleId) && {
          scheduleId: draft?.scheduleId ?? dto.scheduleId,
        }),
        inputs: reviewedInputs,
        stopConditions: dto.stopConditions ?? {},
        budgets: proposalBudgetProjection(budgets),
        steps: dto.steps,
      });
      if (submittedProposalDigest !== proposalUsage.proposalDigest) {
        throw new ConflictException({
          code: 'MSAIDIZI_PROPOSAL_PLAN_MISMATCH',
          message: 'The submitted plan differs from the proposal funded by this receipt',
        });
      }
    }
    const planDigest = digest({
      objective,
      inputs,
      stopConditions,
      budgetSnapshot,
      steps: stepRows,
    });

    const task = await this.prisma.$transaction(async (tx) => {
      if (proposalUsage) {
        await this.proposalUsage.consume(tx, proposalUsage.id, proposalUsage.proposalDigest);
      }
      if (draft) {
        const won = await tx.msaidiziTask.updateMany({
          where: {
            id: draft.id,
            principalId: draft.principalId,
            initiatedByUserId: user.id,
            companyId: draft.companyId,
            mandateId: draft.mandateId,
            scheduleId: draft.scheduleId,
            mode: draft.mode,
            status: MsaidiziTaskStatus.PLANNING,
            activePlanVersion: 0,
            stateVersion: draft.stateVersion,
            statusDetail: null,
            proposalUsageId: null,
            mutations: 0,
            attemptedToolCalls: 0,
            executedToolCalls: 0,
            modelTurns: 0,
            inputTokens: 0n,
            outputTokens: 0n,
            modelCostUsd: 0,
            planVersions: { none: {} },
            steps: { none: {} },
            toolAttempts: { none: {} },
            deviceLeases: { none: {} },
            hostActions: { none: {} },
          },
          data: {
            title,
            objective,
            proposalUsageId: proposalUsage?.id ?? null,
            status: MsaidiziTaskStatus.READY,
            activePlanVersion: 1,
            stateVersion: { increment: 1 },
            hostExecutionAllowed: this.config.hostExecutionEnabled,
            statusDetail: null,
            ...(proposalUsage
              ? {
                  modelTurns: proposalUsage.modelTurns,
                  inputTokens: proposalUsage.inputTokens,
                  outputTokens: proposalUsage.outputTokens,
                  modelCostUsd: proposalUsage.estimatedCostUsd,
                }
              : {}),
          },
        });
        if (won.count !== 1) {
          throw new ConflictException('Task draft changed while its reviewed plan was attached');
        }
      } else {
        await tx.msaidiziTask.create({
          data: {
            id: taskId,
            principalId: principal.id,
            initiatedByUserId: user.id,
            companyId,
            mandateId: dto.mandateId ?? null,
            scheduleId: dto.scheduleId ?? null,
            idempotencyKey: dto.idempotencyKey ?? null,
            proposalUsageId: proposalUsage?.id ?? null,
            mode: dto.mode,
            title,
            objective,
            createdAt,
            status: MsaidiziTaskStatus.READY,
            activePlanVersion: 1,
            hostExecutionAllowed: this.config.hostExecutionEnabled,
            consumedWallTimeMs: 0n,
            wallTimeCheckpointAt: null,
            ...budgets,
            ...(proposalUsage
              ? {
                  modelTurns: proposalUsage.modelTurns,
                  inputTokens: proposalUsage.inputTokens,
                  outputTokens: proposalUsage.outputTokens,
                  modelCostUsd: proposalUsage.estimatedCostUsd,
                }
              : {}),
          },
        });
      }
      await tx.msaidiziPlanVersion.create({
        data: {
          id: planVersionId,
          taskId,
          version: 1,
          createdByUserId: user.id,
          summary,
          objective,
          inputs,
          stopConditions,
          budgetSnapshot,
          planDigest,
          sourceProposalDigest: proposalUsage?.proposalDigest ?? null,
        },
      });
      if (proposalUsage) {
        // Prisma 5 can report an interactive transaction as resolved when a
        // deferred PostgreSQL constraint fails only at COMMIT, even though the
        // database correctly rolls the transaction back. Force this guard while
        // the transaction is still active so an attribution failure is surfaced
        // to the caller and can never become a phantom successful task response.
        await tx.$executeRawUnsafe(
          'SET CONSTRAINTS "msaidizi_tasks_proposal_receipt_guard" IMMEDIATE',
        );
      }
      await tx.msaidiziTaskStep.createMany({ data: stepRows });
      if (!draft) {
        await this.appendEvent(tx, taskId, 'task.created', user, {
          status: MsaidiziTaskStatus.PLANNING,
          mode: dto.mode,
          draft: false,
        });
      }
      await this.appendEvent(tx, taskId, 'task.ready', user, {
        from: MsaidiziTaskStatus.PLANNING,
        to: MsaidiziTaskStatus.READY,
        draftPromoted: Boolean(draft),
        previousStateVersion: draft?.stateVersion ?? 0,
        planVersion: 1,
        planDigest,
        artifactIds: draft?.artifacts.map((artifact) => artifact.id) ?? [],
        artifactTrust: draft?.artifacts.length ? 'UNTRUSTED' : null,
        proposalUsageId: proposalUsage?.id ?? null,
        proposalModelTurns: proposalUsage?.modelTurns ?? 0,
        proposalModelCostUsd: proposalUsage?.estimatedCostUsd ?? '0.000000',
      });
      return this.findScopedTask(tx, taskId, user);
    });

    return jsonSafe(task);
  }

  private assertProposalUsageFitsBudget(
    usage: ConsumableProposalUsage | null,
    budgets: ResolvedBudget,
  ): void {
    if (!usage) return;
    if (usage.modelTurns > budgets.maxModelTurns) {
      throw new BadRequestException({
        code: 'MSAIDIZI_PROPOSAL_USAGE_EXCEEDS_TASK_BUDGET',
        message: 'The reviewed task model-turn ceiling is below proposal reasoning already spent',
      });
    }
    if (Number(usage.estimatedCostUsd) > budgets.maxModelCostUsd + 0.0000001) {
      throw new BadRequestException({
        code: 'MSAIDIZI_PROPOSAL_USAGE_EXCEEDS_TASK_BUDGET',
        message: 'The reviewed task model-spend ceiling is below proposal reasoning already spent',
      });
    }
  }

  /** Queues a previously planned task. No work executes in this request. */
  async create(taskId: string, user: AuthUser, oneShotConsentStepIds: string[] = []) {
    this.assertEnabled();
    this.assertCrudReleaseQualified();
    const task = await this.findScopedTask(this.prisma, taskId, user);
    if (task.status === MsaidiziTaskStatus.QUEUED) return jsonSafe(task);
    if (task.status !== MsaidiziTaskStatus.READY) {
      throw new ConflictException(`Task cannot be queued from ${task.status}`);
    }

    this.assertQueueAuthority(task);
    const activePlan = task.planVersions.find((plan) => plan.version === task.activePlanVersion);
    if (!activePlan) throw new ConflictException('Task has no active plan version');
    const hasHostStep = activePlan.steps.some(
      (step) => step.target === MsaidiziExecutionTarget.HOST,
    );
    if (hasHostStep && (!task.hostExecutionAllowed || !this.config.hostExecutionEnabled)) {
      throw new ServiceUnavailableException('Privileged host execution is disabled');
    }

    const oneShotConsentSteps = activePlan.steps.filter(
      (step) =>
        step.target === MsaidiziExecutionTarget.HOST &&
        ONE_SHOT_CONSENT_CAPABILITIES.has(step.capability),
    );
    const requestedConsent = new Set(oneShotConsentStepIds);
    const requiredConsent = new Set(oneShotConsentSteps.map((step) => step.id));
    if (
      requestedConsent.size !== oneShotConsentStepIds.length ||
      [...requestedConsent].some((stepId) => !requiredConsent.has(stepId)) ||
      [...requiredConsent].some((stepId) => !requestedConsent.has(stepId))
    ) {
      throw new BadRequestException(
        'One-shot host capabilities require explicit one-use consent for each exact active-plan step',
      );
    }

    const consentEvents = oneShotConsentSteps.map((step) => ({
      type: 'task.one_shot_consent_granted',
      payload: {
        protocol: ONE_SHOT_CONSENT_PROTOCOL,
        planVersionId: activePlan.id,
        planVersion: activePlan.version,
        stepId: step.id,
        capability: step.capability,
        capabilityVersion: step.capabilityVersion,
        argumentsSha256: digest(step.arguments).toUpperCase(),
        consentGrant: 'one_shot_approval',
        instructionAuthority: 'NONE',
      },
    }));

    return this.transition(
      task,
      MsaidiziTaskStatus.QUEUED,
      user,
      { queuedAt: new Date(), statusDetail: null },
      consentEvents,
    );
  }

  async list(query: QueryMsaidiziTaskDto, user: AuthUser) {
    this.assertEnabled();
    if (query.companyId) {
      assertCanAccessCompanyFromUser(user, query.companyId, AccessLevel.READ);
    }

    const page = Math.max(query.page, 1);
    const limit = Math.min(Math.max(query.limit, 1), 100);
    const where: Prisma.MsaidiziTaskWhereInput = {
      initiatedByUserId: user.id,
      ...(query.companyId ? { companyId: query.companyId } : this.taskCompanyScopeFor(user)),
      ...(query.status ? { status: query.status } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.msaidiziTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.msaidiziTask.count({ where }),
    ]);

    return jsonSafe({ data, meta: { page, limit, total } });
  }

  async findOne(id: string, user: AuthUser) {
    this.assertEnabled();
    return jsonSafe(await this.findScopedTask(this.prisma, id, user));
  }

  async pause(id: string, user: AuthUser) {
    this.assertEnabled();
    const task = await this.findScopedTask(this.prisma, id, user);
    if (task.status === MsaidiziTaskStatus.PAUSED || task.status === MsaidiziTaskStatus.PAUSING) {
      return jsonSafe(task);
    }
    if (task.status === MsaidiziTaskStatus.QUEUED) {
      return this.transition(task, MsaidiziTaskStatus.PAUSED, user, {
        pauseRequestedAt: new Date(),
      });
    }
    if (task.status === MsaidiziTaskStatus.RUNNING) {
      return this.transition(task, MsaidiziTaskStatus.PAUSING, user, {
        pauseRequestedAt: new Date(),
      });
    }
    throw new ConflictException(`Task cannot be paused from ${task.status}`);
  }

  async resume(id: string, user: AuthUser) {
    this.assertEnabled();
    const task = await this.findScopedTask(this.prisma, id, user);
    if (task.status === MsaidiziTaskStatus.QUEUED) return jsonSafe(task);
    if (task.status !== MsaidiziTaskStatus.PAUSED) {
      throw new ConflictException(`Task cannot be resumed from ${task.status}`);
    }
    this.assertQueueAuthority(task);
    return this.transition(task, MsaidiziTaskStatus.QUEUED, user, {
      queuedAt: new Date(),
      pauseRequestedAt: null,
    });
  }

  async cancel(id: string, user: AuthUser) {
    this.assertEnabled();
    let task = await this.findScopedTask(this.prisma, id, user);
    task = await this.recoverPlanningProposalLease(task, user);
    if (task.status === MsaidiziTaskStatus.PLANNING && task.statusDetail !== null) {
      throw new ConflictException({
        code: 'MSAIDIZI_PROPOSAL_IN_FLIGHT',
        message: 'The task draft cannot be cancelled while proposal reasoning is reserved',
      });
    }
    if (
      task.status === MsaidiziTaskStatus.CANCELLED ||
      task.status === MsaidiziTaskStatus.CANCELLING
    ) {
      return jsonSafe(task);
    }

    if (
      task.status === MsaidiziTaskStatus.NEEDS_ATTENTION &&
      (task.toolAttempts.some((attempt) => attempt.uncertainOutcome) ||
        task.hostActions.some((action) => action.uncertainOutcome))
    ) {
      throw new ConflictException(
        'Task has an uncertain write outcome and must remain NEEDS_ATTENTION until it is reconciled',
      );
    }

    const now = new Date();
    if (
      task.status === MsaidiziTaskStatus.RUNNING ||
      task.status === MsaidiziTaskStatus.PAUSING ||
      this.hasActiveRuntimeWork(task)
    ) {
      return this.transition(task, MsaidiziTaskStatus.CANCELLING, user, {
        cancelRequestedAt: now,
      });
    }
    if (
      new Set<MsaidiziTaskStatus>([
        MsaidiziTaskStatus.PLANNING,
        MsaidiziTaskStatus.READY,
        MsaidiziTaskStatus.QUEUED,
        MsaidiziTaskStatus.PAUSED,
        MsaidiziTaskStatus.NEEDS_ATTENTION,
      ]).has(task.status)
    ) {
      return this.transition(task, MsaidiziTaskStatus.CANCELLED, user, {
        cancelRequestedAt: now,
        endedAt: now,
      });
    }
    throw new ConflictException(`Task cannot be cancelled from ${task.status}`);
  }

  async replan(id: string, dto: ReplanMsaidiziTaskDto, user: AuthUser) {
    this.assertEnabled();
    const task = await this.findScopedTask(this.prisma, id, user);
    const reviewedInputs = this.verifiedArtifactInputs(dto.inputs ?? {}, task);
    this.validateGraph(dto.steps, reviewedInputs);
    if (!REPLANNABLE.has(task.status)) {
      throw new ConflictException(`Task cannot be replanned from ${task.status}`);
    }
    if (
      task.mutations > 0 ||
      task.toolAttempts.some((attempt) => attempt.uncertainOutcome) ||
      task.hostActions.some((action) => action.uncertainOutcome)
    ) {
      throw new ConflictException(
        'Task cannot be replanned after a mutation or uncertain outcome; reconcile it and create a new reviewed task',
      );
    }
    this.validateStepAuthority(dto.steps, task.mode, user, task.mandate?.capabilities);
    await this.validateStepCapabilitySchemas(dto.steps, reviewedInputs, user);
    this.assertPlanFitsBudget(dto.steps, {
      maxWallTimeSeconds: task.maxWallTimeSeconds,
      maxModelTurns: task.maxModelTurns,
      maxAttemptedToolCalls: task.maxAttemptedToolCalls,
      maxMutations: task.maxMutations,
      maxLocalBytes: task.maxLocalBytes,
      maxExternalEgressBytes: task.maxExternalEgressBytes,
      maxModelCostUsd: Number(task.maxModelCostUsd),
    });

    const objective = redactPersistedSecrets((dto.objective ?? task.objective).trim());
    const summary = redactPersistedSecrets(dto.summary.trim());
    const inputs = persistedJson(reviewedInputs);
    const stopConditions = persistedJson(dto.stopConditions);
    const nextVersion = task.activePlanVersion + 1;
    const planVersionId = randomUUID();
    const createdAt = new Date();
    const stepRows = this.stepRows(task.id, planVersionId, dto.steps, createdAt);
    const budgetSnapshot = this.budgetSnapshotFromTask(task);
    const planDigest = digest({
      objective,
      inputs,
      stopConditions,
      budgetSnapshot,
      steps: stepRows,
    });

    const replanned = await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziTask.updateMany({
        where: { id: task.id, status: task.status, stateVersion: task.stateVersion },
        data: {
          objective,
          status: MsaidiziTaskStatus.READY,
          activePlanVersion: nextVersion,
          stateVersion: { increment: 1 },
          hostExecutionAllowed: this.config.hostExecutionEnabled,
          statusDetail: null,
          failureCode: null,
          pauseRequestedAt: null,
          cancelRequestedAt: null,
          endedAt: null,
        },
      });
      if (won.count !== 1) throw new ConflictException('Task changed while it was being replanned');

      await tx.msaidiziPlanVersion.create({
        data: {
          id: planVersionId,
          taskId: task.id,
          version: nextVersion,
          createdByUserId: user.id,
          summary,
          objective,
          inputs,
          stopConditions,
          budgetSnapshot,
          planDigest,
        },
      });
      await tx.msaidiziTaskStep.createMany({ data: stepRows });
      await this.appendEvent(tx, task.id, 'task.replanned', user, {
        fromStatus: task.status,
        toStatus: MsaidiziTaskStatus.READY,
        planVersion: nextVersion,
        planDigest,
      });
      return this.findScopedTask(tx, task.id, user);
    });

    return jsonSafe(replanned);
  }

  async events(id: string, query: QueryMsaidiziTaskEventsDto, user: AuthUser) {
    this.assertEnabled();
    // SSE holds the request's AuthUser beyond the JWT/cache validation window.
    // Rebuild authorization from the database for every event poll so account,
    // permission, group-scope, and company-access revocations close the stream.
    const liveUser = await this.liveEventViewer(user.id);
    await this.assertScopedTaskExists(id, liveUser);
    const after = BigInt(query.after);
    const rows = await this.prisma.msaidiziTaskEvent.findMany({
      where: { taskId: id, cursor: { gt: after } },
      orderBy: { cursor: 'asc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    return jsonSafe({
      data,
      nextCursor: data.at(-1)?.cursor ?? after,
      hasMore,
    });
  }

  private assertEnabled() {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException('Durable Msaidizi autonomy is disabled');
    }
  }

  private assertCrudReleaseQualified() {
    const gate = this.crudCoverage.report().releaseGate;
    if (gate.status !== 'passed') {
      throw new ServiceUnavailableException({
        code: 'MSAIDIZI_CRUD_RELEASE_GATE_BLOCKED',
        message: 'Durable Msaidizi work is blocked until signed Itemba CRUD coverage passes',
        blockers: gate.blockers,
      });
    }
  }

  private async activePrincipal(createdByUserId: string) {
    const principal = await this.prisma.msaidiziPrincipal.upsert({
      where: { key: this.config.principalKey },
      // Deployment config, not a task/model request, is the authority source.
      update: {
        grants: {
          scope: 'GROUP',
          authoritySource: 'deployment-policy',
          permissions: this.config.principalGrants,
        },
      },
      create: {
        key: this.config.principalKey,
        displayName: 'Msaidizi',
        grants: {
          scope: 'GROUP',
          authoritySource: 'deployment-policy',
          permissions: this.config.principalGrants,
        },
        createdByUserId,
      },
    });
    if (principal.status !== MsaidiziPrincipalStatus.ACTIVE) {
      throw new ConflictException(
        'The global Msaidizi operator latch is disabled; an overseer must enable it first',
      );
    }
    return principal;
  }

  private assertDraftPlanRequest(draft: TaskDetail, dto: PlanMsaidiziTaskDto): void {
    if (
      draft.status !== MsaidiziTaskStatus.PLANNING ||
      draft.activePlanVersion !== 0 ||
      draft.statusDetail !== null ||
      draft.planVersions.length !== 0 ||
      draft.toolAttempts.length !== 0 ||
      draft.deviceLeases.length !== 0 ||
      draft.hostActions.length !== 0 ||
      draft.mutations !== 0 ||
      draft.attemptedToolCalls !== 0 ||
      draft.executedToolCalls !== 0
    ) {
      throw new ConflictException('Task is not an unused PLANNING draft');
    }
    if (
      draft.mode !== dto.mode ||
      (dto.companyId !== undefined && dto.companyId !== draft.companyId) ||
      (dto.mandateId ?? null) !== draft.mandateId ||
      (dto.scheduleId ?? null) !== draft.scheduleId ||
      (dto.idempotencyKey !== undefined && dto.idempotencyKey !== draft.idempotencyKey) ||
      redactPersistedSecrets(dto.objective.trim()) !== draft.objective
    ) {
      throw new ConflictException('Reviewed plan scope does not match the caller-owned task draft');
    }
  }

  private async recoverPlanningProposalLease(
    initial: TaskDetail,
    user: AuthUser,
  ): Promise<TaskDetail> {
    let task = initial;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (task.status !== MsaidiziTaskStatus.PLANNING || task.statusDetail === null) return task;
      if (!task.initiatedByUserId || task.stateVersion < 1) {
        throw proposalLeaseRecoveryBlocked();
      }
      const authority: MsaidiziDraftProposalAuthority = {
        taskId: task.id,
        principalId: task.principalId,
        initiatedByUserId: task.initiatedByUserId,
        companyId: task.companyId,
        mandateId: task.mandateId,
        mode: task.mode,
        stateVersion: task.stateVersion - 1,
      };
      const outcome = await this.proposalUsage.recoverExpiredDraftLeaseForTask({
        authority,
        marker: task.statusDetail,
      });
      if (outcome === 'LIVE') {
        throw new ConflictException({
          code: 'MSAIDIZI_PROPOSAL_IN_FLIGHT',
          message: 'The task draft cannot change while proposal reasoning is reserved',
        });
      }
      if (outcome === 'BLOCKED') throw proposalLeaseRecoveryBlocked();
      task = await this.findScopedTask(this.prisma, task.id, user);
    }
    if (task.status === MsaidiziTaskStatus.PLANNING && task.statusDetail !== null) {
      throw proposalLeaseRecoveryBlocked();
    }
    return task;
  }

  private budgetsFromDraft(
    draft: TaskDetail,
    requested: MsaidiziTaskBudgetDto | undefined,
    mandateBudgets: Prisma.JsonValue | undefined,
  ): ResolvedBudget {
    const stored: ResolvedBudget = {
      maxWallTimeSeconds: draft.maxWallTimeSeconds,
      maxModelTurns: draft.maxModelTurns,
      maxAttemptedToolCalls: draft.maxAttemptedToolCalls,
      maxMutations: draft.maxMutations,
      maxLocalBytes: draft.maxLocalBytes,
      maxExternalEgressBytes: draft.maxExternalEgressBytes,
      maxModelCostUsd: Number(draft.maxModelCostUsd),
    };
    if (requested) {
      const requestedKeys = Object.keys(requested) as Array<keyof MsaidiziTaskBudgetDto>;
      const storedNumbers: Record<keyof MsaidiziTaskBudgetDto, number> = {
        maxWallTimeSeconds: stored.maxWallTimeSeconds,
        maxModelTurns: stored.maxModelTurns,
        maxAttemptedToolCalls: stored.maxAttemptedToolCalls,
        maxMutations: stored.maxMutations,
        maxLocalBytes: Number(stored.maxLocalBytes),
        maxExternalEgressBytes: Number(stored.maxExternalEgressBytes),
        maxModelCostUsd: stored.maxModelCostUsd,
      };
      if (requestedKeys.some((key) => requested[key] !== storedNumbers[key])) {
        throw new ConflictException('Reviewed plan budgets do not match the immutable task draft');
      }
    }
    const currentlyAllowed = this.resolveBudgets(
      {
        maxWallTimeSeconds: stored.maxWallTimeSeconds,
        maxModelTurns: stored.maxModelTurns,
        maxAttemptedToolCalls: stored.maxAttemptedToolCalls,
        maxMutations: stored.maxMutations,
        maxLocalBytes: Number(stored.maxLocalBytes),
        maxExternalEgressBytes: Number(stored.maxExternalEgressBytes),
        maxModelCostUsd: stored.maxModelCostUsd,
      },
      mandateBudgets,
    );
    if (!sameBudgets(stored, currentlyAllowed)) {
      throw new ConflictException(
        'Task draft budgets exceed current deployment or mandate policy; create a new draft',
      );
    }
    return stored;
  }

  private verifiedArtifactInputs(
    rawInputs: Record<string, unknown>,
    draft: TaskDetail | null,
  ): Record<string, unknown> {
    const rawProvenance = rawInputs._msaidiziArtifactProvenance;
    if (rawProvenance === undefined) return rawInputs;
    if (!draft) {
      throw new BadRequestException(
        'Multimodal proposal inputs require a caller-owned PLANNING task draft',
      );
    }
    if (!Array.isArray(rawProvenance) || rawProvenance.length > 5) {
      throw new BadRequestException('Task artifact provenance is invalid');
    }
    const artifacts = new Map(draft.artifacts.map((artifact) => [artifact.id, artifact]));
    const seen = new Set<string>();
    const verified = rawProvenance.map((entry) => {
      const record = jsonRecord(entry);
      const artifactId = typeof record.artifactId === 'string' ? record.artifactId : '';
      const artifact = artifacts.get(artifactId);
      if (
        !artifact ||
        seen.has(artifactId) ||
        artifact.stepId !== null ||
        artifact.trustLevel !== 'UNTRUSTED' ||
        record.sourceTaskId !== draft.id ||
        record.sha256 !== artifact.sha256 ||
        record.mimeType !== artifact.mimeType ||
        record.dataClass !== artifact.dataClass
      ) {
        throw new BadRequestException(
          'Task artifact provenance does not match this caller-owned draft',
        );
      }
      seen.add(artifactId);
      return {
        artifactId,
        sourceTaskId: draft.id,
        sha256: artifact.sha256,
        mimeType: artifact.mimeType,
        dataClass: artifact.dataClass,
        trustLevel: 'UNTRUSTED',
        provenance: artifact.provenance,
      };
    });
    return { ...rawInputs, _msaidiziArtifactProvenance: verified };
  }

  private async assertAuthority(
    principalId: string,
    companyId: string | null,
    mode: MsaidiziTaskMode,
    initiatedByUserId: string,
    mandateId?: string,
    scheduleId?: string,
  ) {
    if (mode === MsaidiziTaskMode.AUTOPILOT && !mandateId) {
      throw new BadRequestException('Autopilot tasks require an active mandate');
    }
    if (scheduleId && !mandateId) {
      throw new BadRequestException('Scheduled tasks require a mandate');
    }
    if (!mandateId) return null;

    const now = new Date();
    const mandate = await this.prisma.msaidiziMandate.findFirst({
      where: {
        id: mandateId,
        principalId,
        createdByUserId: initiatedByUserId,
        status: MsaidiziMandateStatus.ACTIVE,
        OR: [{ companyId: null }, { companyId }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        ],
      },
    });
    if (!mandate) throw new BadRequestException('Mandate is not active for this task scope');

    if (scheduleId) {
      const schedule = await this.prisma.msaidiziSchedule.findFirst({
        where: {
          id: scheduleId,
          principalId,
          mandateId,
          createdByUserId: initiatedByUserId,
          status: MsaidiziScheduleStatus.ACTIVE,
        },
      });
      if (!schedule) throw new BadRequestException('Schedule is not active for this mandate');
    }
    return mandate;
  }

  private assertQueueAuthority(task: TaskDetail) {
    if (task.principal.status !== MsaidiziPrincipalStatus.ACTIVE) {
      throw new ConflictException(
        'The global Msaidizi operator latch is disabled; this task cannot be queued or resumed',
      );
    }
    if (task.mode === MsaidiziTaskMode.AUTOPILOT && !this.config.autopilotEnabled) {
      throw new ServiceUnavailableException('Msaidizi Autopilot is disabled by deployment policy');
    }
    if (!task.mandateId) return;
    const now = Date.now();
    if (
      !task.mandate ||
      task.mandate.status !== MsaidiziMandateStatus.ACTIVE ||
      (task.mandate.startsAt && task.mandate.startsAt.getTime() > now) ||
      (task.mandate.expiresAt && task.mandate.expiresAt.getTime() <= now)
    ) {
      throw new ConflictException('Task mandate is no longer active');
    }
    if (task.scheduleId && task.schedule?.status !== MsaidiziScheduleStatus.ACTIVE) {
      throw new ConflictException('Task schedule is no longer active');
    }
  }

  private resolveBudgets(
    requested?: MsaidiziTaskBudgetDto,
    rawMandateBudget?: Prisma.JsonValue,
  ): ResolvedBudget {
    const ceiling = this.config.budgetCeilings;
    const mandate = jsonRecord(rawMandateBudget);
    return {
      maxWallTimeSeconds: lower(
        requested?.maxWallTimeSeconds,
        Math.min(
          ceiling.maxWallTimeSeconds,
          mandateBudgetNumber(mandate, 'maxWallTimeSeconds', 1, true) ?? ceiling.maxWallTimeSeconds,
        ),
      ),
      maxModelTurns: lower(
        requested?.maxModelTurns,
        Math.min(
          ceiling.maxModelTurns,
          mandateBudgetNumber(mandate, 'maxModelTurns', 1, true) ?? ceiling.maxModelTurns,
        ),
      ),
      maxAttemptedToolCalls: lower(
        requested?.maxAttemptedToolCalls,
        Math.min(
          ceiling.maxAttemptedToolCalls,
          mandateBudgetNumber(mandate, 'maxAttemptedToolCalls', 1, true) ??
            ceiling.maxAttemptedToolCalls,
        ),
      ),
      maxMutations: lower(
        requested?.maxMutations,
        Math.min(
          ceiling.maxMutations,
          mandateBudgetNumber(mandate, 'maxMutations', 0, true) ?? ceiling.maxMutations,
        ),
      ),
      maxLocalBytes: lowerBigInt(
        requested?.maxLocalBytes,
        BigInt(
          Math.min(
            Number(ceiling.maxLocalBytes),
            mandateBudgetNumber(mandate, 'maxLocalBytes', 1, true) ?? Number(ceiling.maxLocalBytes),
          ),
        ),
      ),
      maxExternalEgressBytes: lowerBigInt(
        requested?.maxExternalEgressBytes,
        BigInt(
          Math.min(
            Number(ceiling.maxExternalEgressBytes),
            mandateBudgetNumber(mandate, 'maxExternalEgressBytes', 0, true) ??
              Number(ceiling.maxExternalEgressBytes),
          ),
        ),
      ),
      maxModelCostUsd: lower(
        requested?.maxModelCostUsd,
        Math.min(
          ceiling.maxModelCostUsd,
          mandateBudgetNumber(mandate, 'maxModelCostUsd', 0, false) ?? ceiling.maxModelCostUsd,
        ),
      ),
    };
  }

  private assertPlanFitsBudget(steps: MsaidiziPlanStepDto[], budget: ResolvedBudget): void {
    if (steps.length > budget.maxAttemptedToolCalls) {
      throw new BadRequestException('Task plan exceeds the mandate tool-attempt budget');
    }
    if (steps.filter((step) => step.mutation).length > budget.maxMutations) {
      throw new BadRequestException('Task plan exceeds the mandate mutation budget');
    }
    for (const step of steps) {
      const stopConditions = validateStepStopConditions(step.stopConditions as Prisma.JsonValue);
      if (!stopConditions.ok) {
        throw new BadRequestException({
          code: stopConditions.code,
          message: `Step ${step.key} has invalid stop conditions: ${stopConditions.detail}`,
        });
      }
      const parsed = parseStepBudgets(step.budgets as Prisma.JsonValue);
      if (!parsed.ok) {
        throw new BadRequestException({
          code: parsed.code,
          message: `Step ${step.key} has an invalid budget: ${parsed.detail}`,
        });
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
        throw new BadRequestException({
          code: 'STEP_BUDGET_EXCEEDS_TASK_CEILING',
          message: `Step ${step.key} budget exceeds its immutable task ceiling`,
        });
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

  private budgetSnapshotFromTask(task: TaskDetail): Prisma.InputJsonObject {
    return {
      maxWallTimeSeconds: task.maxWallTimeSeconds,
      maxModelTurns: task.maxModelTurns,
      maxAttemptedToolCalls: task.maxAttemptedToolCalls,
      maxMutations: task.maxMutations,
      maxLocalBytes: task.maxLocalBytes.toString(),
      maxExternalEgressBytes: task.maxExternalEgressBytes.toString(),
      maxModelCostUsd: task.maxModelCostUsd.toString(),
    };
  }

  private stepRows(
    taskId: string,
    planVersionId: string,
    steps: MsaidiziPlanStepDto[],
    createdAt: Date,
  ) {
    return steps.map(
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
        arguments: persistableStepArguments(step),
        dependencies: persistedJson(step.dependsOn),
        // Binding definitions are already closed-schema validated. Do not pass
        // opaque secret-reference UUID handles through generic key-name DLP,
        // which would rewrite the reviewed value and invalidate its digest.
        inputBindings: canonicalBindingJson(step.inputBindings),
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
  }

  private validateGraph(steps: MsaidiziPlanStepDto[], inputs: Record<string, unknown>) {
    const byKey = new Map<string, MsaidiziPlanStepDto>();
    for (const step of steps) {
      if (byKey.has(step.key)) throw new BadRequestException(`Duplicate step key: ${step.key}`);
      if (step.expectedEffect === MsaidiziEffect.READ && step.mutation) {
        throw new BadRequestException(`Read step ${step.key} cannot be marked as a mutation`);
      }
      if (step.expectedEffect !== MsaidiziEffect.READ && !step.mutation) {
        throw new BadRequestException(`Effectful step ${step.key} must be marked as a mutation`);
      }
      if (
        step.target === MsaidiziExecutionTarget.ERP &&
        !/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(step.capability)
      ) {
        throw new BadRequestException(
          `ERP step ${step.key} capability must use Controller.handler identity`,
        );
      }
      if (
        step.target === MsaidiziExecutionTarget.ERP &&
        !normaliseHttpActionEnvelope(step.arguments)
      ) {
        throw new BadRequestException(
          `ERP step ${step.key} arguments must use the exact { path, query, body } envelope`,
        );
      }
      if (
        updateProposalStepContainsPersistedSecret(
          bindingSafeDlpProjection({ steps: [step] }).steps[0] as MsaidiziPlanStepDto,
        )
      ) {
        throw new BadRequestException(
          `Step ${step.key} contains credential-like data; use a supervisor-owned secret reference`,
        );
      }
      byKey.set(step.key, step);
    }

    for (const step of steps) {
      for (const dependency of step.dependsOn) {
        if (!byKey.has(dependency)) {
          throw new BadRequestException(`Step ${step.key} has unknown dependency ${dependency}`);
        }
        if (dependency === step.key) {
          throw new BadRequestException(`Step ${step.key} cannot depend on itself`);
        }
      }
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (key: string) => {
      if (visited.has(key)) return;
      if (visiting.has(key)) throw new BadRequestException('Task plan must be acyclic');
      visiting.add(key);
      for (const dependency of byKey.get(key)?.dependsOn ?? []) visit(dependency);
      visiting.delete(key);
      visited.add(key);
    };
    for (const key of byKey.keys()) visit(key);
    try {
      assertPlanInputBindings(steps, inputs);
    } catch (error) {
      if (error instanceof MsaidiziInputBindingError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw error;
    }
    const authorityIssue = bindingAuthorityIssues(steps, inputs)[0];
    if (authorityIssue) {
      throw new BadRequestException({
        code: authorityIssue.code,
        message: authorityIssue.message,
      });
    }
  }

  private async validateStepCapabilitySchemas(
    steps: MsaidiziPlanStepDto[],
    inputs: Record<string, unknown>,
    user: AuthUser,
  ): Promise<void> {
    const erpEntries = new Map(
      buildRegistry(this.manifest.capabilities(), user.permissions, this.msaidizi.allowedTiers).map(
        (entry) => [entry.capability.id, entry],
      ),
    );
    const hostDeviceIds = Array.from(
      new Set(
        steps
          .filter((step) => step.target === MsaidiziExecutionTarget.HOST)
          .map((step) => step.preconditions.deviceId)
          .filter((value): value is string => typeof value === 'string'),
      ),
    );
    const devices = hostDeviceIds.length
      ? await this.prisma.msaidiziDevice.findMany({
          where: { id: { in: hostDeviceIds }, status: 'ACTIVE' },
          select: { id: true, capabilityManifest: true },
        })
      : [];
    const devicesById = new Map(devices.map((device) => [device.id, device]));

    for (const step of steps) {
      let schema: Record<string, unknown> | null = null;
      if (step.target === MsaidiziExecutionTarget.ERP) {
        const entry = erpEntries.get(step.capability);
        if (!entry) continue;
        schema = planningArgumentsSchema(entry);
      } else if (step.target === MsaidiziExecutionTarget.HOST) {
        const deviceId =
          typeof step.preconditions.deviceId === 'string' ? step.preconditions.deviceId : undefined;
        const device = deviceId ? devicesById.get(deviceId) : undefined;
        const descriptor = device
          ? findCapability(device.capabilityManifest, step.capability, step.capabilityVersion)
          : null;
        if (!descriptor) {
          throw new BadRequestException({
            code: 'DEVICE_CAPABILITY_UNAVAILABLE',
            message: `Step ${step.key} does not map to the selected active device/version`,
          });
        }
        if (
          capabilityDataClass(descriptor.dataClass) !== step.dataClass ||
          hostCapabilityEffect(descriptor.effect) !== step.expectedEffect
        ) {
          throw new BadRequestException({
            code: 'CAPABILITY_METADATA_MISMATCH',
            message: `Step ${step.key} data class or effect differs from the device manifest`,
          });
        }
        schema = descriptor.argumentsSchema;
      }
      if (!schema) continue;
      const issue = validateBoundCapabilityArguments(
        step.arguments,
        step.inputBindings ?? [],
        schema,
        inputs,
      )[0];
      if (issue) {
        throw new BadRequestException({
          code: issue.code,
          message: `Step ${step.key}: ${issue.message}`,
        });
      }
    }
  }

  /**
   * Validate a durable plan against the same permission and deployment
   * ceilings as the request-bound Msaidizi registry. A durable task must never
   * become a way for a user to borrow the service principal's wider grants.
   * Runtime task JWT validation repeats the live-user check immediately before
   * ERP dispatch so later revocations also take effect.
   */
  private validateStepAuthority(
    steps: MsaidiziPlanStepDto[],
    mode: MsaidiziTaskMode,
    user: AuthUser,
    mandateCapabilities?: Prisma.JsonValue,
  ): void {
    const capabilities = new Map(
      this.manifest.capabilities().map((capability) => [capability.id, capability]),
    );
    const allowedTiers = new Set(this.msaidizi.allowedTiers);
    const principalGrants = this.config.principalGrants;

    for (const step of steps) {
      const destinationAuthority = requestedExternalDestinationAuthority(
        step.capability,
        step.arguments,
      );
      if (destinationAuthority === 'invalid') {
        throw new BadRequestException(
          `Step ${step.key} has an invalid external destination authority contract`,
        );
      }
      if (
        mandateCapabilities !== undefined &&
        !(step.target === MsaidiziExecutionTarget.SELF_IMPROVEMENT
          ? mandateAuthorizesUpdateCandidateProposal(mandateCapabilities, step)
          : mandateAllowsStep(mandateCapabilities, step))
      ) {
        throw new BadRequestException(`Step ${step.key} is outside the selected mandate scope`);
      }
      if (mode === MsaidiziTaskMode.ASK && step.expectedEffect !== MsaidiziEffect.READ) {
        throw new BadRequestException(`Ask mode step ${step.key} must be read-only`);
      }

      if (step.target === MsaidiziExecutionTarget.HOST) {
        if (mode !== MsaidiziTaskMode.AUTOPILOT) {
          throw new BadRequestException(
            `Host step ${step.key} requires an explicit Autopilot mandate`,
          );
        }
        if (
          step.mutation &&
          (typeof step.preconditions.expectedPreStateSha256 !== 'string' ||
            !/^[0-9a-fA-F]{64}$/.test(step.preconditions.expectedPreStateSha256))
        ) {
          throw new BadRequestException(
            `Host mutation step ${step.key} requires a trusted expectedPreStateSha256 observation`,
          );
        }
        assertGovernedLocalSpeechStep(step);
        continue;
      }

      if (step.target === MsaidiziExecutionTarget.SELF_IMPROVEMENT) {
        if (mode !== MsaidiziTaskMode.AUTOPILOT) {
          throw new BadRequestException(
            `Self-improvement step ${step.key} requires an explicit Autopilot mandate`,
          );
        }
        try {
          assertUpdateCandidateProposalStep(step);
        } catch (error) {
          if (error instanceof UpdateCandidateProposalPolicyError) {
            throw new BadRequestException(
              `Self-improvement step ${step.key} is invalid: ${error.code}`,
            );
          }
          throw error;
        }
        continue;
      }

      const capability = capabilities.get(step.capability);
      if (!capability) {
        throw new BadRequestException(`ERP step ${step.key} capability is not available`);
      }
      if (capability.agentExcluded) {
        throw new BadRequestException(`ERP step ${step.key} capability is excluded from agents`);
      }
      if (!['permission', 'permission-any'].includes(capability.guard)) {
        throw new BadRequestException(`ERP step ${step.key} capability is not permission-gated`);
      }
      if (!allowedTiers.has(capability.tier)) {
        throw new BadRequestException(
          `ERP step ${step.key} exceeds the configured Msaidizi write ceiling`,
        );
      }
      if (capability.tier === 'red' && mode !== MsaidiziTaskMode.AUTOPILOT) {
        throw new BadRequestException(
          `ERP step ${step.key} requires the existing exact one-shot approval flow`,
        );
      }

      const declaredEffect = capabilityEffect(capability) as MsaidiziEffect;
      if (step.expectedEffect !== declaredEffect) {
        throw new BadRequestException(`ERP step ${step.key} effect does not match its capability`);
      }
      if (step.mutation !== (declaredEffect !== MsaidiziEffect.READ)) {
        throw new BadRequestException(
          `ERP step ${step.key} mutation classification does not match its capability`,
        );
      }
      if (
        !permissionSetAllows(principalGrants, capability.permissions, capability.anyPermissions)
      ) {
        throw new BadRequestException(
          `ERP step ${step.key} exceeds the service principal grant ceiling`,
        );
      }
      if (
        mode !== MsaidiziTaskMode.AUTOPILOT &&
        !permissionSetAllows(user.permissions, capability.permissions, capability.anyPermissions)
      ) {
        throw new BadRequestException(
          `ERP step ${step.key} is not permitted for the initiating user`,
        );
      }
    }
  }

  private async transition(
    task: TaskDetail,
    next: MsaidiziTaskStatus,
    user: AuthUser,
    data: Prisma.MsaidiziTaskUpdateManyMutationInput,
    additionalEvents: Array<{ type: string; payload: Record<string, unknown> }> = [],
  ) {
    const transitioned = await this.prisma.$transaction(async (tx) => {
      const won = await tx.msaidiziTask.updateMany({
        where: {
          id: task.id,
          status: task.status,
          stateVersion: task.stateVersion,
          ...(next === MsaidiziTaskStatus.QUEUED && {
            principal: { status: MsaidiziPrincipalStatus.ACTIVE },
          }),
        },
        data: { ...data, status: next, stateVersion: { increment: 1 } },
      });
      if (won.count !== 1) throw new ConflictException('Task state changed; refresh and retry');
      await this.appendEvent(tx, task.id, 'task.status_changed', user, {
        from: task.status,
        to: next,
        previousStateVersion: task.stateVersion,
      });
      for (const event of additionalEvents) {
        await this.appendEvent(tx, task.id, event.type, user, event.payload);
      }
      return this.findScopedTask(tx, task.id, user);
    });
    return jsonSafe(transitioned);
  }

  private async appendEvent(
    tx: Prisma.TransactionClient,
    taskId: string,
    type: string,
    user: AuthUser,
    payload: Record<string, unknown>,
  ) {
    await tx.msaidiziTaskEvent.create({
      data: {
        taskId,
        type,
        actorType: 'HUMAN',
        actorId: user.id,
        payload: persistedJson(payload),
      },
    });
  }

  private async findScopedTask(
    db: DatabaseClient,
    id: string,
    user: AuthUser,
  ): Promise<TaskDetail> {
    const task = await db.msaidiziTask.findFirst({
      where: { id, ...this.scopeFor(user) },
      include: TASK_DETAIL_INCLUDE,
    });
    if (!task) throw new NotFoundException('Msaidizi task not found');
    return task;
  }

  /**
   * PAUSED tasks can retain a broker-staged host action for explicit resume.
   * Route those (and any repaired legacy active step) through CANCELLING so the
   * durable dispatcher revokes the staged work before declaring cancellation.
   */
  private hasActiveRuntimeWork(task: TaskDetail): boolean {
    const activePlan = task.planVersions.find(
      (planVersion) => planVersion.version === task.activePlanVersion,
    );
    return (
      Boolean(
        activePlan?.steps.some((step) =>
          new Set<MsaidiziTaskStepStatus>([
            MsaidiziTaskStepStatus.LEASED,
            MsaidiziTaskStepStatus.RUNNING,
          ]).has(step.status),
        ),
      ) ||
      task.hostActions.some((action) =>
        new Set<MsaidiziHostActionStatus>([
          MsaidiziHostActionStatus.QUEUED,
          MsaidiziHostActionStatus.DISPATCHED,
          MsaidiziHostActionStatus.RUNNING,
        ]).has(action.status),
      )
    );
  }

  private async assertScopedTaskExists(id: string, user: AuthUser): Promise<void> {
    const task = await this.prisma.msaidiziTask.findFirst({
      where: { id, ...this.scopeFor(user) },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Msaidizi task not found');
  }

  private scopeFor(user: AuthUser): Prisma.MsaidiziTaskWhereInput {
    return {
      initiatedByUserId: user.id,
      ...this.taskCompanyScopeFor(user),
    };
  }

  private taskCompanyScopeFor(user: AuthUser): Prisma.MsaidiziTaskWhereInput {
    const companyScope = companyWhereForUser(user);
    return isGroupScopedUser(user) ? { OR: [{ companyId: null }, companyScope] } : companyScope;
  }

  private async liveEventViewer(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        },
        companyAccess: { select: { companyId: true, accessLevel: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('Msaidizi event access is no longer authorized');
    }

    const permissions = Array.from(
      new Set(
        user.userRoles.flatMap((userRole) =>
          userRole.role.rolePermissions.map((rolePermission) => rolePermission.permission.code),
        ),
      ),
    );
    if (!permissions.includes('msaidizi.use')) {
      throw new ForbiddenException('Msaidizi event access is no longer authorized');
    }
    const roleScopes = Array.from(new Set(user.userRoles.map((userRole) => userRole.role.scope)));
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: user.userRoles.map((userRole) => userRole.role.name),
      roleScopes,
      permissions,
      companyId: user.companyId,
      companyAccess: user.companyAccess,
    };
  }
}

function persistedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(sanitizePersistedValue(value).value)) as Prisma.InputJsonValue;
}

function persistableStepArguments(step: MsaidiziPlanStepDto): Prisma.InputJsonValue {
  const sanitized = persistableUpdateProposalStepArguments(step);
  const restored = restoreBoundNullPlaceholders(
    JSON.parse(JSON.stringify(sanitized)) as Record<string, unknown>,
    step.arguments,
    step.inputBindings ?? [],
  );
  return restored as Prisma.InputJsonValue;
}

function canonicalBindingJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

function lower(requested: number | undefined, ceiling: number): number {
  return Math.min(requested ?? ceiling, ceiling);
}

function lowerBigInt(requested: number | undefined, ceiling: bigint): bigint {
  return requested === undefined
    ? ceiling
    : requested < Number(ceiling)
      ? BigInt(requested)
      : ceiling;
}

function sameBudgets(left: ResolvedBudget, right: ResolvedBudget): boolean {
  return (
    left.maxWallTimeSeconds === right.maxWallTimeSeconds &&
    left.maxModelTurns === right.maxModelTurns &&
    left.maxAttemptedToolCalls === right.maxAttemptedToolCalls &&
    left.maxMutations === right.maxMutations &&
    left.maxLocalBytes === right.maxLocalBytes &&
    left.maxExternalEgressBytes === right.maxExternalEgressBytes &&
    Math.abs(left.maxModelCostUsd - right.maxModelCostUsd) < 0.0000001
  );
}

function proposalBudgetProjection(budget: ResolvedBudget): Record<string, number> {
  return {
    maxWallTimeSeconds: budget.maxWallTimeSeconds,
    maxModelTurns: budget.maxModelTurns,
    maxAttemptedToolCalls: budget.maxAttemptedToolCalls,
    maxMutations: budget.maxMutations,
    maxLocalBytes: Number(budget.maxLocalBytes),
    maxExternalEgressBytes: Number(budget.maxExternalEgressBytes),
    maxModelCostUsd: budget.maxModelCostUsd,
  };
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

function permissionSetAllows(
  granted: readonly string[],
  required: readonly string[],
  requiredAny: readonly string[],
): boolean {
  if (granted.includes('*')) return true;
  const set = new Set(granted);
  return (
    required.every((permission) => set.has(permission)) &&
    (requiredAny.length === 0 || requiredAny.some((permission) => set.has(permission)))
  );
}

function assertGovernedLocalSpeechStep(step: MsaidiziPlanStepDto): void {
  if (step.capability === RAW_MICROPHONE_CAPABILITY) {
    throw new BadRequestException(
      `Host step ${step.key} cannot serialize or broker raw microphone audio`,
    );
  }
  if (step.capability !== LOCAL_STT_CAPABILITY) return;
  const keys = Object.keys(step.arguments).sort();
  const duration = step.arguments.durationMilliseconds;
  const maximumCharacters = step.arguments.maxCharacters;
  const recognizerId = step.arguments.recognizerId;
  if (
    step.capabilityVersion !== '1.0.0' ||
    step.expectedEffect !== MsaidiziEffect.READ ||
    step.mutation ||
    step.dataClass !== 'Biometric' ||
    keys.length !== 3 ||
    keys[0] !== 'durationMilliseconds' ||
    keys[1] !== 'maxCharacters' ||
    keys[2] !== 'recognizerId' ||
    !Number.isSafeInteger(duration) ||
    Number(duration) < 100 ||
    Number(duration) > 30_000 ||
    !Number.isSafeInteger(maximumCharacters) ||
    Number(maximumCharacters) < 1 ||
    Number(maximumCharacters) > 32_768 ||
    typeof recognizerId !== 'string' ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(recognizerId)
  ) {
    throw new BadRequestException(
      `Host step ${step.key} must use the exact governed local transcription contract`,
    );
  }
}

function mandateAllowsStep(rawCapabilities: Prisma.JsonValue, step: MsaidiziPlanStepDto): boolean {
  if (!Array.isArray(rawCapabilities)) return false;
  const destinationAuthority = requestedExternalDestinationAuthority(
    step.capability,
    step.arguments,
  );
  if (destinationAuthority === 'invalid') return false;
  return rawCapabilities.some((entry) => {
    const grant = jsonRecord(entry);
    const effects = Array.isArray(grant.effects)
      ? grant.effects.filter((value): value is string => typeof value === 'string')
      : [];
    const dataClasses = Array.isArray(grant.dataClasses)
      ? grant.dataClasses.filter((value): value is string => typeof value === 'string')
      : [];
    return (
      grant.capability === step.capability &&
      (grant.version === undefined || grant.version === step.capabilityVersion) &&
      effects.includes(step.expectedEffect) &&
      (dataClasses.includes('*') || dataClasses.includes(step.dataClass)) &&
      grantAllowsExternalDestinationAuthority(grant, destinationAuthority)
    );
  });
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mandateBudgetNumber(
  budget: Record<string, unknown>,
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
    throw new BadRequestException(`Selected mandate has an invalid ${key} budget`);
  }
  return value;
}

function proposalLeaseRecoveryBlocked(): ConflictException {
  return new ConflictException({
    code: 'MSAIDIZI_PROPOSAL_LEASE_RECOVERY_BLOCKED',
    message:
      'The task draft has an unreconciled proposal marker; an overseer must inspect its accounting receipt',
  });
}

/** Converts values Nest/JSON cannot serialize (notably Prisma bigint fields). */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const toJSON = (value as { toJSON?: () => unknown }).toJSON;
    if (typeof toJSON === 'function') return jsonSafe(toJSON.call(value));
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}
