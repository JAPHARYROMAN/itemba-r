import { Injectable } from '@nestjs/common';
import { MsaidiziEffect, MsaidiziExecutionTarget, MsaidiziTaskMode } from '@prisma/client';
import {
  grantAllowsExternalDestinationAuthority,
  requestedExternalDestinationAuthority,
} from '../../common/policies/external-destination-authority';
import { AutonomyConfig } from '../msaidizi-tasks/autonomy.config';
import {
  assertUpdateCandidateProposalStep,
  containsPersistedSecretWithGeneratedUpdateAllowance,
  UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION,
  UPDATE_CANDIDATE_PROPOSAL_CAPABILITY,
} from '../msaidizi-updates/update-candidate-proposal.port';
import { validateStepStopConditions } from '../msaidizi-task-runtime/msaidizi-step-controls';
import {
  assertPlanInputBindings,
  MsaidiziInputBindingError,
} from '../msaidizi-tasks/msaidizi-input-bindings';
import type { MsaidiziPlanStepDto } from '../msaidizi-tasks/dto/msaidizi-task.dto';
import {
  bindingAuthorityIssues,
  bindingSafeDlpProjection,
} from '../msaidizi-tasks/msaidizi-binding-authority';
import {
  validateBoundCapabilityArguments,
  validateCapabilityJsonSchema,
} from '../msaidizi-tasks/msaidizi-bound-capability-schema';
import { isSupervisorBoundaryCapability } from './msaidizi-reasoning-context.service';
import {
  isUnavailableHostFileContentCapability,
  REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
} from '../msaidizi-devices/host-file-ephemerality.policy';
import {
  MandateCapabilityGrant,
  PolicyDecision,
  PolicyViolation,
  ProposedPlanDraft,
  ProposedPlanStep,
  ReasoningBudget,
  ReasoningCapability,
  ReasoningContext,
} from './msaidizi-reasoning.types';

export interface PlanPolicyInput {
  context: ReasoningContext;
  authorityDraft: ProposedPlanDraft;
  candidate: ProposedPlanDraft;
}

export abstract class MsaidiziPolicyEvaluator {
  abstract preflight(context: ReasoningContext): PolicyDecision;
  abstract evaluate(input: PlanPolicyInput): PolicyDecision;
}

@Injectable()
export class DeterministicMsaidiziPolicyEvaluator extends MsaidiziPolicyEvaluator {
  constructor(private readonly autonomy: AutonomyConfig) {
    super();
  }

  preflight(context: ReasoningContext): PolicyDecision {
    const violations = [...context.budgetViolations];
    if (context.mode === MsaidiziTaskMode.AUTOPILOT && !this.autonomy.autopilotEnabled) {
      violations.push(
        violation('AUTOPILOT_DISABLED', 'Autopilot is disabled by deployment policy'),
      );
    }
    if (context.requestedMandateId && !context.mandate) {
      violations.push(
        violation(
          'MANDATE_INACTIVE_OR_OUT_OF_SCOPE',
          'The requested mandate is not active in the caller and company scope',
        ),
      );
    }
    if (context.mode === MsaidiziTaskMode.AUTOPILOT && !context.mandate) {
      violations.push(
        violation('AUTOPILOT_MANDATE_REQUIRED', 'Autopilot proposals require an active mandate'),
      );
    }
    if (
      context.requestedDeviceId &&
      (!context.mandate?.deviceIds.includes(context.requestedDeviceId) ||
        !context.capabilities.some(
          (capability) =>
            capability.target === MsaidiziExecutionTarget.HOST &&
            capability.deviceId === context.requestedDeviceId,
        ))
    ) {
      violations.push(
        violation(
          'DEVICE_UNAVAILABLE_OR_MISMATCHED',
          'The requested device is not active with a mandate-allowed capability manifest',
        ),
      );
    }
    if (context.capabilities.length === 0) {
      violations.push(
        violation(
          'NO_PERMITTED_CAPABILITIES',
          'No permission-filtered capability is available for this proposal',
        ),
      );
    }
    return decision(violations, [
      'deployment-mode',
      'mandate-active-scope',
      'device-active-manifest',
      'task-budget-ceilings',
      'caller-capability-envelope',
    ]);
  }

