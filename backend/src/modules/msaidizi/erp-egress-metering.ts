import { createHash } from 'node:crypto';
import { canonicaliseActionValue } from '../../common/utils/canonical-digest';

export const ERP_EGRESS_CONTEXT_HEADER = 'x-msaidizi-erp-egress-context';
export const ERP_EGRESS_MEASUREMENT_HEADER = 'x-msaidizi-erp-egress-measurement';

const CONTEXT_KIND = 'msaidizi-erp-egress-context/v1';
const MEASUREMENT_KIND = 'msaidizi-erp-egress-measurement/v1';
const RECEIPT_KIND = 'msaidizi-erp-egress-receipt/v1';
const SHA256 = /^[a-f0-9]{64}$/;

export interface ErpEgressInvocationBinding {
  taskId: string;
  planVersionId: string;
  stepId: string;
  attemptId: string;
  capabilityId: string;
  capabilityVersion: string;
  argumentsSha256: string;
  reservedExternalEgressBytes: number;
}

export interface ErpEgressAdapterMeasurement {
  kind: typeof MEASUREMENT_KIND;
  /** Digest of the exact request context header supplied to the adapter. */
  contextSha256: string;
  /** Adapter-generated durable/deterministic identifier for this network attempt. */
  measurementId: string;
  destinationSha256: string;
  outcome: 'completed' | 'failed' | 'unknown';
  measuredExternalEgressBytes: number;
  uncertainExternalEgressBytes: number;
}

export interface ErpEgressMeteringReceipt extends ErpEgressInvocationBinding {
  kind: typeof RECEIPT_KIND;
  contextSha256: string;
  measurementId: string;
  destinationSha256: string;
  outcome: 'completed' | 'failed' | 'unknown';
  measuredExternalEgressBytes: number;
  uncertainExternalEgressBytes: number;
  chargedExternalEgressBytes: number;
  httpStatus: number;
  resultSha256: string;
  /** SHA-256 of every preceding claim; exact replay is therefore deterministic. */
  receiptId: string;
}

export interface ErpEgressRequestContext extends ErpEgressInvocationBinding {
  kind: typeof CONTEXT_KIND;
}

export type ErpEgressReceiptVerification =
  | { ok: true; receipt: ErpEgressMeteringReceipt }
  | { ok: false; code: string };

/** Strict context passed only over the authenticated loopback request. */
export function encodeErpEgressRequestContext(binding: ErpEgressInvocationBinding): {
  header: string;
  sha256: string;
} {
  assertInvocationBinding(binding);
  const context: ErpEgressRequestContext = { kind: CONTEXT_KIND, ...binding };
  return {
    header: Buffer.from(JSON.stringify(context), 'utf8').toString('base64url'),
    sha256: digest(context),
  };
}

/** Adapter helper: serializes a measurement without making it a trusted receipt. */
export function encodeErpEgressAdapterMeasurement(
  measurement: ErpEgressAdapterMeasurement,
): string {
  assertAdapterMeasurement(measurement);
  return Buffer.from(JSON.stringify(measurement), 'utf8').toString('base64url');
}

/**
 * The loopback invoker is the trust boundary that turns a strict adapter
 * measurement into a receipt bound to the exact task action and raw result.
 */
