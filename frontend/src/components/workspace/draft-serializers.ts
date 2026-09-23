/** Versioned recovery contracts for the existing shared forms. No files, DOM state or functions. */
const contracts: Record<string, readonly string[]> = {
  'invoice-desk': ['invoice', 'edit', 'supplier', 'payment', 'void', 'reverse'],
  'cash-desk': ['account', 'movement', 'reverse'],
  'sales-desk': ['sale', 'customer', 'payment', 'void'],
  inventory: [
    'adjustment',
    'damage',
    'batch',
    'product',
    'unit',
    'conversion',
    'category',
    'family',
    'adjustment-action',
    'damage-action',
  ],
  payroll: [
    'employee',
    'employee-edit',
    'termination',
    'mobile-money',
    'department',
    'position',
    'assignment',
    'contract',
    'contract-action',
    'attendance',
    'leave-type',
    'leave-balance',
    'leave-request',
    'leave-action',
    'allowance-type',
    'deduction-type',
    'allowance',
    'deduction',
    'payroll-period',
    'payroll-run',
    'payroll-action',
    'salary-advance',
    'advance-action',
    'salary-payment-reversal',
  ],
  reports: [
    'schedule',
    'reconciliation-create',
    'reconciliation-line',
    'reconciliation-action',
    'invoice-posting',
    'cash-posting',
    'account-connection',
    'payment-link',
    'control-create',
    'control-action',
  ],
  documents: ['letter'],
};
export function draftFormType(appId: string, context: Record<string, string>) {
  return contracts[appId]?.includes(context.kind) ? `${appId}:${context.kind}:v1` : null;
}
export function serializeDraftValues(value: unknown): Record<string, unknown> {
  const visit = (v: unknown, depth: number): unknown => {
    if (depth > 12) throw new Error('This draft is too deeply nested to save.');
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))
    )
      return v;
    if (Array.isArray(v)) return v.map((item) => visit(item, depth + 1));
    if (v && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(
        Object.entries(v)
          .filter(
            ([key, item]) =>
              !['__proto__', 'constructor', 'prototype'].includes(key) && item !== undefined,
          )
          .map(([key, item]) => [key, visit(item, depth + 1)]),
      );
    throw new Error(
      'Local attachments cannot be recovered. Keep this window open and reselect them after restoring.',
    );
  };
  const result = visit(value, 0);
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    JSON.stringify(result).length > 180000
  )
    throw new Error('This form cannot be saved as a recoverable draft.');
  return result as Record<string, unknown>;
}
