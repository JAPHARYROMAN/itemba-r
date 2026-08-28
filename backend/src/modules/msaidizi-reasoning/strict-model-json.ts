import { MsaidiziEffect, MsaidiziExecutionTarget } from '@prisma/client';
import { ModelResponse } from '../msaidizi/model-client';
import { containsPersistedSecretWithGeneratedUpdateAllowance } from '../msaidizi-updates/update-candidate-proposal.port';
import { MSAIDIZI_REASONING_LIMITS } from './msaidizi-reasoning.limits';
import { JsonObject, ProposedPlanDraft } from './msaidizi-reasoning.types';
import {
  MSAIDIZI_INPUT_BINDING_SOURCE_KINDS,
  MSAIDIZI_INPUT_BINDING_TRANSFORMS,
  MSAIDIZI_INPUT_BINDING_VALUE_TYPES,
  MsaidiziInputBindingDto,
} from '../msaidizi-tasks/dto/msaidizi-task.dto';
import { bindingSafeDlpProjection } from '../msaidizi-tasks/msaidizi-binding-authority';

export class StructuredModelOutputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StructuredModelOutputError';
  }
}

/** Parse one provider response as one bare JSON object with no tool calls or prose. */
export function parseStrictPlanResponse(response: ModelResponse): ProposedPlanDraft {
  const value = parseStrictResponseObject(response);
  exactKeys(value, ['title', 'summary', 'steps'], 'plan');
  const title = boundedString(value.title, 'plan.title', 1, 160);
  const summary = boundedString(value.summary, 'plan.summary', 1, 2_000);
  const rawSteps = array(value.steps, 'plan.steps');
  if (rawSteps.length > MSAIDIZI_REASONING_LIMITS.maxPlanSteps) {
    fail('MODEL_PLAN_TOO_LARGE', 'Model plan exceeds the proposal step limit');
  }

  const steps = rawSteps.map((raw, index) => {
    const step = object(raw, `plan.steps[${index}]`);
    exactKeys(
      step,
      [
        'key',
        'name',
        'target',
        'capability',
        'capabilityVersion',
        'arguments',
        'dependsOn',
        'inputBindings',
        'expectedEffect',
        'dataClass',
        'preconditions',
        'recovery',
        'budgets',
        'stopConditions',
        'idempotent',
        'mutation',
      ],
      `plan.steps[${index}]`,
    );
    const key = boundedString(step.key, `plan.steps[${index}].key`, 1, 64);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key)) {
      fail('MODEL_SCHEMA_INVALID', `Invalid model step key at index ${index}`);
    }
    const target = enumValue(
      step.target,
      Object.values(MsaidiziExecutionTarget),
      `plan.steps[${index}].target`,
    );
    const expectedEffect = enumValue(
      step.expectedEffect,
      Object.values(MsaidiziEffect),
      `plan.steps[${index}].expectedEffect`,
    );
    const dependsOn = array(step.dependsOn, `plan.steps[${index}].dependsOn`).map(
      (value, dependencyIndex) =>
        boundedString(value, `plan.steps[${index}].dependsOn[${dependencyIndex}]`, 1, 64),
    );
    if (new Set(dependsOn).size !== dependsOn.length) {
      fail('MODEL_SCHEMA_INVALID', `Duplicate dependency in model step ${key}`);
    }
    const inputBindings = array(step.inputBindings, `plan.steps[${index}].inputBindings`).map(
      (value, bindingIndex) =>
        parseInputBinding(value, `plan.steps[${index}].inputBindings[${bindingIndex}]`),
    );
    if (inputBindings.length > 100) {
      fail('MODEL_SCHEMA_INVALID', `Model step ${key} has too many input bindings`);
    }
    const recovery =
      step.recovery === null ? null : object(step.recovery, `plan.steps[${index}].recovery`);

    return {
      key,
      name: boundedString(step.name, `plan.steps[${index}].name`, 1, 160),
      target,
      capability: boundedString(step.capability, `plan.steps[${index}].capability`, 1, 180),
      capabilityVersion: boundedString(
        step.capabilityVersion,
        `plan.steps[${index}].capabilityVersion`,
        1,
        32,
      ),
      arguments: object(step.arguments, `plan.steps[${index}].arguments`),
      dependsOn,
      inputBindings,
      expectedEffect,
      dataClass: boundedString(step.dataClass, `plan.steps[${index}].dataClass`, 1, 64),
      preconditions: object(step.preconditions, `plan.steps[${index}].preconditions`),
      recovery,
      budgets: object(step.budgets, `plan.steps[${index}].budgets`),
      stopConditions: object(step.stopConditions, `plan.steps[${index}].stopConditions`),
      idempotent: boolean(step.idempotent, `plan.steps[${index}].idempotent`),
      mutation: boolean(step.mutation, `plan.steps[${index}].mutation`),
    };
  });

  assertNoPersistedSecret({ title, summary, steps });
  return { title, summary, steps };
}

