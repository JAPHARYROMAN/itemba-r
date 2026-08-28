import { containsPersistedSecret } from '../../common/utils/persistent-secret-redaction';
import { ModelResponse } from '../msaidizi/model-client';

export type RuntimeReasoningDecisionKind = 'CONTINUE' | 'STOP' | 'REPLAN';
export type RuntimeReasoningOutcome =
  | 'ON_TRACK'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'FAILED'
  | 'NEEDS_ATTENTION';

export interface RuntimeReadArgumentFill {
  stepKey: string;
  values: Record<string, unknown>;
}

export interface RuntimeReplanInstruction {
  orderedPendingStepKeys: string[];
  skippedPendingStepKeys: string[];
  readArgumentFills: RuntimeReadArgumentFill[];
}

export interface RuntimeReasoningDecision {
  decision: RuntimeReasoningDecisionKind;
  outcome: RuntimeReasoningOutcome;
  reasonCode: string;
  summary: string;
  confidence: number;
  replan: RuntimeReplanInstruction | null;
}

export class RuntimeReasoningOutputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeReasoningOutputError';
  }
}

const ROOT_KEYS = ['decision', 'outcome', 'reasonCode', 'summary', 'confidence', 'replan'];
const REPLAN_KEYS = ['orderedPendingStepKeys', 'skippedPendingStepKeys', 'readArgumentFills'];
const FILL_KEYS = ['stepKey', 'values'];
const DECISIONS = ['CONTINUE', 'STOP', 'REPLAN'] as const;
const OUTCOMES = ['ON_TRACK', 'COMPLETE', 'PARTIAL', 'FAILED', 'NEEDS_ATTENTION'] as const;

/** Parse a single bare JSON response. Unknown fields and tool calls fail closed. */
export function parseRuntimeReasoningDecision(response: ModelResponse): RuntimeReasoningDecision {
  const block = response.content[0];
  if (
    response.content.length !== 1 ||
    typeof block !== 'object' ||
    block === null ||
    block.type !== 'text' ||
    typeof block.text !== 'string'
  ) {
    fail('RUNTIME_MODEL_NON_TEXT_OUTPUT', 'Runtime evaluator must return exactly one text block');
  }
  if (response.stopReason && response.stopReason !== 'end_turn') {
    fail(
      'RUNTIME_MODEL_INCOMPLETE_OUTPUT',
      `Runtime evaluator stopped with ${response.stopReason}`,
    );
  }
  const text = block.text.trim();
  if (Buffer.byteLength(text, 'utf8') > 32_768) {
    fail('RUNTIME_MODEL_OUTPUT_TOO_LARGE', 'Runtime evaluator response exceeds 32 KiB');
  }
  if (containsPersistedSecret(text)) {
    fail('RUNTIME_MODEL_OUTPUT_CONTAINS_SECRET', 'Runtime evaluator returned credential-like data');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('RUNTIME_MODEL_OUTPUT_NOT_JSON', 'Runtime evaluator returned malformed JSON');
  }
  const root = object(parsed, 'response');
  exactKeys(root, ROOT_KEYS, 'response');

  const decision = enumValue(root.decision, DECISIONS, 'response.decision');
  const outcome = enumValue(root.outcome, OUTCOMES, 'response.outcome');
  const reasonCode = boundedString(root.reasonCode, 'response.reasonCode', 3, 64);
  if (!/^[A-Z][A-Z0-9_]*$/.test(reasonCode)) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', 'response.reasonCode must be SCREAMING_SNAKE_CASE');
  }
  const summary = boundedString(root.summary, 'response.summary', 1, 600);
  if (typeof root.confidence !== 'number' || !Number.isFinite(root.confidence)) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', 'response.confidence must be a finite number');
  }
  if (root.confidence < 0 || root.confidence > 1) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', 'response.confidence must be between 0 and 1');
  }

  let replan: RuntimeReplanInstruction | null = null;
  if (root.replan !== null) {
    const rawReplan = object(root.replan, 'response.replan');
    exactKeys(rawReplan, REPLAN_KEYS, 'response.replan');
    const orderedPendingStepKeys = stringArray(
      rawReplan.orderedPendingStepKeys,
      'response.replan.orderedPendingStepKeys',
      200,
    );
    const skippedPendingStepKeys = stringArray(
      rawReplan.skippedPendingStepKeys,
      'response.replan.skippedPendingStepKeys',
      200,
    );
    const rawFills = array(rawReplan.readArgumentFills, 'response.replan.readArgumentFills');
    if (rawFills.length > 200) {
      fail('RUNTIME_MODEL_SCHEMA_INVALID', 'response.replan.readArgumentFills is too large');
    }
    const readArgumentFills = rawFills.map((rawFill, index) => {
      const fill = object(rawFill, `response.replan.readArgumentFills[${index}]`);
      exactKeys(fill, FILL_KEYS, `response.replan.readArgumentFills[${index}]`);
      const stepKey = boundedString(
        fill.stepKey,
        `response.replan.readArgumentFills[${index}].stepKey`,
        1,
        64,
      );
      const values = object(fill.values, `response.replan.readArgumentFills[${index}].values`);
      if (Buffer.byteLength(JSON.stringify(values), 'utf8') > 16_384) {
        fail('RUNTIME_MODEL_SCHEMA_INVALID', `Read fill for ${stepKey} is too large`);
      }
      return { stepKey, values };
    });
    replan = { orderedPendingStepKeys, skippedPendingStepKeys, readArgumentFills };
  }

  if (decision === 'REPLAN' && !replan) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', 'REPLAN requires a replan object');
  }
  if (decision !== 'REPLAN' && replan) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', `${decision} requires replan to be null`);
  }
  return { decision, outcome, reasonCode, summary, confidence: root.confidence, replan };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail('RUNTIME_MODEL_SCHEMA_INVALID', `${path} must be an array`);
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', `${path} contains missing or unknown fields`);
  }
}

function boundedString(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', `${path} has an invalid string length`);
  }
  return value;
}

function stringArray(value: unknown, path: string, maximum: number): string[] {
  const values = array(value, path);
  if (values.length > maximum) fail('RUNTIME_MODEL_SCHEMA_INVALID', `${path} is too large`);
  return values.map((entry, index) => boundedString(entry, `${path}[${index}]`, 1, 64));
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    fail('RUNTIME_MODEL_SCHEMA_INVALID', `${path} has an unsupported enum value`);
  }
  return value as T;
}

function fail(code: string, message: string): never {
  throw new RuntimeReasoningOutputError(code, message);
}
