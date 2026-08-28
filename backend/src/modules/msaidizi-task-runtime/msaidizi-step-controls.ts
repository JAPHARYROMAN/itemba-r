import { MsaidiziTaskStepStatus, Prisma } from '@prisma/client';

export const STEP_BUDGET_KEYS = [
  'maxWallTimeSeconds',
  'maxModelTurns',
  'maxAttemptedToolCalls',
  'maxMutations',
  'maxLocalBytes',
  'maxExternalEgressBytes',
  'maxModelCostUsd',
] as const;

export type StepBudgetKey = (typeof STEP_BUDGET_KEYS)[number];

export interface StepBudgetLimits {
  maxWallTimeSeconds?: number;
  maxModelTurns?: number;
  maxAttemptedToolCalls?: number;
  maxMutations?: number;
  maxLocalBytes?: number;
  maxExternalEgressBytes?: number;
  maxModelCostUsd?: number;
}

export type ParsedStepBudgets =
  | { ok: true; limits: StepBudgetLimits }
  | { ok: false; code: 'STEP_BUDGET_INVALID'; detail: string };

const INTEGER_BUDGETS = new Set<StepBudgetKey>([
  'maxWallTimeSeconds',
  'maxModelTurns',
  'maxAttemptedToolCalls',
  'maxMutations',
  'maxLocalBytes',
  'maxExternalEgressBytes',
]);

/**
 * Parses the immutable, persisted per-step ceiling. Unknown keys are rejected:
 * silently ignoring a misspelled ceiling would widen model-approved authority.
 * Zero is meaningful at step scope and disables that resource before dispatch.
 */
export function parseStepBudgets(value: unknown): ParsedStepBudgets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'STEP_BUDGET_INVALID', detail: 'budgets must be an object' };
  }
  const limits: StepBudgetLimits = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!STEP_BUDGET_KEYS.includes(key as StepBudgetKey)) {
      return {
        ok: false,
        code: 'STEP_BUDGET_INVALID',
        detail: `unsupported step budget ${key}`,
      };
    }
    if (
      typeof raw !== 'number' ||
      !Number.isFinite(raw) ||
      raw < 0 ||
      (INTEGER_BUDGETS.has(key as StepBudgetKey) && !Number.isSafeInteger(raw))
    ) {
      return {
        ok: false,
        code: 'STEP_BUDGET_INVALID',
        detail: `step budget ${key} must be a non-negative ${
          INTEGER_BUDGETS.has(key as StepBudgetKey) ? 'safe integer' : 'number'
        }`,
      };
    }
    limits[key as StepBudgetKey] = raw;
  }
  return { ok: true, limits };
}

export interface StepDispatchBudgetState {
  budgets: Prisma.JsonValue;
  attemptCount: number;
  mutation: boolean;
  startedAt: Date | null;
  bytesRead?: bigint;
  bytesWritten?: bigint;
  localIoAccountingValid?: boolean;
}

export type StepLocalIoState =
  | {
      ok: true;
      bytesRead: bigint;
      bytesWritten: bigint;
      maximum: bigint | null;
      remaining: bigint | null;
    }
  | { ok: false; code: 'STEP_LOCAL_IO_ACCOUNTING_INVALID'; detail: string };

/**
 * Resolves the persisted step ledger against its immutable JSON ceiling.
 * `undefined` fields are accepted only for legacy in-memory test doubles; every
 * migrated database row has concrete values. An explicit invalid marker always
 * fails closed.
 */
export function stepLocalIoState(step: {
  budgets: Prisma.JsonValue;
  bytesRead?: unknown;
  bytesWritten?: unknown;
  localIoAccountingValid?: boolean;
}): StepLocalIoState {
  const parsed = parseStepBudgets(step.budgets);
  if (!parsed.ok) {
    return { ok: false, code: 'STEP_LOCAL_IO_ACCOUNTING_INVALID', detail: parsed.detail };
  }
  if (step.localIoAccountingValid === false) {
    return {
      ok: false,
      code: 'STEP_LOCAL_IO_ACCOUNTING_INVALID',
      detail: 'historical step local-I/O usage is not exactly attributable',
    };
  }
  const bytesRead = persistedNonNegativeBigInt(step.bytesRead);
  const bytesWritten = persistedNonNegativeBigInt(step.bytesWritten);
  if (bytesRead === null || bytesWritten === null) {
    return {
      ok: false,
      code: 'STEP_LOCAL_IO_ACCOUNTING_INVALID',
      detail: 'persisted step local-I/O counters are invalid',
    };
  }
  const rawMaximum = parsed.limits.maxLocalBytes;
  const maximum = rawMaximum === undefined ? null : BigInt(rawMaximum);
  return {
    ok: true,
    bytesRead,
    bytesWritten,
    maximum,
    remaining: maximum === null ? null : maximum - bytesRead - bytesWritten,
  };
}

