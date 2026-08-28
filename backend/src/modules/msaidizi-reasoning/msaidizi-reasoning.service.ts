import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import { MsaidiziConfig } from '../msaidizi/msaidizi.config';
import { ProposeMsaidiziTaskDto } from './dto/msaidizi-reasoning.dto';
import { MsaidiziCritic } from './msaidizi-critic.service';
import { MsaidiziOutcomeEvaluator } from './msaidizi-outcome-evaluator.service';
import { MsaidiziPlanner } from './msaidizi-planner.service';
import { MsaidiziPolicyEvaluator } from './msaidizi-policy-evaluator.service';
import { MsaidiziProposalUsageService } from './msaidizi-proposal-usage.service';
import { MsaidiziReasoningContextService } from './msaidizi-reasoning-context.service';
import { MSAIDIZI_REASONING_LIMITS } from './msaidizi-reasoning.limits';
import { ProposedPlanStep } from './msaidizi-reasoning.types';
import { StructuredModelOutputError } from './strict-model-json';
import { bindingSafeDlpProjection } from '../msaidizi-tasks/msaidizi-binding-authority';
import { msaidiziProposalDigest } from '../msaidizi-tasks/msaidizi-proposal-digest';

@Injectable()
export class MsaidiziReasoningService {
  constructor(
    private readonly msaidizi: MsaidiziConfig,
    private readonly autonomy: AutonomyConfig,
    private readonly contextBuilder: MsaidiziReasoningContextService,
    private readonly planner: MsaidiziPlanner,
    private readonly policy: MsaidiziPolicyEvaluator,
    private readonly critic: MsaidiziCritic,
    private readonly outcome: MsaidiziOutcomeEvaluator,
    private readonly proposalUsage: MsaidiziProposalUsageService,
  ) {}

  async propose(dto: ProposeMsaidiziTaskDto, user: AuthUser) {
    if (!this.msaidizi.enabled) {
      throw new ServiceUnavailableException('Msaidizi is disabled by deployment policy');
    }
    if (!this.autonomy.enabled) {
      throw new ServiceUnavailableException('Durable Msaidizi autonomy is disabled');
    }

    const context = await this.contextBuilder.resolve(dto, user);
    try {
      return await this.proposeWithResolvedContext(dto, user, context);
    } finally {
      for (const artifact of context.artifacts ?? []) artifact.content.fill(0);
    }
  }

