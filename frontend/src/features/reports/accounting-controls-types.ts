import {
  entryAmount,
  statementAmount,
  statementUnits,
  validStatementDate,
} from './reconciliation-types';
import { localToday } from '@/features/invoice-desk/types';

export const controlDefinitions = {
  'posting-runs': {
    title: 'Posting Runs',
    singular: 'posting run',
    permission: 'posting_runs',
    number: 'postingRunNumber',
    prefix: 'PR',
    subtitle: 'Follow posting activity and review run references.',
    statuses: ['DRAFT', 'POSTED', 'FAILED', 'REVERSED', 'CANCELLED'],
  },
  'period-close': {
    title: 'Period Close',
    singular: 'period close',
    permission: 'period_close',
    number: 'closeNumber',
    prefix: 'PC',
    subtitle: 'Review each accounting period and control when it closes.',
    statuses: ['DRAFT', 'REVIEWING', 'CLOSED', 'REOPENED', 'CANCELLED'],
  },
  'accounting-locks': {
    title: 'Accounting Locks',
    singular: 'accounting lock',
    permission: 'accounting_locks',
    number: 'lockCode',
    prefix: 'LOCK',
    subtitle: 'Protect accounting periods, dates and modules from changes.',
    statuses: ['ACTIVE', 'INACTIVE', 'RELEASED'],
  },
  'audit-adjustments': {
    title: 'Audit Adjustments',
    singular: 'audit adjustment',
    permission: 'audit_adjustments',
    number: 'adjustmentNumber',
    prefix: 'AA',
    subtitle: 'Prepare balanced adjustments and follow their approval history.',
    statuses: ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED', 'REJECTED', 'CANCELLED'],
  },
  depreciation: {
    title: 'Depreciation',
    singular: 'depreciation schedule',
    permission: 'depreciation',
    number: 'scheduleNumber',
    prefix: 'DEP',
    subtitle: 'Review asset schedules, prepare entries and post depreciation.',
    statuses: ['ACTIVE', 'COMPLETED', 'PAUSED', 'CANCELLED'],
  },
} as const;
export type ControlKind = keyof typeof controlDefinitions;
export const isControlKind = (value: string): value is ControlKind =>
  Object.hasOwn(controlDefinitions, value);
export type ControlRecord = {
  id: string;
  companyId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  postingRunNumber?: string;
  closeNumber?: string;
  lockCode?: string;
  adjustmentNumber?: string;
  scheduleNumber?: string;
  sourceType?: string;
  sourceId?: string;
  postingRuleId?: string;
  journalEntryId?: string;
  reversalJournalEntryId?: string;
  totalDebit?: string | number;
  totalCredit?: string | number;
  currency?: string;
  errorMessage?: string;
  postedAt?: string;
  reversedAt?: string;
  closedAt?: string;
  reopenedAt?: string;
  releasedAt?: string;
  fiscalYearId?: string;
  accountingPeriodId?: string;
  reviewNotes?: string;
  description?: string;
  reason?: string;
  lockType?: string;
  moduleName?: string;
  lockedFrom?: string;
  lockedTo?: string;
  fixedAssetId?: string;
  depreciationMethod?: string;
  startDate?: string;
  endDate?: string;
  usefulLifeMonths?: number;
  salvageValue?: string | number;
  depreciationRate?: string | number;
  totalDepreciableAmount?: string | number;
  accumulatedDepreciation?: string | number;
  lines?: {
    id?: string;
    accountId: string;
    description?: string;
    debit: string | number;
    credit: string | number;
  }[];
};
export type ControlChoice = {
  id: string;
  name?: string;
  code?: string;
  companyId?: string;
  fiscalYearId?: string;
  status?: string;
  isActive?: boolean;
  accountCode?: string;
  accountName?: string;
  assetCode?: string;
  acquisitionCost?: string | number;
  residualValue?: string | number;
  usefulLifeYears?: number;
  depreciationRate?: string | number;
};
export type DepreciationEntry = {
  id: string;
  depreciationDate: string;
  amount: string | number;
  accumulatedDepreciationAfter: string | number;
  status: string;
  journalEntryId?: string;
  deletedAt?: string;
};
export type ControlTarget =
  | { kind: 'control-create'; control: ControlKind; companyId?: string }
  | { kind: 'control-action'; control: ControlKind; id: string; action: string; entryId?: string };
