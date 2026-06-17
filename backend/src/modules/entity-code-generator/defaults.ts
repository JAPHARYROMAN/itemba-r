/**
 * Default code-generation patterns per entity type.
 *
 * Used by `EntityCodeGeneratorService.next()` to lazy-create a
 * `DocumentNumberSequence` row the first time an unfamiliar entity type is
 * requested. Operators can override per-company via the
 * `/settings/number-sequences` UI; the defaults below are baselines that
 * match what the inline `nextNumber()` helpers across the codebase
 * historically produced (TRIP-2026-00001, HARV-2026-00001, etc.).
 *
 * Adding a new entity type: drop a row here, then any service that calls
 * `codes.next({ entityType: 'MyThing' })` will get the documented format
 * automatically. No migration, no seed change.
 */

import { SequenceResetFrequency } from '@prisma/client';

export interface EntityCodePattern {
  /** Static prefix string. May contain tokens — see TOKEN below. */
  prefix: string;
  /** Optional static suffix string. */
  suffix?: string;
  /** Width to which the running counter is left-padded with zeros. */
  padding: number;
  /** When NEVER, the counter grows forever. When YEARLY/MONTHLY/DAILY, it
   *  resets at the start of each new period. The reset is detected via
   *  `lastResetAt` on the sequence row. */
  resetFrequency: SequenceResetFrequency;
}

/**
 * Tokens supported in `prefix` and `suffix`. Replaced at format time using
 * the current date in the server's timezone. Example: `'TRIP-{YYYY}-'`
 * generates `'TRIP-2026-00001'` in Jan 2026.
 *
 *   {YYYY} → 4-digit year
 *   {YY}   → 2-digit year
 *   {MM}   → 2-digit month
 *   {DD}   → 2-digit day
 */
const TOKEN_PATTERN = /\{(YYYY|YY|MM|DD)\}/g;

export function interpolateTokens(template: string, when: Date = new Date()): string {
  return template.replace(TOKEN_PATTERN, (_, token) => {
    switch (token) {
      case 'YYYY':
        return String(when.getFullYear());
      case 'YY':
        return String(when.getFullYear()).slice(-2);
      case 'MM':
        return String(when.getMonth() + 1).padStart(2, '0');
      case 'DD':
        return String(when.getDate()).padStart(2, '0');
      default:
        return '';
    }
  });
}

export const DEFAULT_PATTERNS: Record<string, EntityCodePattern> = {
  // ── Itemba operational ──────────────────────────────────────────────────
  Trip: { prefix: 'TRIP-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  HarvestRecord: { prefix: 'HARV-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  ProjectMaterialIssue: { prefix: 'MATI-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  ConstructionProject: { prefix: 'PRJ-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  ProjectBilling: { prefix: 'PBI-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  SubcontractorRecord: { prefix: 'SUB-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },

  // ── Operations / sales / purchasing ─────────────────────────────────────
  SalesOrder: { prefix: 'SO-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  PurchaseOrder: { prefix: 'PO-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  Customer: { prefix: 'CUST-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  Invoice: { prefix: 'INV-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  Quotation: { prefix: 'QUO-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  ProformaInvoice: { prefix: 'PFI-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  // DeliveryNote moved to "Agriculture / operations" block below to match the
  // existing inline `DN-` prefix used by the delivery-notes service.

  // ── Finance ──────────────────────────────────────────────────────────────
  JournalEntry: { prefix: 'JE-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  Receivable: { prefix: 'REC-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  Payable: { prefix: 'AP-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  ThreeWayMatch: { prefix: 'TWM-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },

  // ── Tax ──────────────────────────────────────────────────────────────────
  TaxTransaction: { prefix: 'TX-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  TaxReturn: { prefix: 'TR-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  TaxFilingPeriod: { prefix: 'FP-{YYYY}{MM}-', padding: 3, resetFrequency: 'MONTHLY' },

  // ── Inventory ────────────────────────────────────────────────────────────
  InventoryMovement: { prefix: 'IM-{YYYY}-', padding: 7, resetFrequency: 'YEARLY' },
  StockAdjustment: { prefix: 'ADJ-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },

  // ── Petroleum ────────────────────────────────────────────────────────────
  // Prefixes match the existing inline helpers (SH-, FD-, DIP-).
  FuelShift: { prefix: 'SH-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  FuelDelivery: { prefix: 'FD-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  FuelCreditSale: { prefix: 'CSL-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },

  // ── Hospitality ──────────────────────────────────────────────────────────
  RoomBooking: { prefix: 'BKG-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  GuestFolio: { prefix: 'FOL-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },

  // ── Finance — special-purpose JE prefixes (preserve traceability) ───────
  // Each different JE type keeps its own prefix so reviewers can scan a
  // GL list and see at a glance whether a JE came from depreciation, an
  // audit adjustment, an intercompany move, etc.
  Expense: { prefix: 'EXP-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  ExpenseJournal: { prefix: 'EXP-JE-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  AuditAdjustment: { prefix: 'ADJ-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  AuditAdjustmentJournal: { prefix: 'JE-ADJ-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  AuditAdjustmentReversalJournal: {
    prefix: 'JE-ADJREV-{YYYY}-',
    padding: 6,
    resetFrequency: 'YEARLY',
  },
  DepreciationJournal: { prefix: 'JE-DEP-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  LoanJournal: { prefix: 'JE-LOAN-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  LoanRepaymentPayment: { prefix: 'LRP-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },
  IntercompanyTransaction: { prefix: 'IC-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },

  // ── Agriculture / operations (already-sequential migrations) ────────────
  // Prefixes match the existing inline helpers to avoid a format change.
  AgricultureActivity: { prefix: 'AGACT-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  EquipmentUsage: { prefix: 'EQUSE-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  FarmInputApplication: { prefix: 'INPT-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  LaborRecord: { prefix: 'LABR-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  DeliveryNote: { prefix: 'DN-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  PackageMovement: { prefix: 'PKG-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },

  // ── Petroleum (additional) ──────────────────────────────────────────────
  FuelTankDip: { prefix: 'DIP-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  AttendanceRecord: { prefix: 'ATT-{YYYY}-', padding: 6, resetFrequency: 'YEARLY' },

  // ── HR (additional) — match existing inline prefixes (DA-, ED-) ─────────
  DisciplinaryAction: { prefix: 'DA-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
  EmploymentDispute: { prefix: 'ED-{YYYY}-', padding: 5, resetFrequency: 'YEARLY' },
};

/**
 * Generic fallback used when an unknown entity type is requested. Keeps the
 * shape consistent (yearly-reset, padded, year-tokenized) but with a derived
 * prefix so the format is at least predictable.
 */
export function fallbackPattern(entityType: string): EntityCodePattern {
  const upper = entityType
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toUpperCase()
    .slice(0, 6);
  return { prefix: `${upper}-{YYYY}-`, padding: 5, resetFrequency: 'YEARLY' };
}
