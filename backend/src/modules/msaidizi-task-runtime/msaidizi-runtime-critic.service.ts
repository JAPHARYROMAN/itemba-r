import { Injectable } from '@nestjs/common';
import {
  MsaidiziEffect,
  MsaidiziExecutionTarget,
  MsaidiziTaskStepStatus,
  Prisma,
} from '@prisma/client';
import { containsPersistedSecretWithGeneratedUpdateAllowance } from '../msaidizi-updates/update-candidate-proposal.port';
import { validateJsonSchema } from '../msaidizi-reasoning/msaidizi-policy-evaluator.service';
import { ManifestProvider } from '../msaidizi/manifest.provider';
import { buildToolDefinition } from '../msaidizi/tool-registry';
import { RuntimeReasoningDecision } from './msaidizi-runtime-reasoning.protocol';

export interface RuntimeAuthorizedStep {
  id: string;
  stepKey: string;
  sequence: number;
  name: string;
  target: MsaidiziExecutionTarget;
  capability: string;
  capabilityVersion: string;
  arguments: Prisma.JsonValue;
  dependencies: Prisma.JsonValue;
  expectedEffect: MsaidiziEffect;
  dataClass: string;
  preconditions: Prisma.JsonValue;
  recovery: Prisma.JsonValue | null;
  budgets: Prisma.JsonValue;
  stopConditions: Prisma.JsonValue;
  idempotent: boolean;
  mutation: boolean;
  status: MsaidiziTaskStepStatus;
}

export interface RuntimeMandateSnapshot {
  status: string;
  startsAt: Date | null;
  expiresAt: Date | null;
  capabilities: Prisma.JsonValue;
}

export interface RuntimeCriticIssue {
  code: string;
  stepKey?: string;
}

export interface CritiquedRuntimeReplanStep extends Omit<
  RuntimeAuthorizedStep,
  'arguments' | 'dependencies'
> {
  sequence: number;
  arguments: Prisma.InputJsonValue;
  dependencies: Prisma.InputJsonValue;
}

export interface RuntimeCriticReview {
  acceptable: boolean;
  issues: RuntimeCriticIssue[];
  replannedSteps: CritiquedRuntimeReplanStep[];
  skippedStepIds: string[];
}

/**
 * Structural authority check applied after every model decision. The model can
 * select only rows already present in the reviewed plan; the only data change
 * it can request is a fill into an empty field of an ERP read envelope.
 */
@Injectable()
export class MsaidiziRuntimeCritic {
  constructor(private readonly manifest: ManifestProvider) {}

