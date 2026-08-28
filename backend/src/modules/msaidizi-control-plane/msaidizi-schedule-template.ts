import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { MsaidiziEffect, MsaidiziExecutionTarget, MsaidiziTaskMode, Prisma } from '@prisma/client';
import { normaliseHttpActionEnvelope } from '../../common/utils/action-envelope';
import {
  grantAllowsExternalDestinationAuthority,
  requestedExternalDestinationAuthority,
} from '../../common/policies/external-destination-authority';
import { containsPersistedSecretWithGeneratedUpdateAllowance } from '../msaidizi-updates/update-candidate-proposal.port';
import {
  assertUpdateCandidateProposalStep,
  mandateAuthorizesUpdateCandidateProposal,
} from '../msaidizi-updates/update-candidate-proposal.port';
import {
  MsaidiziPlanStepDto,
  MsaidiziTaskBudgetDto,
  PlanMsaidiziTaskDto,
} from '../msaidizi-tasks/dto/msaidizi-task.dto';

const TEMPLATE_KEYS = new Set([
  'title',
  'objective',
  'summary',
  'inputs',
  'stopConditions',
  'budgets',
  'steps',
]);

export interface ValidatedScheduleTaskTemplate {
  title: string;
  objective: string;
  summary: string;
  inputs: Record<string, unknown>;
  stopConditions: Record<string, unknown>;
  budgets?: MsaidiziTaskBudgetDto;
  steps: MsaidiziPlanStepDto[];
}

export class MsaidiziScheduleTemplateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MsaidiziScheduleTemplateError';
  }
}

/**
 * Converts an operator-authored routine template into the same strict task
 * shape used by the interactive planning endpoint. Identity, authority, mode,
 * schedule, and idempotency fields are intentionally not template-controlled.
 */
export function validateScheduleTaskTemplate(value: unknown): ValidatedScheduleTaskTemplate {
  if (!isRecord(value)) {
    throw new MsaidiziScheduleTemplateError(
      'TEMPLATE_NOT_OBJECT',
      'taskTemplate must be an object',
    );
  }
  const unexpected = Object.keys(value).filter((key) => !TEMPLATE_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new MsaidiziScheduleTemplateError(
      'TEMPLATE_AUTHORITY_FIELD',
      `taskTemplate contains unsupported fields: ${unexpected.sort().join(', ')}`,
    );
  }
  if (containsPersistedSecretWithGeneratedUpdateAllowance(value)) {
    throw new MsaidiziScheduleTemplateError(
      'TEMPLATE_CONTAINS_SECRET',
      'taskTemplate contains credential-like data; use a supervisor-owned secret reference',
    );
  }

  const candidate = plainToInstance(PlanMsaidiziTaskDto, {
    title: value.title,
    objective: value.objective,
    summary: value.summary,
    mode: MsaidiziTaskMode.AUTOPILOT,
    inputs: value.inputs ?? {},
    stopConditions: value.stopConditions ?? {},
    budgets: value.budgets,
    steps: value.steps,
  });
  const errors = validateSync(candidate, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    throw new MsaidiziScheduleTemplateError(
      'TEMPLATE_SCHEMA_INVALID',
      `taskTemplate is invalid: ${firstValidationIssue(errors)}`,
    );
  }

  validateGraph(candidate.steps);
  return {
    title: candidate.title.trim(),
    objective: candidate.objective.trim(),
    summary: (candidate.summary ?? candidate.objective).trim(),
    inputs: candidate.inputs,
    stopConditions: candidate.stopConditions,
    budgets: candidate.budgets,
    steps: candidate.steps,
  };
}

export function assertTemplateWithinMandate(
  template: ValidatedScheduleTaskTemplate,
  rawCapabilities: Prisma.JsonValue,
): void {
  const grants: MandateCapability[] = Array.isArray(rawCapabilities)
    ? (rawCapabilities as unknown[]).filter(isMandateCapability)
    : [];
  for (const step of template.steps) {
    let allowed: boolean;
    if (step.target === MsaidiziExecutionTarget.SELF_IMPROVEMENT) {
      try {
        assertUpdateCandidateProposalStep(step);
        allowed = mandateAuthorizesUpdateCandidateProposal(rawCapabilities, step);
      } catch {
        allowed = false;
      }
    } else {
      const destinationAuthority = requestedExternalDestinationAuthority(
        step.capability,
        step.arguments,
      );
      allowed =
        destinationAuthority !== 'invalid' &&
        grants.some(
          (grant) =>
            grant.capability === step.capability &&
            (grant.version === undefined || grant.version === step.capabilityVersion) &&
            grant.effects.includes(step.expectedEffect) &&
            (grant.dataClasses.includes('*') || grant.dataClasses.includes(step.dataClass)) &&
            grantAllowsExternalDestinationAuthority(grant, destinationAuthority),
        );
    }
    if (!allowed) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_OUTSIDE_MANDATE',
        `taskTemplate step ${step.key} is outside the mandate capability scope`,
      );
    }
  }
}

function validateGraph(steps: MsaidiziPlanStepDto[]): void {
  const byKey = new Map<string, MsaidiziPlanStepDto>();
  for (const step of steps) {
    if (byKey.has(step.key)) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_DUPLICATE_STEP',
        'step keys must be unique',
      );
    }
    if (step.expectedEffect === MsaidiziEffect.READ && step.mutation) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_EFFECT_MISMATCH',
        `read step ${step.key} cannot be marked as a mutation`,
      );
    }
    if (step.expectedEffect !== MsaidiziEffect.READ && !step.mutation) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_EFFECT_MISMATCH',
        `effectful step ${step.key} must be marked as a mutation`,
      );
    }
    if (
      step.target === MsaidiziExecutionTarget.ERP &&
      !/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(step.capability)
    ) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_CAPABILITY_INVALID',
        `ERP step ${step.key} must use Controller.handler identity`,
      );
    }
    if (
      step.target === MsaidiziExecutionTarget.ERP &&
      !normaliseHttpActionEnvelope(step.arguments)
    ) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_ARGUMENTS_INVALID',
        `ERP step ${step.key} must use the exact { path, query, body } envelope`,
      );
    }
    byKey.set(step.key, step);
  }

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!byKey.has(dependency) || dependency === step.key) {
        throw new MsaidiziScheduleTemplateError(
          'TEMPLATE_DEPENDENCY_INVALID',
          `step ${step.key} has an invalid dependency`,
        );
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new MsaidiziScheduleTemplateError(
        'TEMPLATE_CYCLE',
        'taskTemplate steps must form an acyclic graph',
      );
    }
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) visit(key);
}

function firstValidationIssue(errors: ValidationError[]): string {
  const queue = [...errors];
  while (queue.length > 0) {
    const error = queue.shift()!;
    const message = Object.values(error.constraints ?? {})[0];
    if (message) return `${error.property} ${message}`;
    queue.push(...(error.children ?? []));
  }
  return 'schema validation failed';
}

interface MandateCapability extends Record<string, unknown> {
  capability: string;
  version?: string;
  effects: MsaidiziEffect[];
  dataClasses: string[];
  externalDestinationAuthorities?: unknown;
}

function isMandateCapability(value: unknown): value is MandateCapability {
  return (
    isRecord(value) &&
    typeof value.capability === 'string' &&
    (value.version === undefined || typeof value.version === 'string') &&
    Array.isArray(value.effects) &&
    value.effects.every((effect) =>
      Object.values(MsaidiziEffect).includes(effect as MsaidiziEffect),
    ) &&
    Array.isArray(value.dataClasses) &&
    value.dataClasses.every((dataClass) => typeof dataClass === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