export function issueErpEgressMeteringReceipt(input: {
  binding: ErpEgressInvocationBinding;
  contextSha256: string;
  measurementHeader: string | null;
  httpStatus: number;
  resultSha256: string;
}): ErpEgressReceiptVerification {
  try {
    assertInvocationBinding(input.binding);
    assertSha256(input.contextSha256, 'contextSha256');
    assertHttpStatus(input.httpStatus);
    assertSha256(input.resultSha256, 'resultSha256');
    if (!input.measurementHeader) return { ok: false, code: 'ERP_EGRESS_RECEIPT_MISSING' };
    const measurement = parseAdapterMeasurement(input.measurementHeader);
    if (measurement.contextSha256 !== input.contextSha256) {
      return { ok: false, code: 'ERP_EGRESS_CONTEXT_MISMATCH' };
    }
    const observed =
      measurement.measuredExternalEgressBytes + measurement.uncertainExternalEgressBytes;
    if (!Number.isSafeInteger(observed) || observed > input.binding.reservedExternalEgressBytes) {
      return { ok: false, code: 'ERP_EGRESS_RECEIPT_OVER_RESERVATION' };
    }
    const charged =
      measurement.outcome === 'unknown' ? input.binding.reservedExternalEgressBytes : observed;
    if (
      (measurement.outcome === 'completed' &&
        (input.httpStatus < 200 || input.httpStatus >= 300)) ||
      (measurement.outcome === 'failed' && input.httpStatus >= 200 && input.httpStatus < 300)
    ) {
      return { ok: false, code: 'ERP_EGRESS_OUTCOME_MISMATCH' };
    }

    const claims = {
      kind: RECEIPT_KIND,
      ...input.binding,
      contextSha256: input.contextSha256,
      measurementId: measurement.measurementId,
      destinationSha256: measurement.destinationSha256,
      outcome: measurement.outcome,
      measuredExternalEgressBytes: measurement.measuredExternalEgressBytes,
      uncertainExternalEgressBytes: measurement.uncertainExternalEgressBytes,
      chargedExternalEgressBytes: charged,
      httpStatus: input.httpStatus,
      resultSha256: input.resultSha256,
    } as const;
    return { ok: true, receipt: { ...claims, receiptId: digest(claims) } };
  } catch {
    return { ok: false, code: 'ERP_EGRESS_RECEIPT_MALFORMED' };
  }
}

/** Independently revalidates the invoker-issued receipt before ledger settlement. */
export function verifyErpEgressMeteringReceipt(
  value: unknown,
  expected: {
    binding: ErpEgressInvocationBinding;
    httpStatus: number;
    resultSha256: string;
  },
): ErpEgressReceiptVerification {
  try {
    assertInvocationBinding(expected.binding);
    assertHttpStatus(expected.httpStatus);
    assertSha256(expected.resultSha256, 'resultSha256');
    if (!isRecord(value)) return { ok: false, code: 'ERP_EGRESS_RECEIPT_MISSING' };
    assertExactKeys(value, [
      'argumentsSha256',
      'attemptId',
      'capabilityId',
      'capabilityVersion',
      'chargedExternalEgressBytes',
      'contextSha256',
      'destinationSha256',
      'httpStatus',
      'kind',
      'measuredExternalEgressBytes',
      'measurementId',
      'outcome',
      'planVersionId',
      'receiptId',
      'reservedExternalEgressBytes',
      'resultSha256',
      'stepId',
      'taskId',
      'uncertainExternalEgressBytes',
    ]);
    const receipt = value as unknown as ErpEgressMeteringReceipt;
    if (receipt.kind !== RECEIPT_KIND) throw new TypeError('wrong receipt kind');
    assertInvocationBinding(receipt);
    for (const key of [
      'taskId',
      'planVersionId',
      'stepId',
      'attemptId',
      'capabilityId',
      'capabilityVersion',
      'argumentsSha256',
      'reservedExternalEgressBytes',
    ] as const) {
      if (receipt[key] !== expected.binding[key]) {
        return { ok: false, code: 'ERP_EGRESS_RECEIPT_BINDING_MISMATCH' };
      }
    }
    assertSha256(receipt.contextSha256, 'contextSha256');
    assertSha256(receipt.destinationSha256, 'destinationSha256');
    assertSha256(receipt.measurementId, 'measurementId');
    assertSha256(receipt.resultSha256, 'resultSha256');
    assertSha256(receipt.receiptId, 'receiptId');
    assertHttpStatus(receipt.httpStatus);
    if (
      receipt.httpStatus !== expected.httpStatus ||
      receipt.resultSha256 !== expected.resultSha256
    ) {
      return { ok: false, code: 'ERP_EGRESS_RESULT_MISMATCH' };
    }
    if (!['completed', 'failed', 'unknown'].includes(receipt.outcome)) {
      throw new TypeError('invalid outcome');
    }
    for (const key of [
      'measuredExternalEgressBytes',
      'uncertainExternalEgressBytes',
      'chargedExternalEgressBytes',
    ] as const) {
      assertNonNegativeSafeInteger(receipt[key], key);
    }
    const observed = receipt.measuredExternalEgressBytes + receipt.uncertainExternalEgressBytes;
    if (!Number.isSafeInteger(observed) || observed > receipt.reservedExternalEgressBytes) {
      return { ok: false, code: 'ERP_EGRESS_RECEIPT_CHARGE_INVALID' };
    }
    const expectedCharge =
      receipt.outcome === 'unknown' ? receipt.reservedExternalEgressBytes : observed;
    if (
      receipt.chargedExternalEgressBytes !== expectedCharge ||
      expectedCharge > receipt.reservedExternalEgressBytes
    ) {
      return { ok: false, code: 'ERP_EGRESS_RECEIPT_CHARGE_INVALID' };
    }
    if (
      (receipt.outcome === 'completed' &&
        (receipt.httpStatus < 200 || receipt.httpStatus >= 300)) ||
      (receipt.outcome === 'failed' && receipt.httpStatus >= 200 && receipt.httpStatus < 300)
    ) {
      return { ok: false, code: 'ERP_EGRESS_OUTCOME_MISMATCH' };
    }
    const { receiptId, ...claims } = receipt;
    if (digest(claims) !== receiptId) {
      return { ok: false, code: 'ERP_EGRESS_RECEIPT_DIGEST_MISMATCH' };
    }
    return { ok: true, receipt };
  } catch {
    return { ok: false, code: 'ERP_EGRESS_RECEIPT_MALFORMED' };
  }
}