  evaluate(input: PlanPolicyInput): PolicyDecision {
    const { context, authorityDraft, candidate } = input;
    const violations: PolicyViolation[] = [];
    const authorityByKey = new Map(authorityDraft.steps.map((step) => [step.key, step]));
    const candidateByKey = new Map<string, ProposedPlanStep>();
    if (candidate.steps.length === 0) {
      violations.push(violation('PLAN_HAS_NO_STEPS', 'The proposed task has no executable steps'));
    }

    for (const step of candidate.steps) {
      if (candidateByKey.has(step.key)) {
        violations.push(violation('DUPLICATE_STEP_KEY', 'Step keys must be unique', step.key));
      }
      candidateByKey.set(step.key, step);
      const authority = authorityByKey.get(step.key);
      if (!authority || lockedIdentity(authority) !== lockedIdentity(step)) {
        violations.push(
          violation(
            step.expectedEffect === MsaidiziEffect.READ
              ? 'UNPLANNED_STEP_IDENTITY'
              : 'UNPLANNED_WRITE',
            'A candidate step is outside the authority-only draft',
            step.key,
          ),
        );
      } else if (
        step.expectedEffect !== MsaidiziEffect.READ &&
        canonicalJson(authority.arguments) !== canonicalJson(step.arguments)
      ) {
        violations.push(
          violation(
            'UNTRUSTED_WRITE_ARGUMENT_CHANGE',
            'An effectful step changed after the authority-only planning phase',
            step.key,
          ),
        );
      }
      if (
        authority &&
        canonicalJson(authority.inputBindings) !== canonicalJson(step.inputBindings)
      ) {
        violations.push(
          violation(
            'UNTRUSTED_INPUT_BINDING_CHANGE',
            'Input bindings may be declared only by the authority planning phase',
            step.key,
          ),
        );
      }

      this.evaluateStep(context, step, violations);
    }

    if (
      candidate.steps.length !== authorityDraft.steps.length ||
      authorityDraft.steps.some((step) => !candidateByKey.has(step.key))
    ) {
      violations.push(
        violation(
          'PLAN_AUTHORITY_SET_CHANGED',
          'The candidate step set differs from the authority-only draft',
        ),
      );
    }
    validateGraph(candidate, violations);
    try {
      assertPlanInputBindings(candidate.steps as unknown as MsaidiziPlanStepDto[], context.inputs);
    } catch (error) {
      if (error instanceof MsaidiziInputBindingError) {
        violations.push(violation(error.code, error.message));
      } else {
        throw error;
      }
    }
    for (const issue of bindingAuthorityIssues(candidate.steps, context.inputs)) {
      violations.push(violation(issue.code, issue.message, issue.stepKey));
    }

    const mutationCount = candidate.steps.filter((step) => step.mutation).length;
    if (mutationCount > context.budgets.maxMutations) {
      violations.push(
        violation('TASK_MUTATION_BUDGET_EXCEEDED', 'Proposed mutations exceed the task budget'),
      );
    }
    if (candidate.steps.length > context.budgets.maxAttemptedToolCalls) {
      violations.push(
        violation(
          'TASK_TOOL_BUDGET_EXCEEDED',
          'The minimum proposed attempts exceed the task tool-attempt budget',
        ),
      );
    }
    if (containsPersistedSecretWithGeneratedUpdateAllowance(bindingSafeDlpProjection(candidate))) {
      violations.push(
        violation(
          'PERSISTENT_SECRET_DETECTED',
          'Credential-like data cannot cross the proposal or task persistence boundary',
        ),
      );
    }

    return decision(violations, [
      'authority-draft-lock',
      'authority-input-bindings',
      'permission-filter',
      'principal-grants',
      'mode-effect-ceiling',
      'manifest-schema',
      'mandate-capability-effect-data-class',
      'device-selection',
      'supervisor-boundary',
      'graph-integrity',
      'budget-envelope',
      'persistent-dlp',
    ]);
  }

