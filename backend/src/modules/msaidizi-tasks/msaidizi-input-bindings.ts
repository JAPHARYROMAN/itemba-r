import {
  MsaidiziEffect,
  MsaidiziTaskStepStatus,
  MsaidiziToolAttemptStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { sanitizePersistedValue } from '../../common/utils/persistent-secret-redaction';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import { PrismaService } from '../../prisma/prisma.service';
import { MsaidiziInputBindingDto, MsaidiziPlanStepDto } from './dto/msaidizi-task.dto';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BINDING_SCHEMA_BYTES = 16 * 1024;
const MAX_SCHEMA_DEPTH = 12;
const VALUE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);
const SAFE_SCHEMA_KEYS = new Set([
  'type',
  'const',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
]);
const DEPENDENCY_KINDS = new Set(['DEPENDENCY_RESULT', 'DEPENDENCY_OUTPUT', 'DEPENDENCY_ARTIFACT']);
const BINDING_TRANSFORMS = new Set(['IDENTITY', 'JSON_STRINGIFY', 'SHA256_HEX', 'BASE64URL']);

export class MsaidiziInputBindingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MsaidiziInputBindingError';
  }
}

export interface ResolvedStepInputs {
  taskId: string;
  planVersionId: string;
  stepId: string;
  attemptId: string;
  arguments: Record<string, unknown>;
  /** Existing ERP/JWT canonical action-envelope digest. */
  argumentsSha256: string;
  /** SHA-256 of canonical UTF-8 JSON used by the host action protocol. */
  argumentsJsonSha256: string;
  provenance: Prisma.InputJsonObject;
  provenanceSha256: string;
}

/**
 * Exact authority needed to open one already-settled dependency artifact for a
 * host action. The materializer must re-authorize every field and return only
 * canonical Base64 for the recorded bytes; callers never accept a filesystem
 * path or model-selected URL here.
 */
export interface HostActionArtifactMaterializationRequest {
  taskId: string;
  planVersionId: string;
  targetStepId: string;
  targetAttemptId: string;
  deviceId: string;
  sourceStepId: string;
  sourceAttemptId: string;
  artifactId: string;
  sha256: string;
  byteSize: number;
  mimeType: string;
  name: string;
  kind: string;
  dataClass: string;
}

export interface HostActionArtifactMaterialization {
  contentBase64: string;
}

export type HostActionArtifactMaterializer = (
  request: HostActionArtifactMaterializationRequest,
) => Promise<HostActionArtifactMaterialization>;

export function staticStepInputs(
  taskId: string,
  planVersionId: string,
  stepId: string,
  attemptId: string,
  argumentsValue: Prisma.JsonValue,
): ResolvedStepInputs {
  const args = cloneJsonRecord(argumentsValue, 'INPUT_BINDING_ARGUMENT_TEMPLATE_INVALID');
  const argumentsJsonSha256 = sha256Canonical(args);
  const argumentsSha256 = actionArgumentDigest(args);
  const provenance: Prisma.InputJsonObject = {
    schemaVersion: 1,
    taskId,
    planVersionId,
    stepId,
    attemptId,
    argumentTemplateSha256: argumentsJsonSha256,
    resolvedArgumentsSha256: argumentsJsonSha256,
    bindings: [],
  };
  return {
    taskId,
    planVersionId,
    stepId,
    attemptId,
    arguments: args,
    argumentsSha256,
    argumentsJsonSha256,
    provenance,
    provenanceSha256: sha256Canonical(provenance),
  };
}

type JsonRecord = Record<string, unknown>;

/**
 * Validates the reviewed binding definition before it enters the immutable
 * plan. Runtime repeats every authority-relevant check against the persisted
 * plan and successful dependency records.
 */
export function assertPlanInputBindings(
  steps: MsaidiziPlanStepDto[],
  planInputs: Record<string, unknown>,
): void {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  for (const step of steps) {
    const targets = new Set<string>();
    for (const binding of step.inputBindings ?? []) {
      assertBindingShape(binding, step, byKey);
      if (targets.has(binding.targetPath)) {
        fail(
          'INPUT_BINDING_TARGET_DUPLICATE',
          `Step ${step.key} binds ${binding.targetPath} twice`,
        );
      }
      for (const prior of targets) {
        if (
          pointerContains(prior, binding.targetPath) ||
          pointerContains(binding.targetPath, prior)
        ) {
          fail(
            'INPUT_BINDING_TARGET_OVERLAP',
            `Step ${step.key} has overlapping binding targets ${prior} and ${binding.targetPath}`,
          );
        }
      }
      targets.add(binding.targetPath);
      const target = pointerRead(step.arguments, binding.targetPath);
      if (!target.exists || target.value !== null) {
        fail(
          'INPUT_BINDING_TARGET_NOT_PLACEHOLDER',
          `Step ${step.key} binding target ${binding.targetPath} must be an existing null placeholder`,
        );
      }

      if (binding.source.kind === 'PLAN_INPUT') {
        const source = pointerRead(planInputs, binding.source.path ?? '');
        if (!source.exists) {
          fail(
            'INPUT_BINDING_SOURCE_MISSING',
            `Step ${step.key} plan-input source ${binding.source.path ?? ''} does not exist`,
          );
        }
        assertNoRawCredential(source.value, 'INPUT_BINDING_PLAN_INPUT_SECRET');
        const transformed = transformValue(source.value, binding.transform.name);
        assertExpectedValue(binding, transformed, `Step ${step.key}`);
      }
    }
  }
}

