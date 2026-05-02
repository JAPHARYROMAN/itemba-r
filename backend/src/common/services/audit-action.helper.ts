import { AuditSeverity } from '@prisma/client';

/**
 * P2-06: Canonical audit action vocabulary + severity classification.
 *
 * Two related problems the platform had before this helper landed:
 *   1. Action names drifted: some services logged `CREATE` / `UPDATE` /
 *      `DELETE` (generic), others logged `BANK_ACCOUNT_CREATE` (specific).
 *      Audit reports could not group by entity-action because the schema
 *      was not consistent.
 *   2. Severity was hand-set per call. A `delete` against a bank account
 *      and a `delete` against a help-article both logged `MEDIUM`, when
 *      one is a Group-Control event and the other is housekeeping.
 *
 * This helper produces both pieces from one input. Services should call:
 *
 *   const { action, severity } = auditFor('BankAccount', 'DELETE');
 *   await this.auditLogs.log({ action, severity, ... });
 *
 * `auditFor()` is non-throwing: unknown entity/action combinations fall
 * back to the supplied verb name and a sensible default severity, so it
 * is safe to drop into any service incrementally without breaking
 * existing logs.
 */

export type AuditVerb =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VIEW'
  | 'VIEW_SENSITIVE'
  | 'POST'
  | 'REVERSE'
  | 'APPROVE'
  | 'REJECT'
  | 'CONFIRM'
  | 'CANCEL'
  | 'PAY'
  | 'CLOSE'
  | 'REOPEN'
  | 'REVOKE'
  | 'GRANT';

interface ActionMeta {
  /** Canonical action string written to AuditLog.action. */
  action: string;
  /** Severity classification for this entity-verb combination. */
  severity: AuditSeverity;
}

/**
 * Entity classification: how sensitive is this entity? Drives the severity
 * default for verbs that don't override it explicitly.
 */
const ENTITY_SENSITIVITY: Record<string, AuditSeverity> = {
  // Group Control sensitive records — every operation logs HIGH.
  BankAccount: AuditSeverity.HIGH,
  Loan: AuditSeverity.HIGH,
  Debt: AuditSeverity.HIGH,
  Contract: AuditSeverity.HIGH,
  FixedAsset: AuditSeverity.HIGH,
  CompanyProfile: AuditSeverity.HIGH,
  ApiKey: AuditSeverity.HIGH,
  ApiClient: AuditSeverity.HIGH,
  Role: AuditSeverity.HIGH,
  RolePermission: AuditSeverity.HIGH,
  UserRole: AuditSeverity.HIGH,
  UserCompanyAccess: AuditSeverity.HIGH,
  ActiveSession: AuditSeverity.HIGH,
  SecurityEvent: AuditSeverity.HIGH,
  AuditLog: AuditSeverity.HIGH,
  BackupJob: AuditSeverity.HIGH,
  BackupRun: AuditSeverity.HIGH,
  RestoreTest: AuditSeverity.HIGH,

  // Financial movement records — MEDIUM by default, HIGH for posting verbs.
  JournalEntry: AuditSeverity.MEDIUM,
  Receivable: AuditSeverity.MEDIUM,
  Payable: AuditSeverity.MEDIUM,
  Expense: AuditSeverity.MEDIUM,
  PayrollRun: AuditSeverity.MEDIUM,
  PayrollEntry: AuditSeverity.MEDIUM,
  SalaryPayment: AuditSeverity.MEDIUM,
  SalaryAdvance: AuditSeverity.MEDIUM,
  ExternalPayment: AuditSeverity.MEDIUM,
  RentPayment: AuditSeverity.MEDIUM,
  ParkingPayment: AuditSeverity.MEDIUM,
  HospitalityPayment: AuditSeverity.MEDIUM,
  FuelShift: AuditSeverity.MEDIUM,
  FuelDelivery: AuditSeverity.MEDIUM,
  SalesOrder: AuditSeverity.MEDIUM,
  PurchaseOrder: AuditSeverity.MEDIUM,
  GoodsReceivedNote: AuditSeverity.MEDIUM,
  SupplierInvoice: AuditSeverity.MEDIUM,

  // User lifecycle.
  User: AuditSeverity.MEDIUM,
  UserSecurityProfile: AuditSeverity.HIGH,

  // Operational records — LOW by default.
  Customer: AuditSeverity.LOW,
  Supplier: AuditSeverity.LOW,
  Product: AuditSeverity.LOW,
  ProductCategory: AuditSeverity.LOW,
  InventoryMovement: AuditSeverity.LOW,
  StockAdjustment: AuditSeverity.MEDIUM,
};

/**
 * Verb-level severity overrides. A `POST`, `APPROVE`, or `REVERSE` is more
 * sensitive than a `CREATE` or `UPDATE` regardless of entity, because those
 * verbs mutate accounting truth.
 */
const VERB_FLOOR: Partial<Record<AuditVerb, AuditSeverity>> = {
  POST: AuditSeverity.HIGH,
  REVERSE: AuditSeverity.HIGH,
  APPROVE: AuditSeverity.HIGH,
  REVOKE: AuditSeverity.HIGH,
  PAY: AuditSeverity.HIGH,
  VIEW_SENSITIVE: AuditSeverity.HIGH,
  GRANT: AuditSeverity.HIGH,
  DELETE: AuditSeverity.MEDIUM,
  CANCEL: AuditSeverity.MEDIUM,
  REJECT: AuditSeverity.MEDIUM,
  CONFIRM: AuditSeverity.MEDIUM,
  CLOSE: AuditSeverity.MEDIUM,
  REOPEN: AuditSeverity.MEDIUM,
};

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

/**
 * Convert PascalCase entity name to SCREAMING_SNAKE_CASE for the action prefix.
 *   "BankAccount" -> "BANK_ACCOUNT"
 *   "JournalEntry" -> "JOURNAL_ENTRY"
 *   "User" -> "USER"
 */
function entityToActionPrefix(entityType: string): string {
  return entityType
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/**
 * Resolve the canonical action string and severity for an (entity, verb)
 * pair. The action follows `<ENTITY>_<VERB>` (e.g. `BANK_ACCOUNT_DELETE`).
 * The severity is the maximum of the entity floor and the verb floor.
 */
export function auditFor(
  entityType: string,
  verb: AuditVerb,
  overrides?: { actionSuffix?: string; severityFloor?: AuditSeverity },
): ActionMeta {
  const entitySev = ENTITY_SENSITIVITY[entityType] ?? AuditSeverity.LOW;
  const verbSev = VERB_FLOOR[verb] ?? AuditSeverity.LOW;
  const floor = overrides?.severityFloor ?? AuditSeverity.LOW;
  const severity = pickHighestSeverity([entitySev, verbSev, floor]);

  const suffix = overrides?.actionSuffix ? `_${overrides.actionSuffix}` : '';
  const action = `${entityToActionPrefix(entityType)}_${verb}${suffix}`;
  return { action, severity };
}

function pickHighestSeverity(values: AuditSeverity[]): AuditSeverity {
  let best: AuditSeverity = AuditSeverity.LOW;
  for (const v of values) {
    if (SEVERITY_RANK[v] > SEVERITY_RANK[best]) best = v;
  }
  return best;
}
