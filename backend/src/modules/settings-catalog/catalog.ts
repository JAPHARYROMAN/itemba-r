/**
 * Master Settings Catalog (Sprint S1).
 *
 * Static registry of every configuration entity / page surfaced through the
 * master Settings hub. Each entry is a thin pointer to an existing route +
 * permission gate — the catalog itself does NOT execute any settings change,
 * it just tells the UI what's available, what scope the setting lives at,
 * and where to navigate to manage it.
 *
 * As new settings pages land (S2 company profile, S3 user preferences, S4
 * number sequences), they're appended here so the master hub picks them
 * up automatically.
 */

export type SettingCategory =
  | 'ORGANIZATION'
  | 'USERS_ACCESS'
  | 'ACCOUNTING'
  | 'HR'
  | 'COMPLIANCE'
  | 'OPERATIONS'
  | 'TEMPLATES'
  | 'NOTIFICATIONS'
  | 'INTEGRATIONS'
  | 'APPROVALS'
  | 'LOCALIZATION'
  | 'PREFERENCES'
  | 'SYSTEM';

export type SettingScope = 'GROUP' | 'COMPANY' | 'USER';
export type SettingStatus = 'BUILT_IN' | 'PLANNED';

export interface SettingEntry {
  id: string;
  category: SettingCategory;
  name: string;
  description: string;
  href: string;
  permission?: string;
  scope: SettingScope;
  status: SettingStatus;
}