/**
 * Resolves one immutable step template into its exact dispatch arguments and a
 * value-free provenance graph. Dependency observations are data only and carry
 * `instructionAuthority=false` in every edge.
 */
export async function resolveStepInputs(
  prisma: PrismaService,
  taskId: string,
  stepId: string,
  attemptId: string,
  materializeArtifact?: HostActionArtifactMaterializer,
): Promise<ResolvedStepInputs> {
  const step = await prisma.msaidiziTaskStep.findFirst({
    where: { id: stepId, taskId },
    include: {
      planVersion: true,
      task: { select: { companyId: true } },
    },
  });
  if (!step) fail('INPUT_BINDING_STEP_MISSING', 'The bound step no longer exists');
  const attempt = await prisma.msaidiziToolAttempt.findFirst({
    where: {
      id: attemptId,
      taskId,
      stepId,
      status: { in: [MsaidiziToolAttemptStatus.REQUESTED, MsaidiziToolAttemptStatus.RUNNING] },
    },
    select: { id: true },
  });
  if (!attempt) {
    fail('INPUT_BINDING_ATTEMPT_MISMATCH', 'The input binding attempt is not dispatchable');
  }

  const bindings = parsePersistedBindings(step.inputBindings);
  const args = cloneJsonRecord(step.arguments, 'INPUT_BINDING_ARGUMENT_TEMPLATE_INVALID');
  const dependencies = stringArray(step.dependencies);
  assertRuntimeBindingAuthority(
    {
      key: step.stepKey,
      name: step.name,
      target: step.target,
      capability: step.capability,
      capabilityVersion: step.capabilityVersion,
      arguments: args,
      dependsOn: dependencies,
      inputBindings: bindings,
      expectedEffect: step.expectedEffect,
      dataClass: step.dataClass,
      preconditions: record(step.preconditions),
      recovery: step.recovery == null ? undefined : record(step.recovery),
      budgets: record(step.budgets),
      stopConditions: record(step.stopConditions),
      idempotent: step.idempotent,
      mutation: step.mutation,
    },
    record(step.planVersion.inputs),
  );
  const edges: Prisma.InputJsonObject[] = [];

  for (const binding of bindings) {
    const target = pointerRead(args, binding.targetPath);
    if (!target.exists || target.value !== null) {
      fail(
        'INPUT_BINDING_TARGET_TAMPERED',
        `Binding target ${binding.targetPath} is not its reviewed null placeholder`,
      );
    }

    const resolvedSource = await resolveSource(prisma, {
      binding,
      taskId,
      planVersionId: step.planVersionId,
      stepId,
      attemptId,
      capability: step.capability,
      capabilityVersion: step.capabilityVersion,
      stepDataClass: step.dataClass,
      companyId: step.task.companyId,
      preconditions: record(step.preconditions),
      planInputs: step.planVersion.inputs,
      dependencies,
      materializeArtifact,
    });
    if (binding.source.kind !== 'SECRET_REFERENCE') {
      // Screen the typed source before an allowlisted deterministic encoding.
      // Screening JSON_STRINGIFY/SHA256_HEX output as free-form prose would
      // misclassify provenance digests as bearer credentials.
      assertNoRawCredential(resolvedSource.value, 'INPUT_BINDING_RESOLVED_SECRET');
    }
    const transformed = transformValue(resolvedSource.value, binding.transform.name);
    assertExpectedValue(binding, transformed, `Step ${step.stepKey}`);
    pointerWrite(args, binding.targetPath, cloneJson(transformed));
    edges.push({
      targetPath: binding.targetPath,
      dataClass: binding.dataClass,
      expectedType: binding.expectedType,
      expectedSchemaSha256: sha256Canonical(binding.expectedSchema),
      transform: { name: binding.transform.name, version: binding.transform.version },
      source: resolvedSource.provenance,
      transformedValueSha256: sha256Canonical(transformed),
      trustLevel:
        binding.source.kind === 'PLAN_INPUT' || binding.source.kind === 'SECRET_REFERENCE'
          ? 'REVIEWED_REFERENCE'
          : 'UNTRUSTED',
      instructionAuthority: false,
    });
  }

  const argumentsJsonSha256 = sha256Canonical(args);
  const argumentsSha256 = actionArgumentDigest(args);
  const provenance: Prisma.InputJsonObject = {
    schemaVersion: 1,
    taskId,
    planVersionId: step.planVersionId,
    stepId,
    attemptId,
    argumentTemplateSha256: sha256Canonical(step.arguments),
    resolvedArgumentsSha256: argumentsJsonSha256,
    bindings: edges,
  };
  return {
    taskId,
    planVersionId: step.planVersionId,
    stepId,
    attemptId,
    arguments: args,
    argumentsSha256,
    argumentsJsonSha256,
    provenance,
    provenanceSha256: sha256Canonical(provenance),
  };
}