export type ControlValues = {
  fields: Record<string, string>;
  lines: { accountId: string; description: string; debit: string; credit: string }[];
};
export const blankAdjustmentLine = () => ({
  accountId: '',
  description: '',
  debit: '0',
  credit: '0',
});
export function assetScheduleDefaults(asset?: ControlChoice) {
  let totalDepreciableAmount = '';
  try {
    if (asset?.acquisitionCost != null) {
      const total =
        statementUnits(String(asset.acquisitionCost)) -
        statementUnits(String(asset.residualValue ?? '0'));
      totalDepreciableAmount = statementAmount(total > 0n ? total : 0n).replaceAll(',', '');
    }
  } catch {
    // Require manual review instead of prefilling a rounded or invalid amount.
    totalDepreciableAmount = '';
  }
  return {
    usefulLifeMonths: asset?.usefulLifeYears ? String(asset.usefulLifeYears * 12) : '',
    salvageValue: String(asset?.residualValue ?? '0'),
    depreciationRate: asset?.depreciationRate == null ? '' : String(asset.depreciationRate),
    totalDepreciableAmount,
    accumulatedDepreciation: '0',
  };
}
export function initialControlValues(kind: ControlKind, companyId: string): ControlValues {
  const definition = controlDefinitions[kind];
  return {
    fields: {
      companyId,
      [definition.number]: `${definition.prefix}-${localToday().replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      sourceType: 'MANUAL',
      sourceId: `manual-${crypto.randomUUID()}`,
      postingRuleId: '',
      totalDebit: '0',
      totalCredit: '0',
      currency: 'TZS',
      errorMessage: '',
      fiscalYearId: '',
      accountingPeriodId: '',
      reviewNotes: '',
      description: '',
      reason: '',
      lockType: 'PERIOD_LOCK',
      moduleName: '',
      lockedFrom: '',
      lockedTo: '',
      fixedAssetId: '',
      depreciationMethod: 'STRAIGHT_LINE',
      startDate: localToday(),
      endDate: '',
      usefulLifeMonths: '60',
      salvageValue: '0',
      depreciationRate: '',
      totalDepreciableAmount: '0',
      accumulatedDepreciation: '0',
      status: 'ACTIVE',
    },
    lines: [blankAdjustmentLine(), blankAdjustmentLine()],
  };
}
export const recordLabel = (kind: ControlKind, row: ControlRecord) =>
  row[controlDefinitions[kind].number] || row.id;
export const choiceLabel = (row: ControlChoice) =>
  row.accountCode
    ? `${row.accountCode} · ${row.accountName}`
    : [row.code || row.assetCode, row.name].filter(Boolean).join(' · ') || row.id;
export const humanLabel = (value?: string) =>
  value
    ? value
        .toLowerCase()
        .replaceAll('_', ' ')
        .replace(/^./, (c) => c.toUpperCase())
    : '—';
export const sourceTypes = [
  'SALES_ORDER',
  'POS_TRANSACTION',
  'PURCHASE_ORDER',
  'EXPENSE',
  'RECEIVABLE',
  'PAYABLE',
  'PAYROLL_RUN',
  'SALARY_PAYMENT',
  'RENT_INVOICE',
  'RENT_PAYMENT',
  'PARKING_SESSION',
  'PARKING_PAYMENT',
  'ROOM_BOOKING',
  'RESTAURANT_ORDER',
  'FUEL_DELIVERY',
  'FUEL_SHIFT',
  'STOCK_ADJUSTMENT',
  'INVENTORY_MOVEMENT',
  'FIXED_ASSET',
  'DEPRECIATION',
  'LOAN_REPAYMENT',
  'TAX_RETURN',
  'PROJECT_BILLING',
  'MANUAL',
  'OTHER',
];
export const lockTypes = ['PERIOD_LOCK', 'FISCAL_YEAR_LOCK', 'MODULE_LOCK', 'CUSTOM'];
export const depreciationMethods = ['STRAIGHT_LINE', 'REDUCING_BALANCE', 'MANUAL', 'OTHER'];
export type ControlAction = {
  id: string;
  label: string;
  permission: string;
  statuses: readonly string[];
  effect: string;
};
export const controlActions: Record<ControlKind, ControlAction[]> = {
  'posting-runs': [
    {
      id: 'post',
      label: 'Mark run posted',
      permission: 'posting_runs.post',
      statuses: ['DRAFT'],
      effect:
        'Update this tracking record to Posted. This action does not create or post a journal entry.',
    },
    {
      id: 'reverse',
      label: 'Mark run reversed',
      permission: 'posting_runs.reverse',
      statuses: ['POSTED'],
      effect:
        'Update this tracking record to Reversed. Any journal reversal must be handled in its source workflow.',
    },
  ],
  'period-close': [
    {
      id: 'close',
      label: 'Close period',
      permission: 'period_close.close',
      statuses: ['DRAFT', 'REVIEWING', 'REOPENED'],
      effect:
        'Close this accounting period and activate its period lock. Outstanding draft journals will block closure.',
    },
    {
      id: 'reopen',
      label: 'Reopen period',
      permission: 'period_close.reopen',
      statuses: ['CLOSED'],
      effect:
        'Reopen the accounting period and release its active period locks. Other applicable locks still apply.',
    },
  ],
  'accounting-locks': [
    {
      id: 'release',
      label: 'Release lock',
      permission: 'accounting_locks.release',
      statuses: ['ACTIVE'],
      effect:
        'Release this lock. Changes remain subject to other active locks, period status and your permissions.',
    },
  ],
  'audit-adjustments': [
    {
      id: 'submit',
      label: 'Submit adjustment',
      permission: 'audit_adjustments.create',
      statuses: ['DRAFT'],
      effect: 'Send this adjustment for approval.',
    },
    {
      id: 'approve',
      label: 'Approve adjustment',
      permission: 'audit_adjustments.approve',
      statuses: ['SUBMITTED'],
      effect: 'Approve the submitted adjustment for posting.',
    },
    {
      id: 'post',
      label: 'Post adjustment',
      permission: 'audit_adjustments.post',
      statuses: ['APPROVED'],
      effect: 'Create and post the balanced adjustment journal, subject to accounting controls.',
    },
    {
      id: 'reverse',
      label: 'Reverse adjustment',
      permission: 'audit_adjustments.post',
      statuses: ['POSTED'],
      effect: 'Create a reversal journal for this posted adjustment. A reason is required.',
    },
  ],
  depreciation: [
    {
      id: 'generate',
      label: 'Generate entries',
      permission: 'depreciation.create',
      statuses: ['ACTIVE'],
      effect:
        'Prepare draft entries from the next available month. Generating again prepares additional months; it does not post journals.',
    },
    {
      id: 'entries',
      label: 'Add manual entry',
      permission: 'depreciation.create',
      statuses: ['ACTIVE'],
      effect:
        'Add a draft depreciation entry for this schedule. Review the amount and accumulated total before posting.',
    },
    {
      id: 'post-entry',
      label: 'Post depreciation entry',
      permission: 'depreciation.post_entry',
      statuses: ['ACTIVE', 'COMPLETED', 'PAUSED'],
      effect:
        'Post this draft entry to depreciation expense and accumulated depreciation, and update the asset book value.',
    },
  ],
};
export function controlAmount(value: string, label: string, positive = false) {
  if (!value.trim()) throw new Error(`Enter ${label.toLowerCase()}.`);
  const amount = entryAmount(value);
  if (amount < 0 || (positive && amount === 0))
    throw new Error(`${label} must be ${positive ? 'greater than zero' : 'zero or greater'}.`);
  return amount;
}
export function wholeNumber(value: string, label: string, max = 12000) {
  const result = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(result) || result < 1 || result > max)
    throw new Error(`${label} must be a whole number from 1 to ${max}.`);
  return result;
}
export function dateRange(start: string, end: string, required = false) {
  if (
    (required && !start) ||
    (start && !validStatementDate(start)) ||
    (end && !validStatementDate(end)) ||
    (start && end && start > end)
  )
    throw new Error('Enter valid dates, with the start on or before the end.');
}
export function adjustmentTotals(lines: ControlValues['lines']) {
  return lines.reduce(
    (sum, line) => ({
      debit: sum.debit + statementUnits(line.debit || '0'),
      credit: sum.credit + statementUnits(line.credit || '0'),
    }),
    { debit: 0n, credit: 0n },
  );
}
export function controlCreateBody(kind: ControlKind, values: ControlValues) {
  const f = values.fields,
    definition = controlDefinitions[kind];
  if (!f.companyId || !f[definition.number]?.trim())
    throw new Error('Choose a company and enter a reference.');
  const base = { companyId: f.companyId, [definition.number]: f[definition.number].trim() };
  const period = {
    fiscalYearId: f.fiscalYearId || undefined,
    accountingPeriodId: f.accountingPeriodId || undefined,
  };
  if (kind === 'posting-runs') {
    if (!sourceTypes.includes(f.sourceType) || !f.sourceId.trim())
      throw new Error('Choose a source type and enter its reference.');
    if (!/^[A-Z]{3}$/.test(f.currency)) throw new Error('Enter a three-letter currency code.');
    return {
      ...base,
      sourceType: f.sourceType,
      sourceId: f.sourceId.trim(),
      postingRuleId: f.postingRuleId.trim() || undefined,
      totalDebit: controlAmount(f.totalDebit, 'Total debit'),
      totalCredit: controlAmount(f.totalCredit, 'Total credit'),
      currency: f.currency,
      errorMessage: f.errorMessage.trim() || undefined,
    };
  }
  if (kind === 'period-close') {
    if (!f.fiscalYearId || !f.accountingPeriodId)
      throw new Error('Choose a fiscal year and accounting period.');
    return { ...base, ...period, reviewNotes: f.reviewNotes.trim() || undefined };
  }
  if (kind === 'accounting-locks') {
    dateRange(f.lockedFrom, f.lockedTo);
    if (!lockTypes.includes(f.lockType)) throw new Error('Choose a lock type.');
    if (f.lockType === 'MODULE_LOCK' && !f.moduleName.trim())
      throw new Error('Enter the module to lock.');
    return {
      ...base,
      ...period,
      lockType: f.lockType,
      moduleName: f.moduleName.trim() || undefined,
      lockedFrom: f.lockedFrom || undefined,
      lockedTo: f.lockedTo || undefined,
      reason: f.reason.trim() || undefined,
    };
  }
  if (kind === 'audit-adjustments') {
    if (!f.description.trim() || !f.reason.trim())
      throw new Error('Enter a description and reason.');
    if (values.lines.length < 2) throw new Error('Add at least two adjustment lines.');
    const lines = values.lines.map((line, i) => {
      if (!line.accountId) throw new Error(`Choose an account for line ${i + 1}.`);
      if (
        statementUnits(line.debit || '0') % 100n !== 0n ||
        statementUnits(line.credit || '0') % 100n !== 0n
      )
        throw new Error(`Line ${i + 1} supports two decimal places. Do not round it to continue.`);
      const debit = controlAmount(line.debit, `Line ${i + 1} debit`),
        credit = controlAmount(line.credit, `Line ${i + 1} credit`);
      if (debit > 0 === credit > 0)
        throw new Error(`Line ${i + 1} needs either a debit or a credit.`);
      return {
        accountId: line.accountId,
        description: line.description.trim() || undefined,
        debit,
        credit,
      };
    });
    const total = adjustmentTotals(values.lines);
    if (total.debit !== total.credit)
      throw new Error('Total debits and credits must balance exactly.');
    return {
      ...base,
      ...period,
      description: f.description.trim(),
      reason: f.reason.trim(),
      lines,
    };
  }
  dateRange(f.startDate, f.endDate, true);
  if (!f.fixedAssetId || !depreciationMethods.includes(f.depreciationMethod))
    throw new Error('Choose an asset and depreciation method.');
  const usefulLifeMonths = f.usefulLifeMonths
    ? wholeNumber(f.usefulLifeMonths, 'Useful life')
    : undefined;
  if (
    f.depreciationRate &&
    (!/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/.test(f.depreciationRate) || Number(f.depreciationRate) <= 0)
  )
    throw new Error(
      'Enter an annual rate above zero and at most 1, with up to six decimal places.',
    );
  const depreciationRate = f.depreciationRate ? Number(f.depreciationRate) : undefined;
  if (depreciationRate && depreciationRate > 1)
    throw new Error('Enter the annual rate as a fraction, for example 0.25 for 25%.');
  if (f.depreciationMethod === 'STRAIGHT_LINE' && !usefulLifeMonths)
    throw new Error('Straight-line depreciation requires a useful life.');
  if (f.depreciationMethod === 'REDUCING_BALANCE' && !usefulLifeMonths && !depreciationRate)
    throw new Error('Reducing-balance depreciation requires a useful life or annual rate.');
  const totalDepreciableAmount = controlAmount(
      f.totalDepreciableAmount,
      'Depreciable amount',
      true,
    ),
    accumulatedDepreciation = controlAmount(f.accumulatedDepreciation, 'Accumulated depreciation');
  if (accumulatedDepreciation > totalDepreciableAmount)
    throw new Error('Accumulated depreciation cannot exceed the depreciable amount.');
  if (!(controlDefinitions.depreciation.statuses as readonly string[]).includes(f.status))
    throw new Error('Choose a schedule status.');
  return {
    ...base,
    fixedAssetId: f.fixedAssetId,
    depreciationMethod: f.depreciationMethod,
    startDate: `${f.startDate}T00:00:00.000Z`,
    endDate: f.endDate ? `${f.endDate}T00:00:00.000Z` : undefined,
    usefulLifeMonths,
    salvageValue: controlAmount(f.salvageValue, 'Salvage value'),
    depreciationRate,
    totalDepreciableAmount,
    accumulatedDepreciation,
    status: f.status,
  };
}