function parseInputBinding(value: unknown, path: string): MsaidiziInputBindingDto {
  const binding = object(value, path);
  exactKeys(
    binding,
    ['targetPath', 'source', 'dataClass', 'expectedType', 'expectedSchema', 'transform'],
    path,
  );
  const source = object(binding.source, `${path}.source`);
  const kind = enumValue(source.kind, MSAIDIZI_INPUT_BINDING_SOURCE_KINDS, `${path}.source.kind`);
  const sourceKeys: string[] = ['kind', 'path'];
  if (kind.startsWith('DEPENDENCY_')) sourceKeys.push('dependencyStepKey');
  if (kind === 'DEPENDENCY_ARTIFACT' && source.artifactId !== undefined) {
    sourceKeys.push('artifactId');
  }
  if (kind === 'SECRET_REFERENCE') {
    sourceKeys.push('secretReferenceId', 'secretReferenceSha256', 'scope');
  }
  exactKeys(source, sourceKeys, `${path}.source`);
  const sourcePath = boundedString(source.path, `${path}.source.path`, 0, 512);
  const parsedSource: MsaidiziInputBindingDto['source'] = { kind, path: sourcePath };
  if (kind.startsWith('DEPENDENCY_')) {
    parsedSource.dependencyStepKey = boundedString(
      source.dependencyStepKey,
      `${path}.source.dependencyStepKey`,
      1,
      64,
    );
  }
  if (kind === 'DEPENDENCY_ARTIFACT' && source.artifactId !== undefined) {
    parsedSource.artifactId = uuid(source.artifactId, `${path}.source.artifactId`);
  }
  if (kind === 'SECRET_REFERENCE') {
    parsedSource.secretReferenceId = uuid(
      source.secretReferenceId,
      `${path}.source.secretReferenceId`,
    );
    parsedSource.secretReferenceSha256 = sha256(
      source.secretReferenceSha256,
      `${path}.source.secretReferenceSha256`,
    );
    const scope = object(source.scope, `${path}.source.scope`);
    const optionalScopeKeys = ['deviceId', 'companyId'].filter((key) => scope[key] !== undefined);
    exactKeys(
      scope,
      ['capability', 'capabilityVersion', 'dataClass', ...optionalScopeKeys],
      `${path}.source.scope`,
    );
    parsedSource.scope = {
      capability: boundedString(scope.capability, `${path}.source.scope.capability`, 1, 180),
      capabilityVersion: boundedString(
        scope.capabilityVersion,
        `${path}.source.scope.capabilityVersion`,
        1,
        32,
      ),
      dataClass: boundedString(scope.dataClass, `${path}.source.scope.dataClass`, 1, 64),
      ...(scope.deviceId !== undefined && {
        deviceId: uuid(scope.deviceId, `${path}.source.scope.deviceId`),
      }),
      ...(scope.companyId !== undefined && {
        companyId: uuid(scope.companyId, `${path}.source.scope.companyId`),
      }),
    };
  }
  const transform = object(binding.transform, `${path}.transform`);
  exactKeys(transform, ['name', 'version'], `${path}.transform`);
  const version = enumValue(transform.version, ['1'] as const, `${path}.transform.version`);
  return {
    targetPath: boundedString(binding.targetPath, `${path}.targetPath`, 1, 512),
    source: parsedSource,
    dataClass: boundedString(binding.dataClass, `${path}.dataClass`, 1, 64),
    expectedType: enumValue(
      binding.expectedType,
      MSAIDIZI_INPUT_BINDING_VALUE_TYPES,
      `${path}.expectedType`,
    ),
    expectedSchema: object(binding.expectedSchema, `${path}.expectedSchema`),
    transform: {
      name: enumValue(transform.name, MSAIDIZI_INPUT_BINDING_TRANSFORMS, `${path}.transform.name`),
      version,
    },
  };
}

/**
 * The untrusted phase can return arguments for existing READ keys only. It has
 * no fields capable of expressing a new step, capability, target, or effect.
 */