  private evaluateStep(
    context: ReasoningContext,
    step: ProposedPlanStep,
    violations: PolicyViolation[],
  ): void {
    if (isUnavailableHostFileContentCapability(step.capability)) {
      violations.push(
        violation(
          REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY,
          'File content requires the separately governed ephemeral reread channel',
          step.key,
        ),
      );
      return;
    }
    if (step.target === MsaidiziExecutionTarget.SELF_IMPROVEMENT) {
      try {
        assertUpdateCandidateProposalStep(step);
      } catch {
        violations.push(
          violation(
            'SELF_IMPROVEMENT_SCHEMA_OR_BOUNDARY_DENIED',
            'Generated self-improvement must satisfy the exact v2 schema and protected boundary',
            step.key,
          ),
        );
      }
    }
    if (isSupervisorBoundaryCapability(step.capability)) {
      violations.push(
        violation(
          'SUPERVISOR_BOUNDARY_DENIED',
          'The trusted supervisor is outside Msaidizi authority',
          step.key,
        ),
      );
    }
    if (context.mode === MsaidiziTaskMode.ASK && step.expectedEffect !== MsaidiziEffect.READ) {
      violations.push(violation('ASK_MODE_WRITE_DENIED', 'ASK mode is read-only', step.key));
    }
    if (step.mutation !== (step.expectedEffect !== MsaidiziEffect.READ)) {
      violations.push(
        violation(
          'EFFECT_MUTATION_MISMATCH',
          'Mutation flag does not match the declared effect',
          step.key,
        ),
      );
    }
    if (step.mutation && (!step.recovery || Object.keys(step.recovery).length === 0)) {
      violations.push(
        violation(
          'RECOVERY_REQUIRED',
          'Every mutation needs an explicit recovery strategy',
          step.key,
        ),
      );
    }

    const deviceId =
      typeof step.preconditions.deviceId === 'string' ? step.preconditions.deviceId : undefined;
    const capability = context.capabilities.find(
      (candidate) =>
        candidate.target === step.target &&
        candidate.capability === step.capability &&
        candidate.capabilityVersion === step.capabilityVersion &&
        candidate.dataClass === step.dataClass &&
        (step.target !== MsaidiziExecutionTarget.HOST || candidate.deviceId === deviceId),
    );
    if (!capability) {
      violations.push(
        violation(
          step.target === MsaidiziExecutionTarget.HOST
            ? 'DEVICE_CAPABILITY_UNAVAILABLE'
            : 'CALLER_PERMISSION_DENIED',
          'The capability is outside the current permission-filtered manifest',
          step.key,
        ),
      );
      return;
    }
    this.evaluateCapabilityMatch(context, step, capability, violations);
  }

  private evaluateCapabilityMatch(
    context: ReasoningContext,
    step: ProposedPlanStep,
    capability: ReasoningCapability,
    violations: PolicyViolation[],
  ): void {
    if (
      step.expectedEffect !== capability.expectedEffect ||
      step.dataClass !== capability.dataClass ||
      step.mutation !== capability.mutation ||
      step.idempotent !== capability.idempotent
    ) {
      violations.push(
        violation(
          'CAPABILITY_METADATA_MISMATCH',
          'Effect, data class, mutation, or idempotency differs from the manifest',
          step.key,
        ),
      );
    }
    if (!hasPermissions(context.callerPermissions, capability)) {
      violations.push(
        violation('CALLER_PERMISSION_DENIED', 'Caller lacks the capability permission', step.key),
      );
    }
    if (
      capability.target === MsaidiziExecutionTarget.ERP &&
      !hasPermissions(context.principalPermissions, capability)
    ) {
      violations.push(
        violation(
          'PRINCIPAL_PERMISSION_DENIED',
          'The deployment-owned Msaidizi principal grant does not include this capability',
          step.key,
        ),
      );
    }
    const schemaIssues = validateBoundCapabilityArguments(
      step.arguments,
      step.inputBindings,
      capability.argumentsSchema,
      context.inputs,
    );
    for (const issue of schemaIssues.slice(0, 8)) {
      violations.push(violation(issue.code, issue.message, step.key));
    }

    const mandateRequired =
      context.mode === MsaidiziTaskMode.AUTOPILOT ||
      step.target === MsaidiziExecutionTarget.HOST ||
      context.requestedMandateId !== undefined;
    const destinationAuthority = requestedExternalDestinationAuthority(
      step.capability,
      step.arguments,
    );
    if (destinationAuthority === 'invalid') {
      violations.push(
        violation(
          'EXTERNAL_DESTINATION_AUTHORITY_INVALID',
          'Dynamic destination fields require the exact mandate_dynamic_https_v1 authority',
          step.key,
        ),
      );
    }
    if (
      mandateRequired &&
      (destinationAuthority === 'invalid' ||
        !mandateAllows(
          context.mandate?.capabilities ?? [],
          step.capability,
          step.capabilityVersion,
          step.expectedEffect,
          step.dataClass,
          destinationAuthority,
        ))
    ) {
      violations.push(
        violation(
          'MANDATE_CAPABILITY_MISMATCH',
          'The active mandate does not grant this capability/effect/data-class tuple',
          step.key,
        ),
      );
    }
    if (step.target === MsaidiziExecutionTarget.HOST) {
      const deviceId =
        typeof step.preconditions.deviceId === 'string' ? step.preconditions.deviceId : undefined;
      if (!deviceId || !context.mandate?.deviceIds.includes(deviceId)) {
        violations.push(
          violation(
            'HOST_DEVICE_SELECTION_REQUIRED',
            'A host step must select one active mandate device in preconditions.deviceId',
            step.key,
          ),
        );
      }
      if (context.requestedDeviceId && deviceId !== context.requestedDeviceId) {
        violations.push(
          violation(
            'REQUESTED_DEVICE_MISMATCH',
            'The host step selected a different device than the caller requested',
            step.key,
          ),
        );
      }
    }
    validateStepBudgets(step, context.budgets, violations);
    const stopConditions = validateStepStopConditions(step.stopConditions);
    if (!stopConditions.ok) {
      violations.push(violation(stopConditions.code, stopConditions.detail, step.key));
    }
    if (
      step.expectedEffect === MsaidiziEffect.EXTERNAL &&
      context.budgets.maxExternalEgressBytes === 0
    ) {
      violations.push(
        violation('EXTERNAL_EGRESS_BUDGET_EXHAUSTED', 'External egress budget is zero', step.key),
      );
    }
  }
}