interface ResolveSourceContext {
  binding: MsaidiziInputBindingDto;
  taskId: string;
  planVersionId: string;
  stepId: string;
  attemptId: string;
  capability: string;
  capabilityVersion: string;
  stepDataClass: string;
  companyId: string | null;
  preconditions: JsonRecord;
  planInputs: Prisma.JsonValue;
  dependencies: string[];
  materializeArtifact?: HostActionArtifactMaterializer;
}

async function resolveSource(
  prisma: PrismaService,
  context: ResolveSourceContext,
): Promise<{ value: unknown; provenance: Prisma.InputJsonObject }> {
  const { binding } = context;
  if (binding.source.kind === 'PLAN_INPUT') {
    const selected = pointerRead(context.planInputs, binding.source.path ?? '');
    if (!selected.exists) fail('INPUT_BINDING_SOURCE_MISSING', 'Immutable plan input is missing');
    return {
      value: selected.value,
      provenance: {
        kind: 'PLAN_INPUT',
        taskId: context.taskId,
        planVersionId: context.planVersionId,
        sourcePath: binding.source.path ?? '',
        valueSha256: sha256Canonical(selected.value),
      },
    };
  }

  if (binding.source.kind === 'SECRET_REFERENCE') {
    const referenceId = binding.source.secretReferenceId!;
    const referenceSha256 = sha256Utf8(referenceId);
    if (!fixedDigest(referenceSha256, binding.source.secretReferenceSha256!)) {
      fail('INPUT_BINDING_SECRET_DIGEST_MISMATCH', 'Secret-reference handle digest does not match');
    }
    assertSecretScope(context);
    return {
      value: referenceId,
      provenance: {
        kind: 'SECRET_REFERENCE',
        taskId: context.taskId,
        planVersionId: context.planVersionId,
        secretReferenceSha256: referenceSha256,
        scopeSha256: sha256Canonical(binding.source.scope!),
      },
    };
  }

  const dependencyKey = binding.source.dependencyStepKey!;
  if (!context.dependencies.includes(dependencyKey)) {
    fail(
      'INPUT_BINDING_UNAUTHORIZED_DEPENDENCY',
      `Step does not declare dependency ${dependencyKey}`,
    );
  }
  const dependency = await prisma.msaidiziTaskStep.findFirst({
    where: {
      taskId: context.taskId,
      planVersionId: context.planVersionId,
      stepKey: dependencyKey,
    },
    include: {
      toolAttempts: {
        where: { status: MsaidiziToolAttemptStatus.SUCCEEDED },
        orderBy: { attemptNumber: 'desc' },
        take: 1,
      },
      artifacts: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!dependency || dependency.status !== MsaidiziTaskStepStatus.SUCCEEDED) {
    fail(
      'INPUT_BINDING_DEPENDENCY_NOT_SUCCESSFUL',
      `Dependency ${dependencyKey} is not terminal-successful`,
    );
  }
  if (dependency.dataClass !== binding.dataClass) {
    fail('INPUT_BINDING_DATA_CLASS_MISMATCH', `Dependency ${dependencyKey} data class changed`);
  }
  const sourceAttempt = dependency.toolAttempts[0];
  if (!sourceAttempt || sourceAttempt.resultSummary == null) {
    fail('INPUT_BINDING_DEPENDENCY_RESULT_MISSING', `Dependency ${dependencyKey} has no result`);
  }

  if (binding.source.kind === 'DEPENDENCY_ARTIFACT') {
    const artifacts = dependency.artifacts.filter((artifact) => {
      const provenance = record(artifact.provenance);
      return provenance.attemptId === sourceAttempt.id;
    });
    const artifact = binding.source.artifactId
      ? artifacts.find((candidate) => candidate.id === binding.source.artifactId)
      : artifacts.length === 1
        ? artifacts[0]
        : undefined;
    if (!artifact) {
      fail(
        artifacts.length > 1
          ? 'INPUT_BINDING_ARTIFACT_AMBIGUOUS'
          : 'INPUT_BINDING_ARTIFACT_MISSING',
        `Dependency ${dependencyKey} artifact selection is not exact`,
      );
    }
    const provenance = record(artifact.provenance);
    if (
      artifact.taskId !== context.taskId ||
      artifact.stepId !== dependency.id ||
      artifact.dataClass !== binding.dataClass ||
      provenance.attemptId !== sourceAttempt.id ||
      !SHA256.test(artifact.sha256.toLowerCase()) ||
      provenance.persistedSha256 !== artifact.sha256
    ) {
      fail('INPUT_BINDING_ARTIFACT_DIGEST_MISMATCH', 'Dependency artifact provenance is invalid');
    }
    if (artifact.byteSize <= 0n || artifact.byteSize > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail('INPUT_BINDING_ARTIFACT_SIZE_INVALID', 'Dependency artifact size is not representable');
    }
    const descriptor = {
      artifactId: artifact.id,
      sha256: artifact.sha256,
      byteSize: Number(artifact.byteSize),
      mimeType: artifact.mimeType,
      name: artifact.name,
      kind: artifact.kind,
    };
    let sourceRoot: unknown = descriptor;
    if ((binding.source.path ?? '') === '') {
      const deviceId = context.preconditions.deviceId;
      if (typeof deviceId !== 'string' || !isUuid(deviceId)) {
        fail(
          'INPUT_BINDING_ARTIFACT_DEVICE_SCOPE_INVALID',
          'Host artifact materialization requires an exact reviewed device',
        );
      }
      if (!context.materializeArtifact) {
        fail(
          'INPUT_BINDING_ARTIFACT_CONTENT_UNAVAILABLE',
          'No governed artifact materializer is available for this host action',
        );
      }
      const request: HostActionArtifactMaterializationRequest = {
        taskId: context.taskId,
        planVersionId: context.planVersionId,
        targetStepId: context.stepId,
        targetAttemptId: context.attemptId,
        deviceId,
        sourceStepId: dependency.id,
        sourceAttemptId: sourceAttempt.id,
        artifactId: artifact.id,
        sha256: artifact.sha256,
        byteSize: Number(artifact.byteSize),
        mimeType: artifact.mimeType,
        name: artifact.name,
        kind: artifact.kind,
        dataClass: artifact.dataClass,
      };
      const materialized = await context.materializeArtifact(request);
      assertMaterializedArtifactContent(request, materialized);
      const scopeSha256 = hostActionArtifactScopeSha256(request);
      sourceRoot = {
        schemaVersion: 1,
        taskId: request.taskId,
        planVersionId: request.planVersionId,
        targetStepId: request.targetStepId,
        deviceId: request.deviceId,
        sourceStepId: request.sourceStepId,
        sourceAttemptId: request.sourceAttemptId,
        artifactId: request.artifactId,
        sha256: request.sha256,
        byteSize: request.byteSize,
        mimeType: request.mimeType,
        name: request.name,
        kind: request.kind,
        dataClass: request.dataClass,
        scopeSha256,
        contentBase64: materialized.contentBase64,
      };
    }
    const selected = pointerRead(sourceRoot, binding.source.path ?? '');
    if (!selected.exists) fail('INPUT_BINDING_SOURCE_MISSING', 'Artifact source path is missing');
    return {
      value: selected.value,
      provenance: {
        kind: 'DEPENDENCY_ARTIFACT',
        taskId: context.taskId,
        planVersionId: context.planVersionId,
        stepId: dependency.id,
        attemptId: sourceAttempt.id,
        artifactId: artifact.id,
        artifactSha256: artifact.sha256,
        sourcePath: binding.source.path ?? '',
        valueSha256: sha256Canonical(selected.value),
      },
    };
  }

  const summary = record(sourceAttempt.resultSummary);
  const resultDigest = resultSummaryDigest(summary);
  if (!resultDigest) {
    fail('INPUT_BINDING_DEPENDENCY_DIGEST_MISSING', 'Dependency result has no valid digest');
  }
  let sourceRoot: unknown = summary;
  let persistedValueSha256: string | null = null;
  if (binding.source.kind === 'DEPENDENCY_OUTPUT') {
    const observation = record(summary.observation);
    if (
      observation.available !== true ||
      observation.redactionsApplied === true ||
      !SHA256.test(String(observation.sourceSha256 ?? '').toLowerCase()) ||
      !Object.prototype.hasOwnProperty.call(observation, 'value')
    ) {
      fail(
        'INPUT_BINDING_DEPENDENCY_OUTPUT_UNAVAILABLE',
        'Dependency output is missing, redacted, or unverified',
      );
    }
    sourceRoot = observation.value;
    persistedValueSha256 = sha256JsonEncoding(sourceRoot);
    if (!fixedDigest(persistedValueSha256, String(observation.sourceSha256).toLowerCase())) {
      fail('INPUT_BINDING_DEPENDENCY_DIGEST_MISMATCH', 'Dependency output digest is invalid');
    }
  }
  const selected = pointerRead(sourceRoot, binding.source.path ?? '');
  if (!selected.exists) fail('INPUT_BINDING_SOURCE_MISSING', 'Dependency source path is missing');
  return {
    value: selected.value,
    provenance: {
      kind: binding.source.kind,
      taskId: context.taskId,
      planVersionId: context.planVersionId,
      stepId: dependency.id,
      attemptId: sourceAttempt.id,
      resultSha256: resultDigest,
      ...(persistedValueSha256 ? { outputValueSha256: persistedValueSha256 } : {}),
      sourcePath: binding.source.path ?? '',
      valueSha256: sha256Canonical(selected.value),
    },
  };
}

export function hostActionArtifactScopeSha256(
  request: HostActionArtifactMaterializationRequest,
): string {
  return sha256Utf8(
    [
      'itemba-governed-artifact-envelope/v1',
      request.taskId,
      request.planVersionId,
      request.targetStepId,
      request.deviceId,
      request.sourceStepId,
      request.sourceAttemptId,
      request.artifactId,
      request.sha256,
      String(request.byteSize),
      request.mimeType.normalize('NFC'),
      request.name.normalize('NFC'),
      request.kind,
      request.dataClass,
    ].join('\n'),
  );
}

function assertMaterializedArtifactContent(
  request: HostActionArtifactMaterializationRequest,
  materialized: HostActionArtifactMaterialization,
): void {
  if (
    !isRecord(materialized) ||
    typeof materialized.contentBase64 !== 'string' ||
    materialized.contentBase64.length !== Math.ceil(request.byteSize / 3) * 4
  ) {
    fail(
      'INPUT_BINDING_ARTIFACT_CONTENT_INVALID',
      'Materialized artifact content is not canonical Base64 for the recorded size',
    );
  }
  const content = Buffer.from(materialized.contentBase64, 'base64');
  try {
    if (
      content.length !== request.byteSize ||
      content.toString('base64') !== materialized.contentBase64 ||
      sha256Utf8Buffer(content) !== request.sha256
    ) {
      fail(
        'INPUT_BINDING_ARTIFACT_CONTENT_DIGEST_MISMATCH',
        'Materialized artifact bytes do not match the immutable dependency artifact',
      );
    }
  } finally {
    content.fill(0);
  }
}

function assertBindingShape(
  binding: MsaidiziInputBindingDto,
  step: MsaidiziPlanStepDto,
  byKey: Map<string, MsaidiziPlanStepDto>,
): void {
  assertJsonPointer(binding.targetPath, false);
  assertJsonPointer(binding.source.path ?? '', true);
  assertSchemaDefinition(binding.expectedSchema, binding.expectedType);
  if (binding.dataClass !== step.dataClass) {
    fail(
      'INPUT_BINDING_DATA_CLASS_MISMATCH',
      `Step ${step.key} binding data class must equal the target step data class`,
    );
  }
  if (step.target === 'SELF_IMPROVEMENT') {
    fail(
      'INPUT_BINDING_TARGET_UNSUPPORTED',
      `Self-improvement step ${step.key} cannot consume dynamic bindings`,
    );
  }

  const source = binding.source;
  const hasDependency = source.dependencyStepKey !== undefined;
  const hasArtifact = source.artifactId !== undefined;
  const hasSecret =
    source.secretReferenceId !== undefined ||
    source.secretReferenceSha256 !== undefined ||
    source.scope !== undefined;
  if (source.kind === 'PLAN_INPUT') {
    if (hasDependency || hasArtifact || hasSecret) {
      fail('INPUT_BINDING_SOURCE_INVALID', 'Plan-input bindings contain unrelated source fields');
    }
    return;
  }
  if (DEPENDENCY_KINDS.has(source.kind)) {
    if (!source.dependencyStepKey || hasSecret) {
      fail('INPUT_BINDING_SOURCE_INVALID', 'Dependency binding source is incomplete');
    }
    if (source.kind !== 'DEPENDENCY_ARTIFACT' && hasArtifact) {
      fail('INPUT_BINDING_SOURCE_INVALID', 'Only artifact bindings may select an artifact id');
    }
    const dependency = byKey.get(source.dependencyStepKey);
    if (!dependency || !step.dependsOn.includes(source.dependencyStepKey)) {
      fail(
        'INPUT_BINDING_UNAUTHORIZED_DEPENDENCY',
        `Step ${step.key} cannot bind undeclared dependency ${source.dependencyStepKey}`,
      );
    }
    if (dependency.dataClass !== binding.dataClass) {
      fail(
        'INPUT_BINDING_DATA_CLASS_MISMATCH',
        `Dependency ${source.dependencyStepKey} data class does not match the binding`,
      );
    }
    return;
  }
  if (source.kind === 'SECRET_REFERENCE') {
    if (
      hasDependency ||
      hasArtifact ||
      (source.path ?? '') !== '' ||
      !source.secretReferenceId ||
      !source.secretReferenceSha256 ||
      !source.scope
    ) {
      fail('INPUT_BINDING_SECRET_SCOPE_INVALID', 'Secret-reference binding is incomplete');
    }
    if (!fixedDigest(sha256Utf8(source.secretReferenceId), source.secretReferenceSha256)) {
      fail('INPUT_BINDING_SECRET_DIGEST_MISMATCH', 'Secret-reference handle digest does not match');
    }
    if (
      source.scope.capability !== step.capability ||
      source.scope.capabilityVersion !== step.capabilityVersion ||
      source.scope.dataClass !== binding.dataClass
    ) {
      fail('INPUT_BINDING_SECRET_SCOPE_INVALID', 'Secret-reference scope does not match the step');
    }
    if (step.target === 'HOST' && !source.scope.deviceId) {
      fail('INPUT_BINDING_SECRET_SCOPE_INVALID', 'Host secret references require an exact device');
    }
    if (
      source.scope.deviceId !== undefined &&
      record(step.preconditions).deviceId !== source.scope.deviceId
    ) {
      fail(
        'INPUT_BINDING_SECRET_SCOPE_INVALID',
        'Secret-reference device must match the reviewed step precondition',
      );
    }
    return;
  }
  fail('INPUT_BINDING_SOURCE_INVALID', 'Input binding source kind is not supported');
}

function assertSecretScope(context: ResolveSourceContext): void {
  const scope = context.binding.source.scope!;
  if (
    scope.capability !== context.capability ||
    scope.capabilityVersion !== context.capabilityVersion ||
    scope.dataClass !== context.binding.dataClass ||
    context.stepDataClass !== context.binding.dataClass ||
    (scope.companyId !== undefined && scope.companyId !== context.companyId) ||
    (scope.deviceId !== undefined && scope.deviceId !== context.preconditions.deviceId)
  ) {
    fail(
      'INPUT_BINDING_SECRET_SCOPE_MISMATCH',
      'Secret-reference scope no longer matches the step',
    );
  }
}

function parsePersistedBindings(value: Prisma.JsonValue): MsaidiziInputBindingDto[] {
  if (!Array.isArray(value)) fail('INPUT_BINDING_DEFINITION_TAMPERED', 'Bindings are not an array');
  if (value.length > 100) {
    fail('INPUT_BINDING_DEFINITION_TAMPERED', 'Bindings exceed the reviewed plan limit');
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} is not an object`);
    }
    assertExactKeys(
      item,
      ['targetPath', 'source', 'dataClass', 'expectedType', 'expectedSchema', 'transform'],
      `Binding ${index}`,
    );
    if (typeof item.targetPath !== 'string') {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} targetPath is invalid`);
    }
    if (
      typeof item.dataClass !== 'string' ||
      item.dataClass.length < 1 ||
      item.dataClass.length > 64
    ) {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} dataClass is invalid`);
    }
    if (typeof item.expectedType !== 'string' || !VALUE_TYPES.has(item.expectedType)) {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} expectedType is invalid`);
    }
    if (!isRecord(item.expectedSchema)) {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} expectedSchema is invalid`);
    }
    if (!isRecord(item.transform)) {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} transform is invalid`);
    }
    assertExactKeys(item.transform, ['name', 'version'], `Binding ${index} transform`);
    if (
      typeof item.transform.name !== 'string' ||
      !BINDING_TRANSFORMS.has(item.transform.name) ||
      item.transform.version !== '1'
    ) {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} transform is not allowlisted`);
    }
    if (!isRecord(item.source) || typeof item.source.kind !== 'string') {
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} source is invalid`);
    }
    assertPersistedSourceShape(item.source, index);
    return item as unknown as MsaidiziInputBindingDto;
  });
}

