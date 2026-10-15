import { backendGet, backendPatch, backendPost } from '@/lib/api-client';
import type { StockAdjustment } from './inventory-adjustment-types';

export interface CountRequest {
  companyId: string;
  divisionId?: string;
  branchId: string;
  reason: string;
  notes?: string;
  idempotencyKey: string;
  lines: {
    productId: string;
    unitId: string;
    systemQuantity: number;
    countedQuantity: number;
    expectedRevision?: number;
    unitCost?: number;
    reason?: string;
  }[];
}
export interface CountRecovery {
  request: CountRequest;
  recordId?: string;
  expectedUpdatedAt?: string;
}

// Decimal columns carry four places. Preserve exact string values, including
// large counts, while accepting tiny numeric JSON transport rounding noise.
function quantityUnits(value: unknown): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  let text = String(value).trim();
  let match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (typeof value === 'number' && (!match || (match[3]?.replace(/0+$/, '').length ?? 0) > 4)) {
    const rounded = value.toFixed(4);
    if (Math.abs(value - Number(rounded)) > 1e-9) return null;
    text = rounded;
    match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  }
  if (!match) return null;
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  if (fraction.length > 4) return null;
  const units = BigInt(match[2]) * BigInt(10000) + BigInt(fraction.padEnd(4, '0'));
  return match[1] ? -units : units;
}

const optionalText = (value: unknown) => (value == null ? '' : value);
const optionalQuantity = (value: unknown) =>
  value == null ? null : (quantityUnits(value) ?? undefined);
const changedMessage =
  'The saved count changed after it was created. Review this adjustment in the register. Your original count is retained.';

/** A status change is recoverable; a different captured count is never success. */
function assertCapturedCount(recovery: CountRecovery, row: StockAdjustment) {
  const expected = recovery.request;
  if (
    row.id !== recovery.recordId ||
    row.companyId !== expected.companyId ||
    row.branchId !== expected.branchId ||
    (expected.divisionId !== undefined && row.divisionId !== expected.divisionId) ||
    row.reason !== expected.reason ||
    optionalText(row.notes) !== optionalText(expected.notes) ||
    !Array.isArray(row.lines) ||
    row.lines.length !== expected.lines.length ||
    new Set(row.lines.map((line) => line.productId)).size !== row.lines.length ||
    new Set(expected.lines.map((line) => line.productId)).size !== expected.lines.length
  )
    throw new Error(changedMessage);
  for (const line of expected.lines) {
    const saved = row.lines.find((value) => value.productId === line.productId);
    const unitId = saved && ('unitId' in saved ? saved.unitId : saved.unit?.id);
    const system = quantityUnits(line.systemQuantity),
      counted = quantityUnits(line.countedQuantity);
    const savedCost = optionalQuantity(saved?.unitCost),
      expectedCost = optionalQuantity(line.unitCost);
    if (
      !saved ||
      unitId !== line.unitId ||
      system === null ||
      counted === null ||
      quantityUnits(saved.systemQuantity) !== system ||
      quantityUnits(saved.countedQuantity) !== counted ||
      quantityUnits(saved.varianceQuantity) !== counted - system ||
      savedCost === undefined ||
      expectedCost === undefined ||
      savedCost !== expectedCost ||
      optionalText(saved.reason) !== optionalText(line.reason)
    )
      throw new Error(changedMessage);
  }
  if (
    row.status === 'DRAFT' &&
    recovery.expectedUpdatedAt &&
    Date.parse(row.updatedAt ?? '') !== Date.parse(recovery.expectedUpdatedAt)
  )
    throw new Error(changedMessage);
}

/** Persist the identity before submission; an uncertain request always reuses it. */
export async function saveStockCount(
  recovery: CountRecovery,
  persist: (state: CountRecovery) => Promise<void>,
  submit: boolean,
): Promise<StockAdjustment> {
  let row: StockAdjustment;
  if (recovery.recordId) {
    row = await backendGet<StockAdjustment>(
      `/stock-adjustments/${encodeURIComponent(recovery.recordId)}`,
    );
  } else {
    row = await backendPost<StockAdjustment>('/stock-adjustments', recovery.request);
    if (!row?.id)
      throw new Error('The saved adjustment could not be identified. Retry this same count.');
    recovery.recordId = row.id;
    recovery.expectedUpdatedAt = row.updatedAt || undefined;
    await persist(recovery);
  }
  assertCapturedCount(recovery, row);
  if (!submit || row.status !== 'DRAFT') return row;
  const path = `/stock-adjustments/${encodeURIComponent(row.id)}`;
  try {
    const result = await backendPatch<StockAdjustment>(`${path}/submit`, {
      ...(recovery.expectedUpdatedAt ? { expectedUpdatedAt: recovery.expectedUpdatedAt } : {}),
    });
    // Submission may return only the header. Keep the captured lines in the receipt.
    const receipt = { ...row, ...result, lines: result.lines ?? row.lines };
    assertCapturedCount(recovery, receipt);
    if (receipt.status === 'DRAFT')
      throw new Error('Submission did not complete. Retry this same saved count.');
    return receipt;
  } catch (error) {
    let current: StockAdjustment;
    try {
      current = await backendGet<StockAdjustment>(path);
    } catch {
      /* Retain the draft ID until its outcome can be verified. */
      return Promise.reject(error);
    }
    assertCapturedCount(recovery, current);
    if (current.status !== 'DRAFT') return current;
    throw error;
  }
}