function hasPermissions(grantedValues: string[], capability: ReasoningCapability): boolean {
  const granted = new Set(grantedValues);
  if (granted.has('*')) return true;
  if (!capability.permissions.every((permission) => granted.has(permission))) return false;
  return (
    capability.anyPermissions.length === 0 ||
    capability.anyPermissions.some((permission) => granted.has(permission))
  );
}

function mandateAllows(
  grants: MandateCapabilityGrant[],
  capability: string,
  version: string,
  effect: MsaidiziEffect,
  dataClass: string,
  destinationAuthority: Exclude<
    ReturnType<typeof requestedExternalDestinationAuthority>,
    'invalid'
  >,
): boolean {
  return grants.some(
    (grant) =>
      grant.capability === capability &&
      (capability === UPDATE_CANDIDATE_PROPOSAL_CAPABILITY &&
      version === UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION
        ? grant.version === UPDATE_CANDIDATE_GENERATION_CAPABILITY_VERSION
        : grant.version === undefined || grant.version === version) &&
      grant.effects.includes(effect) &&
      grant.dataClasses.includes(dataClass) &&
      grantAllowsExternalDestinationAuthority(
        grant as unknown as Record<string, unknown>,
        destinationAuthority,
      ),
  );
}

function validateStepBudgets(
  step: ProposedPlanStep,
  task: ReasoningBudget,
  violations: PolicyViolation[],
): void {
  const allowed = new Set(Object.keys(task));
  for (const [key, value] of Object.entries(step.budgets)) {
    if (!allowed.has(key)) {
      violations.push(
        violation('STEP_BUDGET_KEY_UNSUPPORTED', `Unsupported step budget ${key}`, step.key),
      );
      continue;
    }
    const ceiling = task[key as keyof ReasoningBudget];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > ceiling) {
      violations.push(
        violation('STEP_BUDGET_MISMATCH', `Step budget ${key} exceeds its task ceiling`, step.key),
      );
    }
  }
}

function validateGraph(plan: ProposedPlanDraft, violations: PolicyViolation[]): void {
  const keys = new Set(plan.steps.map((step) => step.key));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byKey = new Map(plan.steps.map((step) => [step.key, step]));
  for (const step of plan.steps) {
    for (const dependency of step.dependsOn) {
      if (!keys.has(dependency) || dependency === step.key) {
        violations.push(
          violation(
            'INVALID_STEP_DEPENDENCY',
            'Step dependency is missing or self-referential',
            step.key,
          ),
        );
      }
    }
  }
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      violations.push(violation('CYCLIC_PLAN', 'The proposed task graph contains a cycle', key));
      return;
    }
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      if (byKey.has(dependency)) visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
}

export function validateJsonSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
): string[] {
  return validateCapabilityJsonSchema(value, schema, path);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function lockedIdentity(step: ProposedPlanStep): string {
  return [
    step.key,
    step.target,
    step.capability,
    step.capabilityVersion,
    step.expectedEffect,
    step.dataClass,
    String(step.mutation),
    String(step.idempotent),
  ].join('\0');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function violation(code: string, message: string, stepKey?: string): PolicyViolation {
  return { code, message, ...(stepKey && { stepKey }) };
}

function decision(violations: PolicyViolation[], checks: string[]): PolicyDecision {
  return { allowed: violations.length === 0, violations, checks };
}