  review(
    decision: RuntimeReasoningDecision,
    steps: RuntimeAuthorizedStep[],
    mandate: RuntimeMandateSnapshot | null,
    now = new Date(),
  ): RuntimeCriticReview {
    const issues: RuntimeCriticIssue[] = [];
    if (decision.decision === 'CONTINUE' && decision.outcome !== 'ON_TRACK') {
      issues.push({ code: 'CONTINUE_REQUIRES_ON_TRACK' });
    }
    if (decision.decision === 'REPLAN' && decision.outcome !== 'ON_TRACK') {
      issues.push({ code: 'REPLAN_REQUIRES_ON_TRACK' });
    }
    if (decision.decision === 'STOP' && decision.outcome === 'ON_TRACK') {
      issues.push({ code: 'STOP_REQUIRES_TERMINAL_OUTCOME' });
    }
    if (decision.decision !== 'REPLAN') {
      return {
        acceptable: issues.length === 0,
        issues,
        replannedSteps: [],
        skippedStepIds: [],
      };
    }

    const instruction = decision.replan!;
    const pendingStates = new Set<MsaidiziTaskStepStatus>([
      MsaidiziTaskStepStatus.PENDING,
      MsaidiziTaskStepStatus.READY,
    ]);
    const activeStates = new Set<MsaidiziTaskStepStatus>([
      MsaidiziTaskStepStatus.LEASED,
      MsaidiziTaskStepStatus.RUNNING,
    ]);
    const pending = steps.filter((step) => pendingStates.has(step.status));
    if (steps.some((step) => activeStates.has(step.status))) {
      issues.push({ code: 'REPLAN_WHILE_STEP_IN_FLIGHT' });
    }

    const orderedKeys = instruction.orderedPendingStepKeys;
    const skippedKeys = instruction.skippedPendingStepKeys;
    const supplied = [...orderedKeys, ...skippedKeys];
    if (new Set(supplied).size !== supplied.length) {
      issues.push({ code: 'REPLAN_DUPLICATE_STEP_KEY' });
    }
    const pendingKeys = pending.map((step) => step.stepKey).sort();
    if (!sameStrings([...supplied].sort(), pendingKeys)) {
      issues.push({ code: 'REPLAN_MUST_PARTITION_PENDING_STEPS' });
    }
    const pendingByKey = new Map(pending.map((step) => [step.stepKey, step]));
    const selected = orderedKeys
      .map((key) => pendingByKey.get(key))
      .filter((step): step is RuntimeAuthorizedStep => Boolean(step));
    if (selected.length === 0) issues.push({ code: 'REPLAN_MUST_RETAIN_PENDING_STEP' });
    const selectedKeys = new Set(selected.map((step) => step.stepKey));
    const succeededKeys = new Set(
      steps
        .filter((step) => step.status === MsaidiziTaskStepStatus.SUCCEEDED)
        .map((step) => step.stepKey),
    );
    const seen = new Set<string>();
    for (const step of selected) {
      for (const dependency of stringArray(step.dependencies)) {
        if (!succeededKeys.has(dependency) && !seen.has(dependency)) {
          issues.push({ code: 'REPLAN_DEPENDENCY_NOT_SATISFIED', stepKey: step.stepKey });
        }
      }
      seen.add(step.stepKey);
      if (!mandateAllows(mandate, step, now)) {
        issues.push({ code: 'REPLAN_MANDATE_AUTHORITY_MISSING', stepKey: step.stepKey });
      }
    }

    const fillsByKey = new Map<string, Record<string, unknown>>();
    for (const fill of instruction.readArgumentFills) {
      if (fillsByKey.has(fill.stepKey)) {
        issues.push({ code: 'REPLAN_DUPLICATE_READ_FILL', stepKey: fill.stepKey });
        continue;
      }
      fillsByKey.set(fill.stepKey, fill.values);
      const step = pendingByKey.get(fill.stepKey);
      if (!step || !selectedKeys.has(fill.stepKey)) {
        issues.push({ code: 'REPLAN_FILL_OUTSIDE_SELECTED_PENDING_STEP', stepKey: fill.stepKey });
        continue;
      }
      if (
        step.target !== MsaidiziExecutionTarget.ERP ||
        step.expectedEffect !== MsaidiziEffect.READ ||
        step.mutation
      ) {
        issues.push({ code: 'REPLAN_FILL_REQUIRES_ERP_READ', stepKey: fill.stepKey });
      }
    }

    const replannedSteps: CritiquedRuntimeReplanStep[] = [];
    for (const [index, step] of selected.entries()) {
      let argumentsValue = cloneJson(step.arguments) as Record<string, unknown>;
      const fill = fillsByKey.get(step.stepKey);
      if (fill) {
        const merged = fillEmptyFields(argumentsValue, fill);
        if (!merged.ok) {
          issues.push({ code: 'REPLAN_FILL_CHANGED_EXISTING_VALUE', stepKey: step.stepKey });
        } else {
          argumentsValue = merged.value;
          if (
            containsPersistedSecretWithGeneratedUpdateAllowance({
              ...step,
              arguments: argumentsValue,
            })
          ) {
            issues.push({ code: 'REPLAN_FILL_CONTAINS_SECRET', stepKey: step.stepKey });
          }
          const capability = this.manifest
            .capabilities()
            .find((candidate) => candidate.id === step.capability);
          if (!capability || !['GET', 'HEAD'].includes(capability.verb)) {
            issues.push({ code: 'REPLAN_READ_CAPABILITY_UNAVAILABLE', stepKey: step.stepKey });
          } else {
            const schema = buildToolDefinition(capability, 'runtime_read').input_schema;
            if (validateRuntimeArguments(argumentsValue, schema).length > 0) {
              issues.push({ code: 'REPLAN_FILL_SCHEMA_MISMATCH', stepKey: step.stepKey });
            }
          }
        }
      }
      const dependencies = stringArray(step.dependencies).filter((key) => selectedKeys.has(key));
      replannedSteps.push({
        ...step,
        sequence: index + 1,
        arguments: argumentsValue as Prisma.InputJsonValue,
        dependencies: dependencies as Prisma.InputJsonValue,
      });
    }

    const originalOrder = pending.map((step) => step.stepKey);
    const noOp =
      skippedKeys.length === 0 &&
      instruction.readArgumentFills.length === 0 &&
      sameStrings(orderedKeys, originalOrder);
    if (noOp) issues.push({ code: 'REPLAN_IS_NO_OP' });

    return {
      acceptable: issues.length === 0,
      issues,
      replannedSteps,
      skippedStepIds: pending
        .filter((step) => skippedKeys.includes(step.stepKey))
        .map((step) => step.id),
    };
  }
}

function mandateAllows(
  mandate: RuntimeMandateSnapshot | null,
  step: RuntimeAuthorizedStep,
  now: Date,
): boolean {
  if (
    !mandate ||
    mandate.status !== 'ACTIVE' ||
    (mandate.startsAt && mandate.startsAt > now) ||
    (mandate.expiresAt && mandate.expiresAt <= now) ||
    !Array.isArray(mandate.capabilities)
  ) {
    return false;
  }
  return mandate.capabilities.some((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const grant = raw as Prisma.JsonObject;
    const effects = stringArray(grant.effects);
    const dataClasses = stringArray(grant.dataClasses);
    return (
      grant.capability === step.capability &&
      (grant.version === undefined || grant.version === step.capabilityVersion) &&
      effects.includes(step.expectedEffect) &&
      (dataClasses.includes('*') || dataClasses.includes(step.dataClass))
    );
  });
}

function fillEmptyFields(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): { ok: boolean; value: Record<string, unknown> } {
  const allowedEnvelope = new Set(['path', 'query', 'body']);
  if (Object.keys(patch).some((key) => !allowedEnvelope.has(key)))
    return { ok: false, value: current };
  const result = cloneJson(current) as Record<string, unknown>;
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(source)) {
      const existing = target[key];
      if (existing === undefined || existing === null || existing === '') {
        target[key] = cloneJson(value);
        continue;
      }
      if (isObject(existing) && isObject(value)) {
        if (!merge(existing, value)) return false;
        continue;
      }
      if (canonical(existing) !== canonical(value)) return false;
    }
    return true;
  };
  return { ok: merge(result, patch), value: result };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function validateRuntimeArguments(
  value: Record<string, unknown>,
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  },
): string[] {
  const projected: Record<string, unknown> = {};
  const issues: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    if (Object.prototype.hasOwnProperty.call(schema.properties, key)) {
      projected[key] = entry;
    } else if (!isObject(entry) || Object.keys(entry).length > 0) {
      issues.push(`arguments.${key} is not accepted by the capability schema`);
    }
  }
  return [...issues, ...validateJsonSchema(projected, schema, 'arguments')];
}