export function applyStrictReadEnrichment(
  response: ModelResponse,
  authorityDraft: ProposedPlanDraft,
): ProposedPlanDraft {
  const value = parseStrictResponseObject(response);
  exactKeys(value, ['readArguments'], 'enrichment');
  const rows = array(value.readArguments, 'enrichment.readArguments');
  const readKeys = new Set(
    authorityDraft.steps
      .filter(
        (step) =>
          step.target === MsaidiziExecutionTarget.ERP &&
          step.expectedEffect === MsaidiziEffect.READ &&
          !step.mutation,
      )
      .map((step) => step.key),
  );
  const replacements = new Map<string, JsonObject>();
  const authorityByKey = new Map(authorityDraft.steps.map((step) => [step.key, step]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = object(rows[index], `enrichment.readArguments[${index}]`);
    exactKeys(row, ['key', 'arguments'], `enrichment.readArguments[${index}]`);
    const key = boundedString(row.key, `enrichment.readArguments[${index}].key`, 1, 64);
    if (!readKeys.has(key)) {
      fail(
        'UNTRUSTED_AUTHORITY_ESCALATION',
        'Untrusted content attempted to affect a non-read or unplanned step',
      );
    }
    if (replacements.has(key)) {
      fail('MODEL_SCHEMA_INVALID', `Duplicate read enrichment for step ${key}`);
    }
    const replacement = object(row.arguments, `enrichment.readArguments[${index}].arguments`);
    const authorityStep = authorityByKey.get(key)!;
    for (const binding of authorityStep.inputBindings) {
      if (readPointer(replacement, binding.targetPath) !== null) {
        fail(
          'UNTRUSTED_AUTHORITY_ESCALATION',
          `Untrusted enrichment changed bound target ${binding.targetPath}`,
        );
      }
    }
    replacements.set(key, replacement);
  }
  assertNoPersistedSecret(value);

  return {
    ...authorityDraft,
    steps: authorityDraft.steps.map((step) => ({
      ...step,
      arguments: replacements.get(step.key) ?? step.arguments,
    })),
  };
}

function parseStrictResponseObject(response: ModelResponse): JsonObject {
  if (response.stopReason === 'max_tokens') {
    fail('MODEL_OUTPUT_TRUNCATED', 'Model output reached its token ceiling');
  }
  const block = response.content[0];
  if (
    response.content.length !== 1 ||
    typeof block !== 'object' ||
    block === null ||
    block.type !== 'text' ||
    typeof block.text !== 'string'
  ) {
    fail('MODEL_OUTPUT_NOT_JSON', 'Model must return exactly one JSON text block');
  }
  const text = block.text.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) {
    fail('MODEL_OUTPUT_NOT_JSON', 'Model output must be a bare JSON object');
  }
  try {
    return object(JSON.parse(text) as unknown, 'response');
  } catch (error) {
    if (error instanceof StructuredModelOutputError) throw error;
    fail('MODEL_OUTPUT_NOT_JSON', 'Model returned malformed JSON');
  }
}

function exactKeys(value: JsonObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('MODEL_SCHEMA_INVALID', `${path} contains missing or unknown fields`);
  }
}

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('MODEL_SCHEMA_INVALID', `${path} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('MODEL_SCHEMA_INVALID', `${path} must be an array`);
  return value;
}

function boundedString(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    fail('MODEL_SCHEMA_INVALID', `${path} has an invalid string length`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 36, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) {
    fail('MODEL_SCHEMA_INVALID', `${path} must be a UUID`);
  }
  return parsed;
}

function sha256(value: unknown, path: string): string {
  const parsed = boundedString(value, path, 64, 64);
  if (!/^[a-f0-9]{64}$/.test(parsed)) {
    fail('MODEL_SCHEMA_INVALID', `${path} must be a lowercase SHA-256 digest`);
  }
  return parsed;
}

function readPointer(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) return undefined;
  let current = root;
  for (const token of pointer
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      return undefined;
    }
    current = (current as JsonObject)[token];
  }
  return current;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('MODEL_SCHEMA_INVALID', `${path} must be boolean`);
  return value;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail('MODEL_SCHEMA_INVALID', `${path} has an unsupported enum value`);
  }
  return value as T;
}

function assertNoPersistedSecret(value: unknown): void {
  const inspected =
    value && typeof value === 'object' && 'steps' in value
      ? bindingSafeDlpProjection(value as { steps?: unknown })
      : value;
  if (containsPersistedSecretWithGeneratedUpdateAllowance(inspected)) {
    fail('MODEL_OUTPUT_CONTAINS_SECRET', 'Model output contained credential-like data');
  }
}

function fail(code: string, message: string): never {
  throw new StructuredModelOutputError(code, message);
}
