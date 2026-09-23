import { Prisma } from '@prisma/client';
import { actionArgumentDigest } from '../../common/utils/canonical-digest';
import { MsaidiziInputBindingError } from './msaidizi-input-binding-error';

/** Internal authority, never accepted from a model or public plan DTO. */
export interface DependencyLineage {
  version: 1;
  dependencyStepKey: string;
  sourcePlanVersionId: string;
  sourceStepId: string;
  sourceAttemptId: string;
  sourceResultSha256: string;
  sourceArgsSha256: string;
  dataClass: string;
}
const fields = [
  'version',
  'dependencyStepKey',
  'sourcePlanVersionId',
  'sourceStepId',
  'sourceAttemptId',
  'sourceResultSha256',
  'sourceArgsSha256',
  'dataClass',
];
const sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDependencyLineage(value: Prisma.JsonValue | undefined): DependencyLineage[] {
  if (value === undefined) return []; // Legacy test/DTO projections; DB defaults are [].
  if (!Array.isArray(value) || value.length > 100) invalid();
  const seen = new Set<string>();
  return value.map((raw) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== fields.length ||
      fields.some((field) => !(field in raw)) ||
      raw.version !== 1 ||
      typeof raw.dependencyStepKey !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(raw.dependencyStepKey) ||
      typeof raw.sourcePlanVersionId !== 'string' ||
      !uuid.test(raw.sourcePlanVersionId) ||
      typeof raw.sourceStepId !== 'string' ||
      !uuid.test(raw.sourceStepId) ||
      typeof raw.sourceAttemptId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(raw.sourceAttemptId) ||
      typeof raw.sourceResultSha256 !== 'string' ||
      !sha256.test(raw.sourceResultSha256) ||
      typeof raw.sourceArgsSha256 !== 'string' ||
      !sha256.test(raw.sourceArgsSha256) ||
      typeof raw.dataClass !== 'string' ||
      raw.dataClass.length < 1 ||
      raw.dataClass.length > 64 ||
      seen.has(raw.dependencyStepKey)
    )
      invalid();
    seen.add(raw.dependencyStepKey);
    return raw as unknown as DependencyLineage;
  });
}

const sourceInclude = {
  planVersion: true,
  toolAttempts: { orderBy: { attemptNumber: 'desc' as const }, take: 1 },
  artifacts: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.MsaidiziTaskStepInclude;
type Source = Prisma.MsaidiziTaskStepGetPayload<{ include: typeof sourceInclude }>;

function assertSuccessful(
  source: Source | null,
  taskId: string,
  targetVersion: number,
): asserts source is Source {
  const attempt = source?.toolAttempts[0];
  if (
    !source ||
    !Number.isInteger(targetVersion) ||
    targetVersion < 2 ||
    !Number.isInteger(source.planVersion.version) ||
    source.planVersion.version < 1 ||
    source.taskId !== taskId ||
    source.planVersion.taskId !== taskId ||
    source.planVersion.version >= targetVersion ||
    source.status !== 'SUCCEEDED' ||
    !attempt ||
    attempt.taskId !== taskId ||
    attempt.stepId !== source.id ||
    attempt.status !== 'SUCCEEDED' ||
    attempt.uncertainOutcome ||
    !attempt.resultSummary ||
    typeof attempt.resultSummary !== 'object' ||
    Array.isArray(attempt.resultSummary) ||
    !sha256.test(attempt.argsDigest)
  ) {
    throw new MsaidiziInputBindingError(
      'INPUT_BINDING_LINEAGE_SOURCE_INVALID',
      'Prior-plan dependency is not an exact successful attempt',
    );
  }
}

export async function captureDependencyLineage(
  db: Prisma.TransactionClient,
  taskId: string,
  targetVersion: number,
  sourceStepId: string,
): Promise<DependencyLineage> {
  const source = await db.msaidiziTaskStep.findFirst({
    where: { id: sourceStepId, taskId },
    include: sourceInclude,
  });
  assertSuccessful(source, taskId, targetVersion);
  const attempt = source.toolAttempts[0];
  const pin: DependencyLineage = {
    version: 1,
    dependencyStepKey: source.stepKey,
    sourcePlanVersionId: source.planVersionId,
    sourceStepId: source.id,
    sourceAttemptId: attempt.id,
    sourceResultSha256: actionArgumentDigest(attempt.resultSummary as Record<string, unknown>),
    sourceArgsSha256: attempt.argsDigest,
    dataClass: source.dataClass,
  };
  return parseDependencyLineage([pin] as unknown as Prisma.JsonValue)[0];
}

export async function verifyDependencyLineage(
  db: Prisma.TransactionClient,
  taskId: string,
  targetVersion: number,
  pin: DependencyLineage,
): Promise<Source> {
  parseDependencyLineage([pin] as unknown as Prisma.JsonValue);
  const source = await db.msaidiziTaskStep.findFirst({
    where: {
      id: pin.sourceStepId,
      taskId,
      planVersionId: pin.sourcePlanVersionId,
      stepKey: pin.dependencyStepKey,
    },
    include: sourceInclude,
  });
  assertSuccessful(source, taskId, targetVersion);
  const attempt = source.toolAttempts[0];
  if (
    source.id !== pin.sourceStepId ||
    source.planVersionId !== pin.sourcePlanVersionId ||
    source.stepKey !== pin.dependencyStepKey ||
    source.dataClass !== pin.dataClass ||
    attempt.id !== pin.sourceAttemptId ||
    attempt.argsDigest !== pin.sourceArgsSha256 ||
    actionArgumentDigest(attempt.resultSummary as Record<string, unknown>) !==
      pin.sourceResultSha256
  ) {
    throw new MsaidiziInputBindingError(
      'INPUT_BINDING_LINEAGE_DIGEST_MISMATCH',
      'Prior-plan source no longer matches its immutable pin',
    );
  }
  return source;
}

function invalid(): never {
  throw new MsaidiziInputBindingError(
    'INPUT_BINDING_LINEAGE_INVALID',
    'Malformed or duplicate dependency lineage',
  );
}