function assertPersistedSourceShape(source: JsonRecord, index: number): void {
  const common = ['kind', 'path'];
  if (source.path !== undefined && typeof source.path !== 'string') {
    fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} source path is invalid`);
  }
  switch (source.kind) {
    case 'PLAN_INPUT':
      assertExactKeys(source, common, `Binding ${index} source`, ['path']);
      return;
    case 'DEPENDENCY_RESULT':
    case 'DEPENDENCY_OUTPUT':
      assertExactKeys(source, [...common, 'dependencyStepKey'], `Binding ${index} source`, [
        'path',
      ]);
      if (
        typeof source.dependencyStepKey !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(source.dependencyStepKey)
      ) {
        fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} dependency is invalid`);
      }
      return;
    case 'DEPENDENCY_ARTIFACT':
      assertExactKeys(
        source,
        [...common, 'dependencyStepKey', 'artifactId'],
        `Binding ${index} source`,
        ['path', 'artifactId'],
      );
      if (
        typeof source.dependencyStepKey !== 'string' ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(source.dependencyStepKey) ||
        (source.artifactId !== undefined &&
          (typeof source.artifactId !== 'string' || !isUuid(source.artifactId)))
      ) {
        fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} artifact source is invalid`);
      }
      return;
    case 'SECRET_REFERENCE':
      assertExactKeys(
        source,
        [...common, 'secretReferenceId', 'secretReferenceSha256', 'scope'],
        `Binding ${index} source`,
        ['path'],
      );
      if (
        typeof source.secretReferenceId !== 'string' ||
        !isUuid(source.secretReferenceId) ||
        typeof source.secretReferenceSha256 !== 'string' ||
        !SHA256.test(source.secretReferenceSha256) ||
        !isRecord(source.scope)
      ) {
        fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} secret reference is invalid`);
      }
      assertExactKeys(
        source.scope,
        ['capability', 'capabilityVersion', 'dataClass', 'deviceId', 'companyId'],
        `Binding ${index} secret scope`,
        ['deviceId', 'companyId'],
      );
      for (const key of ['capability', 'capabilityVersion', 'dataClass']) {
        if (typeof source.scope[key] !== 'string' || source.scope[key].length < 1) {
          fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} secret scope is invalid`);
        }
      }
      for (const key of ['deviceId', 'companyId']) {
        if (
          source.scope[key] !== undefined &&
          (typeof source.scope[key] !== 'string' || !isUuid(source.scope[key] as string))
        ) {
          fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} secret scope is invalid`);
        }
      }
      return;
    default:
      fail('INPUT_BINDING_DEFINITION_TAMPERED', `Binding ${index} source kind is unsupported`);
  }
}