function parseAdapterMeasurement(header: string): ErpEgressAdapterMeasurement {
  if (!/^[A-Za-z0-9_-]+$/.test(header) || header.length > 4096) {
    throw new TypeError('invalid measurement encoding');
  }
  const decoded = Buffer.from(header, 'base64url').toString('utf8');
  const value = JSON.parse(decoded) as unknown;
  if (!isRecord(value)) throw new TypeError('measurement must be an object');
  assertExactKeys(value, [
    'contextSha256',
    'destinationSha256',
    'kind',
    'measuredExternalEgressBytes',
    'measurementId',
    'outcome',
    'uncertainExternalEgressBytes',
  ]);
  const measurement = value as unknown as ErpEgressAdapterMeasurement;
  assertAdapterMeasurement(measurement);
  return measurement;
}

function assertAdapterMeasurement(value: ErpEgressAdapterMeasurement): void {
  if (value.kind !== MEASUREMENT_KIND) throw new TypeError('wrong measurement kind');
  assertSha256(value.contextSha256, 'contextSha256');
  assertSha256(value.measurementId, 'measurementId');
  assertSha256(value.destinationSha256, 'destinationSha256');
  if (!['completed', 'failed', 'unknown'].includes(value.outcome)) {
    throw new TypeError('invalid outcome');
  }
  assertNonNegativeSafeInteger(value.measuredExternalEgressBytes, 'measuredExternalEgressBytes');
  assertNonNegativeSafeInteger(value.uncertainExternalEgressBytes, 'uncertainExternalEgressBytes');
}

function assertInvocationBinding(value: ErpEgressInvocationBinding): void {
  for (const key of [
    'taskId',
    'planVersionId',
    'stepId',
    'attemptId',
    'capabilityId',
    'capabilityVersion',
    'argumentsSha256',
  ] as const) {
    const raw = value[key];
    if (typeof raw !== 'string' || raw.length < 1 || raw.length > 256) {
      throw new TypeError(`invalid ${key}`);
    }
  }
  assertSha256(value.argumentsSha256, 'argumentsSha256');
  assertNonNegativeSafeInteger(value.reservedExternalEgressBytes, 'reservedExternalEgressBytes');
  if (value.reservedExternalEgressBytes <= 0) throw new TypeError('reservation must be positive');
}

function assertExactKeys(value: Record<string, unknown>, expected: string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError('unexpected receipt fields');
  }
}

function assertSha256(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`invalid ${name}`);
}

function assertHttpStatus(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 100 || Number(value) > 599) {
    throw new TypeError('invalid HTTP status');
  }
}

function assertNonNegativeSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`invalid ${name}`);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicaliseActionValue(value), 'utf16le').digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