/** A second, race-safe gate immediately before reserving the next attempt. */
export function stepDispatchBudgetExhaustion(
  step: StepDispatchBudgetState,
  now = Date.now(),
): string | null {
  const parsed = parseStepBudgets(step.budgets);
  if (!parsed.ok) return parsed.code;
  const budget = parsed.limits;
  if (budget.maxWallTimeSeconds === 0) return 'STEP_WALL_TIME_BUDGET_EXHAUSTED';
  if (
    budget.maxWallTimeSeconds !== undefined &&
    step.startedAt &&
    now - step.startedAt.getTime() >= budget.maxWallTimeSeconds * 1_000
  ) {
    return 'STEP_WALL_TIME_BUDGET_EXHAUSTED';
  }
  if (
    budget.maxAttemptedToolCalls !== undefined &&
    step.attemptCount >= budget.maxAttemptedToolCalls
  ) {
    return 'STEP_TOOL_BUDGET_EXHAUSTED';
  }
  if (
    step.mutation &&
    budget.maxMutations !== undefined &&
    step.attemptCount >= budget.maxMutations
  ) {
    return 'STEP_MUTATION_BUDGET_EXHAUSTED';
  }
  const localIo = stepLocalIoState(step);
  if (!localIo.ok) return localIo.code;
  if (localIo.remaining !== null && localIo.remaining <= 0n) {
    return 'STEP_LOCAL_IO_BUDGET_EXHAUSTED';
  }
  return null;
}

export interface StepStopFacts {
  status: MsaidiziTaskStepStatus;
  attemptCount: number;
  resultSummary: Prisma.JsonValue | null;
}

export type StepStopEvaluation =
  | { reached: false }
  | { reached: true; code: string }
  | { reached: false; invalidCode: 'STEP_STOP_CONDITION_INVALID'; detail: string };

interface RuntimeStopConditions {
  onSuccess?: boolean;
  onFailure?: boolean;
  onEmptyResult?: boolean;
  afterAttempts?: number;
  httpStatusIn?: number[];
}

const RUNTIME_STOP_KEYS = new Set<keyof RuntimeStopConditions>([
  'onSuccess',
  'onFailure',
  'onEmptyResult',
  'afterAttempts',
  'httpStatusIn',
]);

/**
 * Evaluates only facts already committed to the central ledger. The explicit
 * `runtime` object is strict. A few legacy planner spellings are mapped at the
 * top level; all other prose conditions remain critic input and cannot create
 * a side effect by themselves.
 */