function assertRuntimeBindingAuthority(step: MsaidiziPlanStepDto, planInputs: JsonRecord): void {
  const dependencyStubs = step.dependsOn.map(
    (key): MsaidiziPlanStepDto => ({
      key,
      name: key,
      target: step.target,
      capability: '__persisted_dependency__',
      capabilityVersion: '1',
      arguments: {},
      dependsOn: [],
      inputBindings: [],
      expectedEffect: MsaidiziEffect.READ,
      dataClass: step.dataClass,
      preconditions: {},
      budgets: {},
      stopConditions: {},
      idempotent: true,
      mutation: false,
    }),
  );
  assertPlanInputBindings([...dependencyStubs, step], planInputs);
}

function assertExactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    fail('INPUT_BINDING_DEFINITION_TAMPERED', `${label} contains an unreviewed field`);
  }
  if (
    allowed.some(
      (key) => !optionalSet.has(key) && !Object.prototype.hasOwnProperty.call(value, key),
    )
  ) {
    fail('INPUT_BINDING_DEFINITION_TAMPERED', `${label} is missing a required field`);
  }
}

function assertExpectedValue(
  binding: MsaidiziInputBindingDto,
  value: unknown,
  label: string,
): void {
  if (!valueMatchesType(value, binding.expectedType)) {
    fail(
      'INPUT_BINDING_TYPE_MISMATCH',
      `${label} binding ${binding.targetPath} expected ${binding.expectedType}`,
    );
  }
  const issues = validateValueAgainstSchema(value, binding.expectedSchema, '$');
  if (issues.length > 0) {
    fail(
      'INPUT_BINDING_SCHEMA_MISMATCH',
      `${label} binding ${binding.targetPath} failed schema: ${issues[0]}`,
    );
  }
}

