/**
 * Reversibility classification.
 *
 * Permission decides *whether* an action is allowed. This decides *how* it may be
 * taken by an agent, which is a different question and needs a different answer.
 *
 * A role was written on the assumption that a human is at the controls: someone
 * who performs the action once, deliberately, looking at a screen that shows what
 * is about to happen. Handed to an agent, that same role permits performing it
 * fifty times, or performing a semantically valid but wrong version of it. The
 * permission check cannot tell those cases apart, so this axis exists to.
 *
 * Deliberately NOT derived from `deriveSeverity()` in audit-logs.service.ts —
 * that classifies audit *interest*, which is a different axis. LOGIN is HIGH
 * severity and harmless; DOCUMENT_DOWNLOAD is CRITICAL because it is sensitive
 * access, not because it destroys anything.
 */

export type ReversibilityTier =
  /** Reads. Safe to run unattended within the user's permissions. */
  | 'green'
  /** Writes that can be undone: drafts, descriptive edits, additive records. */
  | 'amber'
  /** Irreversible, financial, or security-relevant. Confirm before executing. */
  | 'red';

/** The subset of a Capability this module needs. Keeps the two files decoupled. */
export interface TierInput {
  verb: string;
  path: string;
  permissions: string[];
  anyPermissions: string[];
}

export interface TierVerdict {
  tier: ReversibilityTier;
  reason: string;
}

/**
 * Action suffixes that mean the effect leaves the system, moves money, or cannot
 * be walked back by writing another record. Matched against the segment after the
 * first dot in a permission code (`payables.pay` → `pay`).
 */
const RED_ACTIONS = new Set([
  'delete',
  'post',
  'pay',
  'reverse',
  'void',
  'cancel',
  'approve',
  'reject',
  'finalize',
  'revoke',
  'settle',
  'dispose',
  'invalidate',
  'purchase',
  'send',
  'close',
  'assign_roles',
  'confirm',
  'release',
  'terminate',
  'restore',
]);

/**
 * Permission-code prefixes where *any* write is red: money movement, the
 * accounting close, and anything that changes who can do what.
 */
const RED_MODULES = new Set([
  // Security and access — a wrong write here changes the envelope itself
  'permissions',
  'roles',
  'security',
  'api_keys',
  'api-keys',
  'api_clients',
  'data_isolation',
  'user_security_profiles',
  // Ledger and close — writes here are accounting facts, not app state
  'journal_entries',
  'posting_rules',
  'posting_runs',
  'period_close',
  'accounting_locks',
  'accounting_periods',
  'fiscal_years',
  'chart_of_accounts',
  // Money leaving or entering
  'payments',
  'customer_payments',
  'external_payments',
  'cash_accounts',
  'bank_accounts',
  'bank_reconciliations',
  'loans',
  'debts',
  'refunds',
  'credit_notes',
  // Irreversible infrastructure
  'backups',
  'backup_jobs',
  'backup_runs',
  'data_exports',
]);

/** Ordered rules. First match wins; each names itself for the audit trail. */
const RULES: Array<{ name: string; tier: ReversibilityTier; test: (c: TierInput) => boolean }> = [
  {
    name: 'read-verb',
    tier: 'green',
    test: (c) => c.verb === 'GET' || c.verb === 'HEAD' || c.verb === 'OPTIONS',
  },
  {
    name: 'delete-verb',
    tier: 'red',
    test: (c) => c.verb === 'DELETE',
  },
  {
    name: 'red-action',
    tier: 'red',
    test: (c) => allCodes(c).some((code) => RED_ACTIONS.has(actionOf(code))),
  },
  {
    name: 'red-module',
    tier: 'red',
    test: (c) => allCodes(c).some((code) => RED_MODULES.has(moduleOf(code))),
  },
  {
    name: 'write-verb',
    tier: 'amber',
    test: (c) => c.verb === 'POST' || c.verb === 'PATCH' || c.verb === 'PUT',
  },
];

function allCodes(c: TierInput): string[] {
  return [...c.permissions, ...c.anyPermissions];
}

/** `payables.pay` → `pay`; `hr.leave_requests.approve` → `approve`. */
function actionOf(code: string): string {
  const parts = code.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/** `payables.pay` → `payables`. */
function moduleOf(code: string): string {
  return code.split('.')[0] ?? '';
}

/**
 * Classifies a capability. Unmatched routes fall through to `red` rather than a
 * permissive default: an endpoint nobody has classified is exactly the one an
 * agent should not invoke unattended. The drift spec fails on these, so the
 * fallback is a safety net, not a resting state.
 */
export function classifyTier(capability: TierInput): TierVerdict {
  for (const rule of RULES) {
    if (rule.test(capability)) return { tier: rule.tier, reason: rule.name };
  }
  return { tier: 'red', reason: 'unclassified-fallback' };
}

/** Tier ordering, for "is this at least as dangerous as" comparisons. */
export const TIER_RANK: Record<ReversibilityTier, number> = { green: 0, amber: 1, red: 2 };