export function evaluateStepStopConditions(
  value: unknown,
  facts: StepStopFacts,
): StepStopEvaluation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      reached: false,
      invalidCode: 'STEP_STOP_CONDITION_INVALID',
      detail: 'stopConditions must be an object',
    };
  }
  const source = value as Prisma.JsonObject;
  const rawRuntime = source.runtime;
  if (
    rawRuntime !== undefined &&
    (!rawRuntime || typeof rawRuntime !== 'object' || Array.isArray(rawRuntime))
  ) {
    return {
      reached: false,
      invalidCode: 'STEP_STOP_CONDITION_INVALID',
      detail: 'stopConditions.runtime must be an object',
    };
  }
  const runtime = (rawRuntime as Prisma.JsonObject | undefined) ?? {};
  const unsupported = Object.keys(runtime).find(
    (key) => !RUNTIME_STOP_KEYS.has(key as keyof RuntimeStopConditions),
  );
  if (unsupported) {
    return {
      reached: false,
      invalidCode: 'STEP_STOP_CONDITION_INVALID',
      detail: `unsupported runtime stop condition ${unsupported}`,
    };
  }

  const combined: Prisma.JsonObject = { ...runtime };
  // Backward-compatible aliases already emitted by the planner tests.
  if (source.stopOnEmpty !== undefined) combined.onEmptyResult = source.stopOnEmpty;
  if (source.stopAfterOnePage !== undefined) combined.onSuccess = source.stopAfterOnePage;
  if (source.onFailure !== undefined) combined.onFailure = source.onFailure;
  if (source.after !== undefined) combined.afterAttempts = source.after;

  for (const key of ['onSuccess', 'onFailure', 'onEmptyResult'] as const) {
    if (combined[key] !== undefined && typeof combined[key] !== 'boolean') {
      return {
        reached: false,
        invalidCode: 'STEP_STOP_CONDITION_INVALID',
        detail: `${key} must be boolean`,
      };
    }
  }
  if (
    combined.afterAttempts !== undefined &&
    (!Number.isSafeInteger(combined.afterAttempts) || Number(combined.afterAttempts) < 1)
  ) {
    return {
      reached: false,
      invalidCode: 'STEP_STOP_CONDITION_INVALID',
      detail: 'afterAttempts must be a positive safe integer',
    };
  }
  if (
    combined.httpStatusIn !== undefined &&
    (!Array.isArray(combined.httpStatusIn) ||
      combined.httpStatusIn.length === 0 ||
      combined.httpStatusIn.length > 32 ||
      combined.httpStatusIn.some(
        (status) => !Number.isSafeInteger(status) || Number(status) < 100 || Number(status) > 599,
      ))
  ) {
    return {
      reached: false,
      invalidCode: 'STEP_STOP_CONDITION_INVALID',
      detail: 'httpStatusIn must contain between 1 and 32 HTTP status integers',
    };
  }

  if (combined.onSuccess === true && facts.status === MsaidiziTaskStepStatus.SUCCEEDED) {
    return { reached: true, code: 'STEP_STOP_ON_SUCCESS' };
  }
  if (combined.onFailure === true && facts.status === MsaidiziTaskStepStatus.FAILED) {
    return { reached: true, code: 'STEP_STOP_ON_FAILURE' };
  }
  if (
    combined.onEmptyResult === true &&
    facts.status === MsaidiziTaskStepStatus.SUCCEEDED &&
    jsonBoolean(facts.resultSummary, 'emptyResult') === true
  ) {
    return { reached: true, code: 'STEP_STOP_ON_EMPTY_RESULT' };
  }
  if (typeof combined.afterAttempts === 'number' && facts.attemptCount >= combined.afterAttempts) {
    return { reached: true, code: 'STEP_STOP_AFTER_ATTEMPTS' };
  }
  const statuses = combined.httpStatusIn;
  const actualStatus = jsonNumber(facts.resultSummary, 'httpStatus');
  if (Array.isArray(statuses) && actualStatus !== null && statuses.includes(actualStatus)) {
    return { reached: true, code: 'STEP_STOP_ON_HTTP_STATUS' };
  }
  return { reached: false };
}

export function validateStepStopConditions(
  value: unknown,
): { ok: true } | { ok: false; code: 'STEP_STOP_CONDITION_INVALID'; detail: string } {
  const evaluated = evaluateStepStopConditions(value, {
    status: MsaidiziTaskStepStatus.PENDING,
    attemptCount: 0,
    resultSummary: null,
  });
  return 'invalidCode' in evaluated
    ? { ok: false, code: evaluated.invalidCode, detail: evaluated.detail }
    : { ok: true };
}

export function resultSummaryLocalBytes(value: Prisma.JsonValue | null): bigint {
  const responseBytes = jsonNonNegativeBigInt(value, 'responseBytes');
  const read = jsonNonNegativeBigInt(value, 'localBytesRead');
  const written = jsonNonNegativeBigInt(value, 'localBytesWritten');
  return responseBytes + read + written;
}

export function resultSummaryExternalEgressBytes(value: Prisma.JsonValue | null): bigint {
  return jsonNonNegativeBigInt(value, 'totalExternalEgressBytes');
}

function jsonBoolean(value: Prisma.JsonValue | null, key: string): boolean | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Prisma.JsonObject)[key];
  return typeof candidate === 'boolean' ? candidate : null;
}

function jsonNumber(value: Prisma.JsonValue | null, key: string): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Prisma.JsonObject)[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function jsonNonNegativeBigInt(value: Prisma.JsonValue | null, key: string): bigint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0n;
  const candidate = (value as Prisma.JsonObject)[key];
  if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) {
    return BigInt(candidate);
  }
  if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return BigInt(candidate);
  return 0n;
}

function persistedNonNegativeBigInt(value: unknown): bigint | null {
  if (value === undefined) return 0n;
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}