function assertSchemaDefinition(
  schema: Record<string, unknown>,
  expectedType: MsaidiziInputBindingDto['expectedType'],
  depth = 0,
): void {
  if (depth === 0 && Buffer.byteLength(JSON.stringify(schema), 'utf8') > MAX_BINDING_SCHEMA_BYTES) {
    fail('INPUT_BINDING_SCHEMA_INVALID', 'Binding schema exceeds the size limit');
  }
  if (depth > MAX_SCHEMA_DEPTH) fail('INPUT_BINDING_SCHEMA_INVALID', 'Binding schema is too deep');
  if (!isRecord(schema) || schema.type !== expectedType) {
    fail('INPUT_BINDING_SCHEMA_INVALID', 'Binding schema type must match expectedType');
  }
  if (!VALUE_TYPES.has(String(schema.type))) {
    fail(
      'INPUT_BINDING_SCHEMA_INVALID',
      `Binding schema type ${String(schema.type)} is not allowed`,
    );
  }
  for (const key of Object.keys(schema)) {
    if (!SAFE_SCHEMA_KEYS.has(key)) {
      fail('INPUT_BINDING_SCHEMA_INVALID', `Binding schema keyword ${key} is not allowed`);
    }
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false || !isRecord(schema.properties)) {
      fail(
        'INPUT_BINDING_SCHEMA_INVALID',
        'Object binding schemas require properties and additionalProperties=false',
      );
    }
    const properties = schema.properties as Record<string, unknown>;
    for (const [key, child] of Object.entries(properties)) {
      if (!isRecord(child) || typeof child.type !== 'string') {
        fail('INPUT_BINDING_SCHEMA_INVALID', `Property ${key} has no exact type`);
      }
      if (!VALUE_TYPES.has(child.type)) {
        fail('INPUT_BINDING_SCHEMA_INVALID', `Property ${key} has an unsupported type`);
      }
      assertSchemaDefinition(
        child,
        child.type as MsaidiziInputBindingDto['expectedType'],
        depth + 1,
      );
    }
    if (
      schema.required !== undefined &&
      (!Array.isArray(schema.required) ||
        schema.required.some((item) => typeof item !== 'string' || !(item in properties)))
    ) {
      fail('INPUT_BINDING_SCHEMA_INVALID', 'Object schema required fields are invalid');
    }
  }
  if (schema.type === 'array') {
    if (!isRecord(schema.items) || typeof schema.items.type !== 'string') {
      fail('INPUT_BINDING_SCHEMA_INVALID', 'Array binding schemas require typed items');
    }
    if (!VALUE_TYPES.has(schema.items.type)) {
      fail('INPUT_BINDING_SCHEMA_INVALID', 'Array item schema has an unsupported type');
    }
    assertSchemaDefinition(
      schema.items,
      schema.items.type as MsaidiziInputBindingDto['expectedType'],
      depth + 1,
    );
  }
  if ('const' in schema) assertNoRawCredential(schema.const, 'INPUT_BINDING_SCHEMA_SECRET');
  if (Array.isArray(schema.enum)) {
    for (const item of schema.enum) {
      assertNoRawCredential(item, 'INPUT_BINDING_SCHEMA_SECRET');
    }
  }
}

function validateValueAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
): string[] {
  const issues: string[] = [];
  if (!valueMatchesType(value, String(schema.type))) return [`${path} has the wrong type`];
  if ('const' in schema && !deepEqual(value, schema.const))
    issues.push(`${path} differs from const`);
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(value, item))) {
    issues.push(`${path} is outside enum`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      issues.push(`${path} is shorter than minLength`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      issues.push(`${path} is longer than maxLength`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      issues.push(`${path} is below minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      issues.push(`${path} is above maximum`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      issues.push(`${path} has too few items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      issues.push(`${path} has too many items`);
    if (isRecord(schema.items)) {
      value.forEach((item, index) =>
        issues.push(
          ...validateValueAgainstSchema(item, schema.items as JsonRecord, `${path}[${index}]`),
        ),
      );
    }
  }
  if (isRecord(value) && !Array.isArray(value)) {
    const properties = record(schema.properties);
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key))
        issues.push(`${path}.${key} is required`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          issues.push(`${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && isRecord(childSchema)) {
        issues.push(...validateValueAgainstSchema(value[key], childSchema, `${path}.${key}`));
      }
    }
  }
  return issues;
}

function transformValue(
  value: unknown,
  transform: MsaidiziInputBindingDto['transform']['name'],
): unknown {
  switch (transform) {
    case 'IDENTITY':
      return cloneJson(value);
    case 'JSON_STRINGIFY':
      return stableJson(value);
    case 'SHA256_HEX':
      return sha256Canonical(value);
    case 'BASE64URL':
      return Buffer.from(stableJson(value), 'utf8').toString('base64url');
    default:
      fail('INPUT_BINDING_TRANSFORM_INVALID', 'Binding transform is not allowlisted');
  }
}

function assertNoRawCredential(value: unknown, code: string): void {
  const sanitized = sanitizePersistedValue(value);
  if (sanitized.redactionsApplied) {
    fail(code, 'Resolved binding contains credential-like data; use a scoped secret reference');
  }
}

function resultSummaryDigest(summary: JsonRecord): string | null {
  for (const key of ['responseSha256', 'outputSha256']) {
    const value = summary[key];
    if (typeof value === 'string' && SHA256.test(value.toLowerCase())) return value.toLowerCase();
  }
  return null;
}

function pointerRead(root: unknown, pointer: string): { exists: boolean; value: unknown } {
  if (pointer === '') return { exists: true, value: root };
  let current = root;
  for (const token of pointerTokens(pointer)) {
    if (!isRecord(current) && !Array.isArray(current)) return { exists: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, token))
      return { exists: false, value: undefined };
    current = (current as JsonRecord)[token];
  }
  return { exists: true, value: current };
}

function pointerWrite(root: JsonRecord, pointer: string, value: unknown): void {
  const tokens = pointerTokens(pointer);
  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (!isRecord(current) && !Array.isArray(current)) {
      fail('INPUT_BINDING_TARGET_TAMPERED', `Binding target ${pointer} is not writable`);
    }
    current = (current as JsonRecord)[token];
  }
  if (!isRecord(current) && !Array.isArray(current)) {
    fail('INPUT_BINDING_TARGET_TAMPERED', `Binding target ${pointer} is not writable`);
  }
  (current as JsonRecord)[tokens[tokens.length - 1]] = value;
}

function pointerTokens(pointer: string): string[] {
  assertJsonPointer(pointer, true);
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function assertJsonPointer(pointer: string, allowRoot: boolean): void {
  if (allowRoot && pointer === '') return;
  if (
    typeof pointer !== 'string' ||
    pointer.length > 512 ||
    !/^\/(?:[^~/]|~0|~1)+(?:\/(?:[^~/]|~0|~1)+)*$/.test(pointer)
  ) {
    fail('INPUT_BINDING_POINTER_INVALID', `Invalid JSON pointer ${String(pointer)}`);
  }
  for (const token of pointerTokensUnchecked(pointer)) {
    if (['__proto__', 'prototype', 'constructor'].includes(token)) {
      fail('INPUT_BINDING_POINTER_INVALID', 'Prototype paths are forbidden');
    }
  }
}

function pointerTokensUnchecked(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function pointerContains(parent: string, child: string): boolean {
  return child.startsWith(`${parent}/`);
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  return `{${Object.keys(value as JsonRecord)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as JsonRecord)[key])}`)
    .join(',')}}`;
}

export function sha256Canonical(value: unknown): string {
  return sha256Utf8(stableJson(value));
}

function sha256JsonEncoding(value: unknown): string {
  return sha256Utf8(JSON.stringify(value));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Utf8Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function fixedDigest(left: string, right: string): boolean {
  return SHA256.test(left) && SHA256.test(right) && left === right;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneJsonRecord(value: Prisma.JsonValue, code: string): JsonRecord {
  const cloned = cloneJson(value);
  if (!isRecord(cloned)) fail(code, 'Step arguments must be an object');
  return cloned;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function valueMatchesType(value: unknown, expectedType: string): boolean {
  const actual = jsonType(value);
  return actual === expectedType || (expectedType === 'number' && actual === 'integer');
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function fail(code: string, message: string): never {
  throw new MsaidiziInputBindingError(code, message);
}