export const SETTINGS_CATALOG: SettingEntry[] = [
  // ── ORGANIZATION ─────────────────────────────────────────────────────────
  {
    id: 'org.companies',
    category: 'ORGANIZATION',
    name: 'Companies',
    description: 'Add or edit member companies in the group.',
    href: '/companies',
    permission: 'companies.read',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'org.business-units',
    category: 'ORGANIZATION',
    name: 'Business Units',
    description: 'Licensable sub-units within a company.',
    href: '/business-units',
    permission: 'business_units.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'org.business-unit-licenses',
    category: 'ORGANIZATION',
    name: 'Business Unit Licenses',
    description: 'Operating licenses tied to business units.',
    href: '/business-units/licenses',
    permission: 'business_units.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'org.group-control',
    category: 'ORGANIZATION',
    name: 'Group Control',
    description: 'Bank accounts, loans, contracts, fixed assets at group level.',
    href: '/group-control',
    permission: 'group_control.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'org.company-profile',
    category: 'ORGANIZATION',
    name: 'Company Profile',
    description: 'Legal identity, tax registration (TIN/VRN), address, default currency.',
    href: '/settings/company-profile',
    permission: 'company-profiles.update',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── USERS & ACCESS ───────────────────────────────────────────────────────
  {
    id: 'access.users',
    category: 'USERS_ACCESS',
    name: 'Users',
    description: 'Provision, deactivate, and manage user accounts.',
    href: '/users',
    permission: 'users.read',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'access.roles',
    category: 'USERS_ACCESS',
    name: 'Roles',
    description: 'Roles + role-scope grants.',
    href: '/roles',
    permission: 'roles.read',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'access.preferences',
    category: 'PREFERENCES',
    name: 'My Preferences',
    description: 'Theme, density, locale, timezone, date/number format, default scope.',
    href: '/settings/preferences',
    scope: 'USER',
    status: 'BUILT_IN',
  },

  // ── ACCOUNTING ───────────────────────────────────────────────────────────
  {
    id: 'acct.chart-of-accounts',
    category: 'ACCOUNTING',
    name: 'Chart of Accounts',
    description: 'GL account hierarchy — per company.',
    href: '/finance/chart-of-accounts',
    permission: 'chart_of_accounts.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'acct.fiscal-years',
    category: 'ACCOUNTING',
    name: 'Fiscal Years',
    description: 'Open / close fiscal years.',
    href: '/finance/fiscal-years',
    permission: 'fiscal_years.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'acct.accounting-periods',
    category: 'ACCOUNTING',
    name: 'Accounting Periods',
    description: 'Per-period open/close + period locks.',
    href: '/finance/accounting-periods',
    permission: 'accounting_periods.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'acct.cash-accounts',
    category: 'ACCOUNTING',
    name: 'Cash Accounts',
    description: 'Cash, bank, mobile money. Each links to a GL account.',
    href: '/finance/cash-accounts',
    permission: 'cash_accounts.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'acct.expense-categories',
    category: 'ACCOUNTING',
    name: 'Expense Categories',
    description: 'Categories that map to expense GL accounts.',
    href: '/finance/expenses',
    permission: 'expenses.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'acct.number-sequences',
    category: 'ACCOUNTING',
    name: 'Number Sequences',
    description: 'Prefixes, padding, and counters for auto-generated entity numbers.',
    href: '/settings/number-sequences',
    permission: 'doc_sequences.list',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── HR ───────────────────────────────────────────────────────────────────
  {
    id: 'hr.departments',
    category: 'HR',
    name: 'Departments',
    description: 'Org departments per company.',
    href: '/hr/departments',
    permission: 'departments.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'hr.positions',
    category: 'HR',
    name: 'Positions',
    description: 'Job titles + position grades.',
    href: '/hr/positions',
    permission: 'positions.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'hr.leave-types',
    category: 'HR',
    name: 'Leave Types',
    description: 'Annual / sick / unpaid / compassionate types + accrual policies.',
    href: '/hr/leave-types',
    permission: 'leave_types.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'hr.payroll-periods',
    category: 'HR',
    name: 'Payroll Periods',
    description: 'Monthly / weekly periods used by payroll runs.',
    href: '/hr/payroll-periods',
    permission: 'payroll_periods.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── COMPLIANCE / TAX ─────────────────────────────────────────────────────
  {
    id: 'tax.authorities',
    category: 'COMPLIANCE',
    name: 'Tax Authorities',
    description: 'TRA + other regulators.',
    href: '/compliance/tax-authorities',
    permission: 'tax_authorities.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'tax.types',
    category: 'COMPLIANCE',
    name: 'Tax Types',
    description: 'PAYE, VAT, WHT, SDL, NSSF, etc.',
    href: '/compliance/tax-types',
    permission: 'tax_types.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'tax.rates',
    category: 'COMPLIANCE',
    name: 'Tax Rates',
    description: 'Effective-dated rate bands per tax type.',
    href: '/compliance/tax-rates',
    permission: 'tax_rates.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'tax.codes',
    category: 'COMPLIANCE',
    name: 'Tax Codes',
    description: 'Reference codes used on transactions.',
    href: '/compliance/tax-codes',
    permission: 'tax_codes.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'tax.registrations',
    category: 'COMPLIANCE',
    name: 'Tax Registrations',
    description: 'TIN, VAT-registration numbers per company.',
    href: '/compliance/tax-registrations',
    permission: 'tax_registrations.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'tax.filing-periods',
    category: 'COMPLIANCE',
    name: 'Tax Filing Periods',
    description: 'Monthly / quarterly / annual filing windows.',
    href: '/compliance/tax-filing-periods',
    permission: 'tax_filing_periods.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── OPERATIONS (catalog-style settings) ──────────────────────────────────
  {
    id: 'ops.units',
    category: 'OPERATIONS',
    name: 'Units of Measure',
    description: 'kg, l, svc, pcs, etc. System units + per-company custom units.',
    href: '/operations/units',
    permission: 'units.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'ops.product-categories',
    category: 'OPERATIONS',
    name: 'Product Categories',
    description: 'Category hierarchy for products.',
    href: '/operations/product-categories',
    permission: 'product_categories.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  // ── TEMPLATES ────────────────────────────────────────────────────────────
  {
    id: 'tpl.document-templates',
    category: 'TEMPLATES',
    name: 'Document Templates',
    description: 'Invoice, receipt, payslip, contract templates.',
    href: '/document-templates',
    permission: 'document_templates.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── APPROVALS ────────────────────────────────────────────────────────────
  {
    id: 'approvals.workflows',
    category: 'APPROVALS',
    name: 'Approval Workflows',
    description: 'Multi-step approval definitions per entity type.',
    href: '/approvals/workflows',
    permission: 'approval_workflows.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── NOTIFICATIONS ────────────────────────────────────────────────────────
  {
    id: 'notif.notifications',
    category: 'NOTIFICATIONS',
    name: 'Notifications',
    description: 'Notification templates + delivery channels.',
    href: '/notifications',
    permission: 'notifications.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── INTEGRATIONS ─────────────────────────────────────────────────────────
  {
    id: 'integ.providers',
    category: 'INTEGRATIONS',
    name: 'Providers',
    description: 'Available third-party integrations.',
    href: '/integrations/providers',
    permission: 'integrations.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'integ.connections',
    category: 'INTEGRATIONS',
    name: 'Connections',
    description: 'Configured integration connections per company.',
    href: '/integrations/connections',
    permission: 'integrations.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'integ.webhooks',
    category: 'INTEGRATIONS',
    name: 'Webhooks',
    description: 'Outbound webhook subscriptions.',
    href: '/integrations/webhooks',
    permission: 'webhooks.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },
  {
    id: 'integ.events',
    category: 'INTEGRATIONS',
    name: 'Integration Events',
    description: 'Inbound + outbound event log.',
    href: '/integrations/events',
    permission: 'integrations.view',
    scope: 'COMPANY',
    status: 'BUILT_IN',
  },

  // ── SYSTEM ───────────────────────────────────────────────────────────────
  {
    id: 'sys.audit-logs',
    category: 'SYSTEM',
    name: 'Audit Logs',
    description: 'System-wide audit trail (read-only).',
    href: '/audit-logs',
    permission: 'audit_logs.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'sys.backups',
    category: 'SYSTEM',
    name: 'Backups',
    description: 'Backup runs + restore points.',
    href: '/backups',
    permission: 'backups.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'sys.retention',
    category: 'SYSTEM',
    name: 'Retention Policies',
    description: 'Data-retention rules per entity.',
    href: '/retention',
    permission: 'retention.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'sys.automation',
    category: 'SYSTEM',
    name: 'Automation',
    description: 'Scheduled jobs + automation rules.',
    href: '/automation',
    permission: 'automation.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
  {
    id: 'sys.security',
    category: 'SYSTEM',
    name: 'Security',
    description: 'Password policies, MFA, session controls.',
    href: '/security',
    permission: 'security.view',
    scope: 'GROUP',
    status: 'BUILT_IN',
  },
];