  private async proposeWithResolvedContext(
    dto: ProposeMsaidiziTaskDto,
    user: AuthUser,
    context: Awaited<ReturnType<MsaidiziReasoningContextService['resolve']>>,
  ) {
    const preflight = this.policy.preflight(context);
    if (!preflight.allowed)
      throwPolicy('MSAIDIZI_PROPOSAL_PREFLIGHT_REJECTED', preflight.violations);

    // The reservation commits before the first provider request. It is scoped
    // to this caller/company and remains charged even when the proposal is
    // abandoned, rejected downstream, or the process dies before settlement.
    const reservation = await this.proposalUsage.reserve({
      userId: user.id,
      companyId: context.companyId ?? null,
      mode: context.mode,
      model: this.msaidizi.model,
      requestDigest: digest(sanitizePersistedValue(dto).value),
      ...(context.draftAuthority && { draftAuthority: context.draftAuthority }),
    });
    if (context.draftAuthority && !reservation.draftLease) {
      throw new ServiceUnavailableException({
        code: 'MSAIDIZI_PROPOSAL_LEASE_MISSING',
        message: 'The proposal reservation did not return its exact task lease',
      });
    }

    let planned;
    const providerDeadline = new AbortController();
    const providerTimeout = setTimeout(
      () => providerDeadline.abort(),
      Math.max(1, Math.min(reservation.reservationExpiresAt.getTime() - Date.now(), 2_147_483_647)),
    );
    providerTimeout.unref?.();
    try {
      planned = await this.planner.propose(context, providerDeadline.signal);
    } catch (error) {
      await this.proposalUsage
        .settleFailure(
          reservation.id,
          proposalFailureCode(error),
          undefined,
          reservation.draftLease,
        )
        .catch(() => undefined);
      if (error instanceof StructuredModelOutputError) {
        throw new BadGatewayException({
          code: error.code,
          message: error.message,
        });
      }
      throw new ServiceUnavailableException({
        code: 'MSAIDIZI_REASONING_PROVIDER_UNAVAILABLE',
        message: 'The configured reasoning provider did not complete the proposal',
      });
    } finally {
      clearTimeout(providerTimeout);
    }

    try {
      const policy = this.policy.evaluate({
        context,
        authorityDraft: planned.authorityDraft,
        candidate: planned.candidate,
      });
      if (!policy.allowed) throwPolicy('MSAIDIZI_PROPOSAL_POLICY_REJECTED', policy.violations);

      const critique = this.critic.review(planned.candidate, context);
      if (!critique.acceptable) {
        throw new UnprocessableEntityException({
          code: 'MSAIDIZI_PROPOSAL_CRITIC_REJECTED',
          issues: critique.issues,
        });
      }
      const outcome = this.outcome.evaluateProposal(planned.candidate);
      const plan = {
        ...(context.draftTaskId && { taskId: context.draftTaskId }),
        title: planned.candidate.title.trim(),
        objective: context.objective,
        summary: planned.candidate.summary.trim(),
        mode: context.mode,
        ...(context.companyId && { companyId: context.companyId }),
        ...(context.mandate && { mandateId: context.mandate.id }),
        inputs: {
          ...context.inputs,
          ...(context.artifacts?.length && {
            _msaidiziArtifactProvenance: context.artifacts.map((artifact) => ({
              artifactId: artifact.id,
              sourceTaskId: artifact.sourceTaskId,
              sha256: artifact.sha256,
              mimeType: artifact.mimeType,
              dataClass: artifact.dataClass,
              trustLevel: 'UNTRUSTED',
              provenance: artifact.provenance,
            })),
          }),
        },
        stopConditions: context.stopConditions,
        budgets: context.budgets,
        steps: planned.candidate.steps.map(presentStep),
      };
      const dlpInspection = sanitizePersistedValue(bindingSafeDlpProjection(plan));
      if (dlpInspection.redactionsApplied) {
        // Model output was checked earlier; reaching this branch means a field
        // added during assembly crossed the persistence DLP boundary unexpectedly.
        throw new UnprocessableEntityException({
          code: 'MSAIDIZI_PROPOSAL_DLP_REJECTED',
          message: 'The assembled proposal contained credential-like data',
        });
      }
      const proposalDigest = msaidiziProposalDigest(plan);
      const usageReceipt = await this.proposalUsage.settleSuccess(
        reservation.id,
        proposalDigest,
        {
          modelTurns: planned.modelTurns,
          usage: planned.usage,
        },
        reservation.draftLease,
      );

      return {
        status: 'PROPOSED',
        draftTaskId: context.draftTaskId ?? null,
        proposalDigest,
        proposalUsageReceipt: {
          id: usageReceipt.id,
          expiresAt: usageReceipt.expiresAt.toISOString(),
          modelTurns: usageReceipt.modelTurns,
          inputTokens: usageReceipt.inputTokens.toString(),
          outputTokens: usageReceipt.outputTokens.toString(),
          estimatedCostUsd: usageReceipt.estimatedCostUsd,
          oneUse: true,
        },
        persisted: false,
        queued: false,
        executed: false,
        plan,
        policy,
        critique,
        outcome,
        reasoningUsage: {
          model: this.msaidizi.model,
          modelTurns: planned.modelTurns,
          maxOutputTokensPerTurn: MSAIDIZI_REASONING_LIMITS.maxOutputTokensPerTurn,
          ...planned.usage,
          estimatedCostUsd: usageReceipt.estimatedCostUsd,
          providerReportedCostUsd: null,
          billingNote:
            'The task ledger uses deployment-owned conservative token prices; provider billing remains authoritative.',
        },
        provenance: {
          callerPermissionFiltered: true,
          mandateId: context.mandate?.id ?? null,
          deviceIds: Array.from(
            new Set(
              planned.candidate.steps
                .map((step) => step.preconditions.deviceId)
                .filter((value): value is string => typeof value === 'string'),
            ),
          ),
          memories: context.memories.map((memory) => ({
            id: memory.id,
            scopeKey: memory.scopeKey,
            contentDigest: memory.contentDigest,
            trustLevel: memory.trustLevel,
            sourceType: memory.sourceType,
          })),
          artifacts: (context.artifacts ?? []).map((artifact) => ({
            id: artifact.id,
            sourceTaskId: artifact.sourceTaskId,
            sha256: artifact.sha256,
            mimeType: artifact.mimeType,
            dataClass: artifact.dataClass,
            trustLevel: 'UNTRUSTED',
            provenance: artifact.provenance,
          })),
          untrustedEnrichmentUsed: planned.untrustedEnrichmentUsed,
          redactionsAppliedBeforeReasoning: context.redactionsApplied,
        },
        requiredExplicitActions: {
          selectedMode: context.mode,
          save: {
            method: 'POST',
            path: '/msaidizi/tasks/plan',
            body: context.draftTaskId
              ? `Attach the reviewed plan to taskId ${context.draftTaskId} with this exact proposalUsageId and proposalDigest before the receipt expires`
              : 'Use the reviewed plan with this exact proposalUsageId and proposalDigest before the receipt expires',
          },
          queue: {
            method: 'POST',
            path: '/msaidizi/tasks',
            body: '{"taskId":"<saved task id>"}',
            prerequisite: 'A separate successful save response',
          },
        },
        limits: {
          ...MSAIDIZI_REASONING_LIMITS,
          memoryRetrieval: 'bounded lexical ranking; no embedding/vector recall',
          proposalDurability:
            'the plan is not persisted; its one-use metering receipt is durable and quota-accounted',
          costAccounting:
            'reserved before provider dispatch, settled to reported tokens, and inherited by a saved task',
        },
      };
    } catch (error) {
      await this.proposalUsage
        .settleFailure(
          reservation.id,
          proposalFailureCode(error),
          {
            modelTurns: planned.modelTurns,
            usage: planned.usage,
          },
          reservation.draftLease,
        )
        .catch(() => undefined);
      throw error;
    }
  }
}

function presentStep(step: ProposedPlanStep) {
  return {
    key: step.key,
    name: step.name.trim(),
    target: step.target,
    capability: step.capability,
    capabilityVersion: step.capabilityVersion,
    arguments: step.arguments,
    dependsOn: step.dependsOn,
    inputBindings: step.inputBindings,
    expectedEffect: step.expectedEffect,
    dataClass: step.dataClass,
    preconditions: step.preconditions,
    ...(step.recovery && { recovery: step.recovery }),
    budgets: step.budgets,
    stopConditions: step.stopConditions,
    idempotent: step.idempotent,
    mutation: step.mutation,
  };
}

function throwPolicy(code: string, violations: unknown): never {
  throw new UnprocessableEntityException({ code, violations });
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function proposalFailureCode(error: unknown): string {
  if (error instanceof StructuredModelOutputError) return error.code;
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: unknown }).response;
    if (response && typeof response === 'object' && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return 'MSAIDIZI_PROPOSAL_FAILED';
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
