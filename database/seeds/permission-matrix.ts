/**
 * ITEMBA-R — Permission matrix
 *
 * The permission vocabulary (`ALL_PERMISSIONS`) and the system-role matrices
 * (`ROLES`) that `seed.ts` applies. Extracted from `seed.ts` so the matrix can
 * be asserted by tests without importing the seed itself — `seed.ts` invokes
 * `main()` at import time, so importing it would run the seed against a live
 * database.
 *
 * Changing anything here changes who holds what, for every deployment, the
 * next time the seed runs. `seed.ts` does a full replace of each system role's
 * permissions (delete-then-create), so this file is the source of truth for a
 * system role and a grant made through `PATCH /roles/:id` on a system role is
 * reverted by the next seed run. Grants that must survive belong on a
 * non-system role created through `POST /roles` (see `MSAIDIZI_USER` in the
 * Msaidizi integration plan §5.4).
 */
import { RoleScope } from '../../backend/node_modules/@prisma/client';

// ─── Permission definitions ──────────────────────────────────────────────────

export interface PermDef {
  code: string;
  description: string;
  module: string;
  action: string;
  isGroupControl: boolean;
}

export function perms(module: string, actions: string[], isGroupControl = false): PermDef[] {
  return actions.map((action) => ({
    code: `${module}.${action}`,
    description: `${action.charAt(0).toUpperCase() + action.slice(1)} ${module.replace(/-/g, ' ')}`,
    module,
    action,
    isGroupControl,
  }));
}

export const ALL_PERMISSIONS: PermDef[] = [
  // Group governance
  ...perms('groups', ['read', 'update']),
  ...perms('audit-logs', ['read', 'export']),

  // Company operations
  ...perms('companies', ['read', 'create', 'update', 'delete']),
  ...perms('company-profiles', ['read', 'update']),
  ...perms('divisions', ['read', 'create', 'update', 'delete']),
  ...perms('branches', ['read', 'create', 'update', 'delete']),
  ...perms('users', ['read', 'create', 'update', 'delete', 'assign_roles']),
  ...perms('roles', ['read', 'create', 'update', 'delete']),
  ...perms('permissions', ['read', 'create', 'delete']),
  // Msaidizi — permission to *use* the agent. It confers no data access of its
  // own: the agent acts under whatever else the holder is granted, so this only
  // decides who may talk to it, never what it can reach on their behalf.
  // `oversight` gates cross-conversation review, device enrollment and
  // emergency kill controls. It is intentionally assigned to no baseline role;
  // an operator must grant it explicitly.
  ...perms('msaidizi', ['use', 'oversight']),
  {
    code: 'fuel_grid.access',
    description: 'Open the independent Fuel Grid application',
    module: 'fuel_grid',
    action: 'access',
    isGroupControl: true,
  },
  // Saved procedures. `approve` is separate from `manage` on purpose: the whole
  // point of a saved procedure is that somebody other than its author looked at
  // the capability list before it could run.
  ...perms('msaidizi.procedures', ['view', 'manage', 'approve']),
  ...perms('documents', ['read', 'create', 'update', 'delete', 'view', 'manage']),
  ...perms('reports', ['read', 'export']),

  // Operational
  ...perms('inventory', ['read', 'create', 'update', 'delete']),
  ...perms('sales', ['read', 'update']),
  ...perms('expenses', ['read', 'create', 'update', 'delete']),
  ...perms('employees', ['read']),

  // Group Control — sensitive financial records (restricted to GROUP-scoped roles)
  ...perms('group-control', ['view', 'manage'], true),
  ...perms('bank-accounts', ['read', 'create', 'update', 'delete', 'approve'], true),
  ...perms('loans', ['read', 'create', 'update', 'delete', 'approve', 'manage'], true),
  ...perms('debts', ['read', 'create', 'update', 'delete'], true),
  ...perms('contracts', ['read', 'create', 'update', 'delete', 'approve', 'view', 'manage'], true),
  ...perms('fixed-assets', ['read', 'create', 'update', 'delete'], true),

  // Guard vocabulary used by company-/actor-scoped operational controllers.
  // These services authorize a tenant, owner, recipient, or requested record;
  // none of these permissions is itself restricted to a GROUP role.
  ...perms('alert_events', ['view', 'acknowledge', 'resolve', 'dismiss']),
  ...perms('alert_rules', ['view', 'manage']),
  ...perms('approval_delegations', ['view', 'manage']),
  ...perms('approval_requests', ['view', 'create', 'approve', 'reject', 'cancel']),
  ...perms('approval_steps', ['view', 'manage']),
  ...perms('approval_workflows', ['view', 'manage']),
  ...perms('approvals', ['dashboard.view']),
  ...perms('dashboard_preferences', ['manage']),
  ...perms('internal_controls', ['view', 'manage']),
  ...perms('notifications', ['view', 'manage']),
  ...perms('refunds', ['view', 'manage']),
  ...perms('sales_orders', ['view', 'create', 'confirm']),
  ...perms('saved_report_views', ['view', 'manage', 'share']),
  ...perms('scheduled_reports', ['view', 'manage', 'run']),
  ...perms('security.policies', ['view', 'manage']),
  ...perms('statutory_deduction_rules', ['view', 'manage']),
  ...perms('tasks', ['view', 'create', 'update', 'complete', 'cancel']),

  // ── Finance Foundation (Milestone 3) ────────────────────────────────────
  ...perms('finance', ['view', 'manage']),
  {
    code: 'finance.reports.view',
    description: 'View finance reports',
    module: 'finance',
    action: 'reports.view',
    isGroupControl: false,
  },
  ...perms('chart_of_accounts', ['view', 'manage']),
  ...perms('fiscal_years', ['view', 'manage']),
  ...perms('accounting_periods', ['view', 'manage']),
  ...perms('journal_entries', ['view', 'create', 'post', 'reverse']),
  ...perms('cash_accounts', ['view', 'manage']),
  ...perms('expenses', ['view', 'approve', 'pay']),
  ...perms('receivables', ['view', 'manage']),
  // Codes enforced by customer-payments.controller.ts (@RequirePermissions
  // 'customer-payments.view'/'customer-payments.manage') — granted wherever
  // receivables view/manage is granted (via FINANCE_MODULES).
  ...perms('customer-payments', ['view', 'manage']),
  ...perms('payables', ['view', 'manage']),
  ...perms('intercompany', ['view', 'manage', 'approve', 'post']),

  // ── Operations Foundation (Milestone 4) ────────────────────────────────────
  ...perms('customers', ['view', 'create', 'update', 'delete']),
  ...perms('suppliers', ['view', 'create', 'update', 'delete']),
  ...perms('products', ['view', 'create', 'update', 'delete']),
  ...perms('product_categories', ['view', 'manage']),
  ...perms('units', ['view', 'manage']),
  {
    code: 'inventory.view',
    description: 'View inventory balances and movements',
    module: 'inventory',
    action: 'view',
    isGroupControl: false,
  },
  {
    code: 'inventory.manage',
    description: 'Manage inventory records',
    module: 'inventory',
    action: 'manage',
    isGroupControl: false,
  },
  {
    code: 'inventory.movements.view',
    description: 'View inventory movements',
    module: 'inventory',
    action: 'movements.view',
    isGroupControl: false,
  },
  {
    code: 'inventory.adjustments.create',
    description: 'Create stock adjustments',
    module: 'inventory',
    action: 'adjustments.create',
    isGroupControl: false,
  },
  {
    code: 'inventory.adjustments.approve',
    description: 'Approve stock adjustments',
    module: 'inventory',
    action: 'adjustments.approve',
    isGroupControl: false,
  },
  {
    code: 'inventory.adjustments.post',
    description: 'Post stock adjustments',
    module: 'inventory',
    action: 'adjustments.post',
    isGroupControl: false,
  },
  ...perms('sales', ['view', 'create', 'confirm', 'cancel']),
  ...perms('purchases', ['view', 'create', 'confirm', 'receive', 'cancel']),
  // Mobile POS Lite: sales reps receive only `use`; terminal provisioning is
  // reserved for a group-controlled administrator. Stock-in purchases from a
  // terminal are a manager-level grant (`purchase`), not part of `use`.
  ...perms('mobile_pos_lite', ['use']),
  {
    code: 'mobile_pos_lite.purchase',
    description: 'Record stock-in purchases from a Mobile POS Lite terminal',
    module: 'mobile_pos_lite',
    action: 'purchase',
    isGroupControl: false,
  },
  {
    code: 'mobile_pos_lite.stock_count',
    description: 'Record stock counts from a Mobile POS Lite terminal',
    module: 'mobile_pos_lite',
    action: 'stock_count',
    isGroupControl: false,
  },
  {
    code: 'mobile_pos_lite.manage',
    description: 'Provision and manage Mobile POS Lite terminals',
    module: 'mobile_pos_lite',
    action: 'manage',
    isGroupControl: true,
  },
  ...perms('supplier_order_drafts', ['view', 'create', 'update', 'send', 'manage', 'export']),
  {
    code: 'operations.reports.view',
    description: 'View operations reports',
    module: 'operations',
    action: 'reports.view',
    isGroupControl: false,
  },
  {
    code: 'operations.dashboard.view',
    description: 'View operations dashboard',
    module: 'operations',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  ...perms('profit', ['view', 'manage_costs', 'audit']),
  ...perms('record_book', [
    'view',
    'create',
    'update',
    'delete',
    'finalize',
    'void',
    'admin',
    'export',
  ]),

  // ── Petroleum Operations (Milestone 5) ──────────────────────────────────────
  ...perms('petroleum', ['setup.view', 'setup.manage', 'reports.view', 'dashboard.view']),
  ...perms('fuel_tanks', ['view', 'manage']),
  ...perms('fuel_pumps', ['view', 'manage']),
  ...perms('fuel_nozzles', ['view', 'manage']),
  ...perms('fuel_prices', ['view', 'manage', 'approve']),
  ...perms('fuel_shifts', [
    'view',
    'open',
    'update',
    'submit',
    'supervisor_approve',
    'manager_approve',
    'reject',
    'close',
  ]),
  ...perms('fuel_readings', ['view', 'manage']),
  ...perms('tank_dips', ['view', 'create', 'approve', 'post']),
  ...perms('fuel_collections', ['view', 'manage']),
  ...perms('fuel_credit_sales', ['view', 'create', 'manage']),
  ...perms('fuel_deliveries', ['view', 'create', 'approve', 'post']),
  ...perms('fuel_reconciliation', ['view', 'create', 'approve', 'post']),

  // ── Westsides Operations (Milestone 6) ─────────────────────────────────────
  {
    code: 'westsides.dashboard.view',
    description: 'View Westsides dashboard',
    module: 'westsides',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  {
    code: 'westsides.reports.view',
    description: 'View Westsides reports',
    module: 'westsides',
    action: 'reports.view',
    isGroupControl: false,
  },
  {
    code: 'westsides.daily_close.manage',
    description: 'Save and sign off the Westsides daily cash close',
    module: 'westsides',
    action: 'daily_close.manage',
    isGroupControl: false,
  },
  ...perms('sales_channels', ['view', 'manage']),
  ...perms('price_lists', ['view', 'manage', 'approve']),
  ...perms('customer_price_agreements', ['view', 'manage', 'approve']),
  ...perms('product_batches', ['view', 'manage']),
  ...perms('stock_damage', ['view', 'create', 'approve', 'post']),
  ...perms('returnable_packages', ['view', 'manage']),
  ...perms('package_movements', ['view', 'manage']),
  ...perms('quotations', ['view', 'create', 'update', 'approve', 'convert']),
  ...perms('proformas', ['view', 'create', 'update', 'convert']),
  ...perms('delivery_notes', ['view', 'create', 'dispatch', 'deliver']),
  ...perms('pos', ['view', 'create', 'complete', 'void', 'refund']),
  ...perms('wholesale_sales', ['view', 'manage']),
  ...perms('retail_sales', ['view', 'manage']),

  // ── Itemba Enterprises Shared (Milestone 7) ─────────────────────────────────
  ...perms('itemba.dashboard', ['view']),
  ...perms('itemba.reports', ['view']),
  ...perms('itemba.work_units', ['view', 'manage']),
  ...perms('equipment_usage', ['view', 'manage']),
  ...perms('labor_records', ['view', 'manage']),

  // ── Logistics (Milestone 7) ─────────────────────────────────────────────────
  ...perms('logistics.dashboard', ['view']),
  ...perms('logistics.reports', ['view']),
  ...perms('vehicles', ['view', 'manage']),
  ...perms('drivers', ['view', 'manage']),
  ...perms('routes', ['view', 'manage']),
  ...perms('trips', ['view', 'create', 'dispatch', 'complete', 'close']),
  ...perms('trip_expenses', ['view', 'manage']),
  ...perms('trip_fuel_usage', ['view', 'manage']),
  ...perms('vehicle_maintenance', ['view', 'manage']),

  // ── Agriculture (Milestone 7) ───────────────────────────────────────────────
  ...perms('agriculture.dashboard', ['view']),
  ...perms('agriculture.reports', ['view']),
  ...perms('farms', ['view', 'manage']),
  ...perms('farm_fields', ['view', 'manage']),
  ...perms('crops', ['view', 'manage']),
  ...perms('crop_seasons', ['view', 'manage']),
  ...perms('farm_inputs', ['view', 'apply']),
  ...perms('harvests', ['view', 'create', 'approve', 'post']),
  ...perms('agriculture_activities', ['view', 'manage']),

  // ── Construction (Milestone 7) ──────────────────────────────────────────────
  ...perms('construction.dashboard', ['view']),
  ...perms('construction.reports', ['view']),
  ...perms('construction_projects', ['view', 'manage']),
  ...perms('construction_sites', ['view', 'manage']),
  ...perms('boq', ['view', 'manage']),
  ...perms('project_materials', ['view', 'manage', 'post']),
  ...perms('subcontractors', ['view', 'manage']),
  ...perms('project_progress', ['view', 'submit', 'approve']),
  ...perms('project_billing', ['view', 'manage', 'approve']),

  // ── Licensed Business Units (Milestone 8) ──────────────────────────────────
  ...perms('licensed_business_units', ['view', 'manage']),
  ...perms('business_licenses', ['view', 'manage', 'renew']),

  // ── Rental / Real Estate (Milestone 8) ─────────────────────────────────────
  {
    code: 'rental.dashboard.view',
    description: 'View rental dashboard',
    module: 'rental',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  {
    code: 'rental.reports.view',
    description: 'View rental reports',
    module: 'rental',
    action: 'reports.view',
    isGroupControl: false,
  },
  ...perms('rental_properties', ['view', 'manage']),
  ...perms('rental_units', ['view', 'manage']),
  ...perms('tenants', ['view', 'manage']),
  ...perms('leases', ['view', 'create', 'approve', 'terminate']),
  ...perms('rent_invoices', ['view', 'create', 'issue']),
  ...perms('rent_payments', ['view', 'create']),
  ...perms('property_maintenance', ['view', 'manage']),

  // ── Parking (Milestone 8) ───────────────────────────────────────────────────
  {
    code: 'parking.dashboard.view',
    description: 'View parking dashboard',
    module: 'parking',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  {
    code: 'parking.reports.view',
    description: 'View parking reports',
    module: 'parking',
    action: 'reports.view',
    isGroupControl: false,
  },
  ...perms('parking_facilities', ['view', 'manage']),
  ...perms('parking_zones', ['view', 'manage']),
  ...perms('parking_rates', ['view', 'manage', 'approve']),
  ...perms('parking_sessions', ['view', 'create', 'close', 'void']),
  ...perms('parking_payments', ['view', 'create']),

  // ── Hospitality (Milestone 8) ───────────────────────────────────────────────
  {
    code: 'hospitality.dashboard.view',
    description: 'View hospitality dashboard',
    module: 'hospitality',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  {
    code: 'hospitality.reports.view',
    description: 'View hospitality reports',
    module: 'hospitality',
    action: 'reports.view',
    isGroupControl: false,
  },
  ...perms('hospitality_facilities', ['view', 'manage']),
  ...perms('rooms', ['view', 'manage']),
  ...perms('guests', ['view', 'manage']),
  ...perms('room_bookings', ['view', 'create', 'check_in', 'check_out', 'cancel']),
  ...perms('housekeeping', ['view', 'manage']),
  ...perms('menu_categories', ['view', 'manage']),
  ...perms('menu_items', ['view', 'manage']),
  ...perms('restaurant_tables', ['view', 'manage']),
  ...perms('restaurant_orders', ['view', 'create', 'complete', 'void']),
  ...perms('hospitality_payments', ['view', 'create']),

  // ── HR & Payroll (Milestone 9) ──────────────────────────────────────────────
  {
    code: 'hr.dashboard.view',
    description: 'View HR dashboard',
    module: 'hr',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  {
    code: 'hr.reports.view',
    description: 'View HR reports',
    module: 'hr',
    action: 'reports.view',
    isGroupControl: false,
  },
  ...perms('departments', ['view', 'manage']),
  ...perms('positions', ['view', 'manage']),
  ...perms('employees', ['view', 'create', 'update', 'delete']),
  {
    code: 'employees.termination.request',
    description: 'Request employee termination for approval',
    module: 'employees',
    action: 'termination.request',
    isGroupControl: false,
  },
  {
    code: 'employees.termination.approve.hr',
    description: 'Group HR approval for employee termination',
    module: 'hr_governance',
    action: 'termination.approve.hr',
    isGroupControl: false,
  },
  {
    code: 'employees.transfer.approve.hr',
    description: 'Group HR approval for employee transfer',
    module: 'hr_governance',
    action: 'transfer.approve.hr',
    isGroupControl: false,
  },
  {
    code: 'employees.sensitive.view',
    description: 'View sensitive employee data (salary, bank)',
    module: 'employees',
    action: 'sensitive.view',
    isGroupControl: false,
  },
  {
    code: 'employees.assignments.manage',
    description: 'Manage employee operational assignments',
    module: 'employees',
    action: 'assignments.manage',
    isGroupControl: false,
  },
  ...perms('employment_contracts', ['view', 'create', 'approve', 'terminate']),
  ...perms('shifts', ['view', 'manage']),
  ...perms('shift_schedules', ['view', 'manage']),
  ...perms('attendance', ['view', 'create', 'update', 'approve']),
  ...perms('leave_types', ['view', 'manage']),
  ...perms('leave_requests', ['view', 'create', 'approve', 'reject']),
  ...perms('leave_balances', ['view', 'manage']),
  {
    code: 'leave_requests.approve.hr',
    description: 'Group HR approval for long leave requests',
    module: 'hr_governance',
    action: 'leave.approve.hr',
    isGroupControl: false,
  },
  ...perms('allowances', ['view', 'manage']),
  ...perms('deductions', ['view', 'manage']),
  ...perms('payroll', ['view', 'manage', 'calculate', 'submit', 'approve', 'pay', 'cancel']),
  {
    code: 'payroll.approve.hr',
    description: 'Record HR sign-off for payroll runs',
    module: 'payroll',
    action: 'approve.hr',
    isGroupControl: false,
  },
  {
    code: 'payroll.approve.finance',
    description: 'Record Finance sign-off for payroll runs',
    module: 'payroll',
    action: 'approve.finance',
    isGroupControl: false,
  },
  {
    code: 'payroll.sensitive.view',
    description: 'View sensitive payroll data',
    module: 'payroll',
    action: 'sensitive.view',
    isGroupControl: false,
  },
  ...perms('salary_payments', ['view', 'create', 'reverse']),
  ...perms('salary_advances', ['view', 'create', 'approve', 'pay']),
  ...perms('performance', ['view', 'manage']),
  ...perms('hr_documents', ['view', 'manage', 'download']),
  ...perms('disciplinary_actions', ['view', 'create', 'update', 'delete']),
  {
    code: 'disciplinary_actions.approve.hr',
    description: 'Group HR co-sign for disciplinary actions',
    module: 'hr_governance',
    action: 'disciplinary.approve.hr',
    isGroupControl: false,
  },

  // ── Tax, Compliance, Regulatory (Milestone 10) ─────────────────────────────
  ...perms('tax_authorities', ['view', 'manage']),
  ...perms('tax_registrations', ['view', 'manage']),
  ...perms('tax_types', ['view', 'manage']),
  ...perms('tax_rates', ['view', 'manage', 'approve']),
  ...perms('tax_codes', ['view', 'manage']),
  ...perms('tax_transactions', ['view', 'manage', 'create', 'post', 'reverse']),
  ...perms('tax_filing_periods', ['view', 'manage']),
  ...perms('tax_returns', [
    'view',
    'manage',
    'prepare',
    'review',
    'approve',
    'submit',
    'mark_paid',
    'cancel',
  ]),
  {
    code: 'compliance.dashboard.view',
    description: 'View compliance dashboard',
    module: 'compliance',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  {
    code: 'compliance.reports.view',
    description: 'View compliance reports',
    module: 'compliance',
    action: 'reports.view',
    isGroupControl: false,
  },
  ...perms('compliance_obligations', ['view', 'manage', 'complete']),
  ...perms('compliance_events', ['view', 'manage']),
  ...perms('compliance_calendar', ['view', 'manage']),
  ...perms('statutory_rules', ['view', 'manage']),
  ...perms('payroll_compliance', ['view', 'manage']),
  ...perms('compliance_document_requirements', ['view', 'manage']),
  ...perms('compliance_document_status', ['view', 'manage']),
  {
    code: 'compliance_documents.audit',
    description: 'Audit compliance documents',
    module: 'compliance_documents',
    action: 'audit',
    isGroupControl: false,
  },
  ...perms('audit_evidence_packs', ['view', 'create', 'manage', 'review', 'export']),
  ...perms('data_exports', ['view', 'create', 'download', 'manage']),
  {
    code: 'sensitive_exports.create',
    description: 'Create sensitive data exports',
    module: 'sensitive_exports',
    action: 'create',
    isGroupControl: true,
  },

  // ── Integration & External Services (Milestone 13) ─────────────────────────
  {
    code: 'integrations.dashboard.view',
    description: 'View integrations dashboard',
    module: 'integrations',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  ...perms('integration_providers', ['view', 'manage']),
  ...perms('integration_connections', ['view', 'manage', 'test']),
  ...perms('integration_events', ['view']),
  {
    code: 'integration_events.sensitive.view',
    description: 'View sensitive integration events',
    module: 'integration_events',
    action: 'sensitive.view',
    isGroupControl: false,
  },
  ...perms('api_clients', ['view', 'manage']),
  ...perms('api_keys', ['view', 'create', 'revoke']),
  ...perms('api_request_logs', ['view']),
  ...perms('webhook_endpoints', ['view', 'manage']),
  ...perms('webhook_events', ['view', 'reprocess']),
  {
    code: 'webhook_events.sensitive.view',
    description: 'View sensitive webhook events',
    module: 'webhook_events',
    action: 'sensitive.view',
    isGroupControl: false,
  },
  ...perms('devices', ['view', 'manage', 'block']),
  ...perms('mobile_sessions', ['view', 'revoke']),
  ...perms('offline_sync', ['view', 'manage', 'resolve_conflicts', 'reprocess']),
  ...perms('external_payments', ['view', 'create', 'confirm', 'reverse']),
  {
    code: 'external_payments.sensitive.view',
    description: 'View sensitive external payment data',
    module: 'external_payments',
    action: 'sensitive.view',
    isGroupControl: false,
  },
  ...perms('external_messages', ['view', 'send', 'manage']),
  ...perms('message_templates', ['view', 'manage']),
  ...perms('integration_mappings', ['view', 'manage']),

  // ── Security Hardening (Milestone 14) ──────────────────────────────────────
  {
    code: 'security.dashboard.view',
    description: 'View security dashboard',
    module: 'security',
    action: 'dashboard.view',
    isGroupControl: true,
  },
  ...perms('security_policies', ['view', 'manage']),
  ...perms('user_security_profiles', ['view', 'manage']),
  {
    code: 'user_security_profiles.sensitive.view',
    description: 'View sensitive user security profile data',
    module: 'user_security_profiles',
    action: 'sensitive.view',
    isGroupControl: false,
  },
  ...perms('security_events', ['view', 'review', 'resolve', 'manage']),
  ...perms('active_sessions', ['view', 'revoke', 'manage']),
  ...perms('two_factor', ['manage']),
  ...perms('account_locks', ['manage']),

  // ── Backup & Disaster Recovery (Milestone 14) ───────────────────────────────
  {
    code: 'backups.dashboard.view',
    description: 'View backups dashboard',
    module: 'backups',
    action: 'dashboard.view',
    isGroupControl: true,
  },
  ...perms('backup_jobs', ['view', 'manage']),
  ...perms('backup_runs', ['view', 'create', 'download']),
  ...perms('restore_tests', ['view', 'manage']),
  ...perms('disaster_recovery', ['view', 'manage', 'approve']),

  // ── Monitoring (Milestone 14) ───────────────────────────────────────────────
  {
    code: 'monitoring.dashboard.view',
    description: 'View monitoring dashboard',
    module: 'monitoring',
    action: 'dashboard.view',
    isGroupControl: false,
  },
  ...perms('system_health', ['view', 'manage', 'run']),
  ...perms('system_metrics', ['view']),
  ...perms('error_logs', ['view', 'resolve']),
  {
    code: 'error_logs.sensitive.view',
    description: 'View sensitive error log details (stack traces)',
    module: 'error_logs',
    action: 'sensitive.view',
    isGroupControl: false,
  },

  // ── Retention & Archive (Milestone 14) ─────────────────────────────────────
  ...perms('retention_policies', ['view', 'manage', 'approve']),
  ...perms('archive_jobs', ['view', 'manage', 'approve']),

  // ── Production Readiness (Milestone 14) ────────────────────────────────────
  ...perms('production_readiness', ['view', 'manage', 'approve']),
  ...perms('environment_checks', ['view', 'run']),

  // ── M14.5: Advanced Accounting ─────────────────────────────────────────────
  ...perms('accounting_engine', ['dashboard']),
  ...perms('posting_rules', ['list', 'view', 'create', 'update', 'delete']),
  ...perms('posting_runs', ['list', 'view', 'create', 'post', 'reverse']),
  ...perms('period_close', ['list', 'view', 'create', 'close', 'reopen']),
  ...perms('accounting_locks', ['list', 'view', 'create', 'release']),
  ...perms('bank_reconciliations', ['list', 'view', 'create', 'update', 'approve', 'close']),
  ...perms('depreciation', ['list', 'view', 'create', 'post_entry']),
  ...perms('loan_schedules', ['list', 'view', 'create', 'pay']),
  ...perms('financial_statements', ['list', 'view', 'generate']),
  ...perms('audit_adjustments', ['list', 'view', 'create', 'approve', 'post']),

  // ── M14.5: Procurement ──────────────────────────────────────────────────────
  ...perms('procurement', ['dashboard']),
  ...perms('purchase_requisitions', ['list', 'view', 'create', 'update', 'approve']),
  ...perms('rfqs', ['list', 'view', 'create', 'update', 'send']),
  ...perms('supplier_quotations', ['list', 'view', 'create', 'update', 'accept']),
  ...perms('bid_comparisons', ['list', 'view', 'create', 'approve']),
  ...perms('grn', ['list', 'view', 'create', 'update', 'approve', 'post']),
  ...perms('supplier_invoices', ['list', 'view', 'create', 'update', 'approve']),
  ...perms('three_way_match', ['list', 'view', 'create', 'approve']),
  ...perms('procurement_plans', ['list', 'view', 'create', 'update', 'approve']),

  // ── M14.5: CRM / SRM ────────────────────────────────────────────────────────
  ...perms('crm', ['dashboard']),
  ...perms('contact_persons', ['list', 'view', 'create', 'update', 'delete']),
  ...perms('communication_logs', ['list', 'view', 'create', 'update']),
  ...perms('credit_profiles', ['list', 'view', 'create', 'update']),
  ...perms('supplier_performance', ['list', 'view', 'create', 'update']),
  ...perms('customer_segments', ['list', 'view', 'create', 'update', 'delete', 'manage_members']),
  ...perms('customer_statements', ['list', 'view', 'generate']),
  ...perms('supplier_statements', ['list', 'view', 'generate']),

  // ── M14.5: Document Templates ───────────────────────────────────────────────
  ...perms('document_templates', ['list', 'view', 'create', 'update', 'delete']),
  ...perms('generated_documents', ['list', 'view']),
  ...perms('doc_sequences', ['list', 'view', 'create', 'update']),
  ...perms('print_engine', ['render']),

  // ── M14.5: Business Automation ──────────────────────────────────────────────
  ...perms('business_automation', ['dashboard']),
  ...perms('automation_rules', ['list', 'view', 'create', 'update', 'delete', 'activate']),
  ...perms('automation_runs', ['list', 'view', 'trigger']),

  // ── M15: Performance, Scalability, Deployment ──────────────────────────────
  ...perms('performance', ['dashboard.view', 'traces.view', 'traces.manage', 'optimization.view']),
  ...perms('background_jobs', ['view', 'manage', 'retry', 'cancel']),
  ...perms('job_queue_configs', ['view', 'manage']),
  ...perms('cache', ['view', 'manage', 'invalidate']),
  {
    code: 'cache.stats.view',
    description: 'View group-wide cache statistics',
    module: 'cache',
    action: 'stats.view',
    isGroupControl: true,
  },
  ...perms('scalability', ['dashboard.view']),
  ...perms('load_tests', ['view', 'manage', 'run']),
  ...perms('data_isolation', ['view', 'run_tests', 'resolve_issues', 'sensitive.view'], true),
  ...perms('deployment', [
    'dashboard.view',
    'releases.view',
    'releases.manage',
    'releases.rollback',
    'environment.view',
  ]),
  ...perms('production_ops', ['dashboard.view', 'manage']),
  // M16 - QA, Launch Readiness, Documentation, Training, Support
  ...perms('qa', [
    'dashboard.view',
    'test_suites.view',
    'test_suites.manage',
    'test_cases.view',
    'test_cases.manage',
    'test_runs.view',
    'test_runs.manage',
    'test_results.manage',
    'evidence.view',
  ]),
  ...perms('launch', [
    'dashboard.view',
    'blockers.view',
    'blockers.manage',
    'blockers.accept_risk',
    'assessments.view',
    'assessments.manage',
    'assessments.approve',
    'readiness_items.manage',
  ]),
  ...perms('documentation', ['view', 'manage', 'publish']),
  ...perms('help_center', ['view']),
  ...perms('help_articles', ['manage', 'publish']),
  ...perms('training', [
    'dashboard.view',
    'courses.view',
    'courses.manage',
    'lessons.manage',
    'enrollments.view',
    'enrollments.manage',
    'progress.view',
  ]),
  ...perms('guided_walkthroughs', ['view', 'manage']),
  ...perms('training_environment', ['view', 'manage', 'reset']),
  ...perms('support', [
    'tickets.view',
    'tickets.create',
    'tickets.manage',
    'tickets.assign',
    'tickets.resolve',
    'comments.manage',
    'internal_comments.view',
  ]),
  ...perms('final_qa', [
    'security_review',
    'accounting_review',
    'ui_review',
    'data_quality_review',
    'go_live_signoff',
  ]),
];

// ─── Role permission matrices ────────────────────────────────────────────────

export type PermFilter = (p: PermDef) => boolean;

const all: PermFilter = () => true;
const readExport: PermFilter = (p) =>
  p.action === 'read' ||
  p.action === 'export' ||
  p.action === 'view' ||
  p.action === 'reports.view';
const groupCtrl: PermFilter = (p) => p.isGroupControl;
const notGroupCtrl: PermFilter = (p) => !p.isGroupControl && p.module !== 'hr_governance';
const inModules =
  (...mods: string[]): PermFilter =>
  (p) =>
    mods.includes(p.module);
const notInModules =
  (...mods: string[]): PermFilter =>
  (p) =>
    !mods.includes(p.module);

function combine(...filters: PermFilter[]): PermFilter {
  return (p) => filters.some((f) => f(p));
}

// Finance module names (Milestone 3) — used to grant finance access to roles
const FINANCE_MODULES = [
  'finance',
  'chart_of_accounts',
  'fiscal_years',
  'accounting_periods',
  'journal_entries',
  'cash_accounts',
  'receivables',
  'customer-payments',
  'payables',
  'intercompany',
];

// Operations module names (Milestone 4)
const OPERATIONS_MODULES = [
  'customers',
  'suppliers',
  'products',
  'product_categories',
  'units',
  'inventory',
  'sales',
  'purchases',
  'supplier_order_drafts',
  'operations',
];

// Petroleum module names (Milestone 5)
const PETROLEUM_MODULES = [
  'petroleum',
  'fuel_tanks',
  'fuel_pumps',
  'fuel_nozzles',
  'fuel_prices',
  'fuel_shifts',
  'fuel_readings',
  'tank_dips',
  'fuel_collections',
  'fuel_credit_sales',
  'fuel_deliveries',
  'fuel_reconciliation',
];

// Westsides module names (Milestone 6)
const WESTSIDES_MODULES = [
  'westsides',
  'sales_channels',
  'price_lists',
  'customer_price_agreements',
  'product_batches',
  'stock_damage',
  'returnable_packages',
  'package_movements',
  'quotations',
  'proformas',
  'delivery_notes',
  'pos',
  'wholesale_sales',
  'retail_sales',
];

// Itemba Enterprises module names (Milestone 7)
const ITEMBA_SHARED_MODULES = [
  'itemba.dashboard',
  'itemba.reports',
  'itemba.work_units',
  'equipment_usage',
  'labor_records',
];

const LOGISTICS_MODULES = [
  'logistics.dashboard',
  'logistics.reports',
  'vehicles',
  'drivers',
  'routes',
  'trips',
  'trip_expenses',
  'trip_fuel_usage',
  'vehicle_maintenance',
];

const AGRICULTURE_MODULES = [
  'agriculture.dashboard',
  'agriculture.reports',
  'farms',
  'farm_fields',
  'crops',
  'crop_seasons',
  'farm_inputs',
  'harvests',
  'agriculture_activities',
];

const CONSTRUCTION_MODULES = [
  'construction.dashboard',
  'construction.reports',
  'construction_projects',
  'construction_sites',
  'boq',
  'project_materials',
  'subcontractors',
  'project_progress',
  'project_billing',
];

const ALL_ITEMBA_MODULES = [
  ...ITEMBA_SHARED_MODULES,
  ...LOGISTICS_MODULES,
  ...AGRICULTURE_MODULES,
  ...CONSTRUCTION_MODULES,
];

// Milestone 8 module names
const LICENSED_BU_MODULES = ['licensed_business_units', 'business_licenses'];

const RENTAL_MODULES = [
  'rental',
  'rental_properties',
  'rental_units',
  'tenants',
  'leases',
  'rent_invoices',
  'rent_payments',
  'property_maintenance',
];

const PARKING_MODULES = [
  'parking',
  'parking_facilities',
  'parking_zones',
  'parking_rates',
  'parking_sessions',
  'parking_payments',
];

const HOSPITALITY_MODULES = [
  'hospitality',
  'hospitality_facilities',
  'rooms',
  'guests',
  'room_bookings',
  'housekeeping',
  'menu_categories',
  'menu_items',
  'restaurant_tables',
  'restaurant_orders',
  'hospitality_payments',
];

const ALL_M8_MODULES = [
  ...LICENSED_BU_MODULES,
  ...RENTAL_MODULES,
  ...PARKING_MODULES,
  ...HOSPITALITY_MODULES,
];

// HR & Payroll module names (Milestone 9)
const HR_CORE_MODULES = ['hr', 'departments', 'positions', 'employees', 'employment_contracts'];
const HR_ATTENDANCE_MODULES = [
  'shifts',
  'shift_schedules',
  'attendance',
  'leave_types',
  'leave_requests',
  'leave_balances',
];
const HR_PAYROLL_MODULES = [
  'payroll',
  'allowances',
  'deductions',
  'salary_payments',
  'salary_advances',
];
const HR_OTHER_MODULES = ['performance', 'hr_documents', 'disciplinary_actions'];
const HR_GROUP_APPROVAL_CODES = [
  'leave_requests.approve.hr',
  'employees.termination.approve.hr',
  'employees.transfer.approve.hr',
  'disciplinary_actions.approve.hr',
];

const ALL_M9_MODULES = [
  ...HR_CORE_MODULES,
  ...HR_ATTENDANCE_MODULES,
  ...HR_PAYROLL_MODULES,
  ...HR_OTHER_MODULES,
];

// Tax & Compliance module names (Milestone 10)
const TAX_MODULES = [
  'tax_authorities',
  'tax_registrations',
  'tax_types',
  'tax_rates',
  'tax_codes',
  'tax_transactions',
  'tax_filing_periods',
  'tax_returns',
];
const COMPLIANCE_MODULES = [
  'compliance',
  'compliance_obligations',
  'compliance_events',
  'compliance_calendar',
  'statutory_rules',
  'payroll_compliance',
  'compliance_document_requirements',
  'compliance_document_status',
  'compliance_documents',
];
const AUDIT_EXPORT_MODULES = ['audit_evidence_packs', 'data_exports', 'sensitive_exports'];
const ALL_M10_MODULES = [...TAX_MODULES, ...COMPLIANCE_MODULES, ...AUDIT_EXPORT_MODULES];

// Integration & External Services module names (Milestone 13)
const INTEGRATION_MODULES = [
  'integrations',
  'integration_providers',
  'integration_connections',
  'integration_events',
];
const API_GATEWAY_MODULES = ['api_clients', 'api_keys', 'api_request_logs'];
const WEBHOOK_MODULES = ['webhook_endpoints', 'webhook_events'];
const MOBILE_MODULES = ['devices', 'mobile_sessions'];
const OFFLINE_SYNC_MODULES = ['offline_sync'];
const EXTERNAL_PAYMENT_MODULES = ['external_payments'];
const MESSAGING_MODULES = ['external_messages', 'message_templates'];
const INTEGRATION_MAPPING_MODULES = ['integration_mappings'];

const ALL_M13_MODULES = [
  ...INTEGRATION_MODULES,
  ...API_GATEWAY_MODULES,
  ...WEBHOOK_MODULES,
  ...MOBILE_MODULES,
  ...OFFLINE_SYNC_MODULES,
  ...EXTERNAL_PAYMENT_MODULES,
  ...MESSAGING_MODULES,
  ...INTEGRATION_MAPPING_MODULES,
];

// Security & Production module names (Milestone 14)
const SECURITY_MODULES = [
  'security',
  'security_policies',
  'user_security_profiles',
  'security_events',
  'active_sessions',
  'two_factor',
  'account_locks',
];

const BACKUP_DR_MODULES = [
  'backups',
  'backup_jobs',
  'backup_runs',
  'restore_tests',
  'disaster_recovery',
];

const MONITORING_MODULES = ['monitoring', 'system_health', 'system_metrics', 'error_logs'];

const RETENTION_MODULES = ['retention_policies', 'archive_jobs'];

const PRODUCTION_MODULES = ['production_readiness', 'environment_checks'];

const ALL_M14_MODULES = [
  ...SECURITY_MODULES,
  ...BACKUP_DR_MODULES,
  ...MONITORING_MODULES,
  ...RETENTION_MODULES,
  ...PRODUCTION_MODULES,
];

// Advanced Accounting module names (Milestone 14.5)
const ACCOUNTING_ENGINE_MODULES = [
  'accounting_engine',
  'posting_rules',
  'posting_runs',
  'period_close',
  'accounting_locks',
  'bank_reconciliations',
  'depreciation',
  'loan_schedules',
  'financial_statements',
  'audit_adjustments',
];

const PROCUREMENT_MODULES = [
  'procurement',
  'supplier_order_drafts',
  'purchase_requisitions',
  'rfqs',
  'supplier_quotations',
  'bid_comparisons',
  'grn',
  'supplier_invoices',
  'three_way_match',
  'procurement_plans',
];

const CRM_MODULES = [
  'crm',
  'contact_persons',
  'communication_logs',
  'credit_profiles',
  'supplier_performance',
  'customer_segments',
  'customer_statements',
  'supplier_statements',
];

const DOC_TEMPLATE_MODULES = [
  'document_templates',
  'generated_documents',
  'doc_sequences',
  'print_engine',
];

const AUTOMATION_MODULES = ['business_automation', 'automation_rules', 'automation_runs'];

// Performance, Scalability, Deployment module names (Milestone 15)
const M15_PERFORMANCE_MODULES = [
  ...perms('performance', ['dashboard.view', 'traces.view', 'traces.manage', 'optimization.view']),
  ...perms('background_jobs', ['view', 'manage', 'retry', 'cancel']),
  ...perms('job_queue_configs', ['view', 'manage']),
  ...perms('cache', ['view', 'manage', 'invalidate']),
];

const M15_SCALABILITY_MODULES = [
  ...perms('scalability', ['dashboard.view']),
  ...perms('load_tests', ['view', 'manage', 'run']),
];

const M15_ISOLATION_MODULES = [
  ...perms('data_isolation', ['view', 'run_tests', 'resolve_issues', 'sensitive.view'], true),
];

const M15_DEPLOYMENT_MODULES = [
  ...perms('deployment', [
    'dashboard.view',
    'releases.view',
    'releases.manage',
    'releases.rollback',
    'environment.view',
  ]),
  ...perms('production_ops', ['dashboard.view', 'manage']),
];

// M16 module constant arrays
const M16_QA_MODULES = [
  ...perms('qa', [
    'dashboard.view',
    'test_suites.view',
    'test_suites.manage',
    'test_cases.view',
    'test_cases.manage',
    'test_runs.view',
    'test_runs.manage',
    'test_results.manage',
    'evidence.view',
  ]),
];

const M16_LAUNCH_MODULES = [
  ...perms('launch', [
    'dashboard.view',
    'blockers.view',
    'blockers.manage',
    'blockers.accept_risk',
    'assessments.view',
    'assessments.manage',
    'assessments.approve',
    'readiness_items.manage',
  ]),
];

const M16_DOCUMENTATION_MODULES = [
  ...perms('documentation', ['view', 'manage', 'publish']),
  ...perms('help_center', ['view']),
  ...perms('help_articles', ['manage', 'publish']),
];

const M16_TRAINING_MODULES = [
  ...perms('training', [
    'dashboard.view',
    'courses.view',
    'courses.manage',
    'lessons.manage',
    'enrollments.view',
    'enrollments.manage',
    'progress.view',
  ]),
  ...perms('guided_walkthroughs', ['view', 'manage']),
  ...perms('training_environment', ['view', 'manage', 'reset']),
];

const M16_SUPPORT_MODULES = [
  ...perms('support', [
    'tickets.view',
    'tickets.create',
    'tickets.manage',
    'tickets.assign',
    'tickets.resolve',
    'comments.manage',
    'internal_comments.view',
  ]),
];

const M16_FINAL_QA_MODULES = [
  ...perms('final_qa', [
    'security_review',
    'accounting_review',
    'ui_review',
    'data_quality_review',
    'go_live_signoff',
  ]),
];

export interface RoleDef {
  name: string;
  displayName: string;
  description: string;
  scope: RoleScope;
  filter: PermFilter;
}

const BASE_ROLES: RoleDef[] = [
  {
    name: 'GROUP_SUPER_ADMIN',
    displayName: 'Group Super Admin',
    description: 'Full unrestricted access to the entire system including Group Control.',
    scope: RoleScope.GROUP,
    filter: all,
  },
  {
    name: 'GROUP_DIRECTOR',
    displayName: 'Group Director',
    description: 'Strategic oversight — reads all records and manages company structure.',
    scope: RoleScope.GROUP,
    filter: combine(
      readExport,
      (p) => p.module === 'record_book' && readExport(p),
      inModules('companies', 'company-profiles', 'divisions', 'branches'),
      inModules(...ALL_ITEMBA_MODULES),
      inModules(
        ...ACCOUNTING_ENGINE_MODULES,
        ...PROCUREMENT_MODULES,
        ...CRM_MODULES,
        ...DOC_TEMPLATE_MODULES,
        ...AUTOMATION_MODULES,
      ),
      (p) =>
        [
          'integrations.dashboard.view',
          'integration_events.sensitive.view',
          'webhook_events.sensitive.view',
          'external_payments.sensitive.view',
        ].includes(p.code),
      (p) =>
        [
          'security.dashboard.view',
          'security_events.view',
          'backups.dashboard.view',
          'backup_runs.view',
          'restore_tests.view',
          'disaster_recovery.view',
          'disaster_recovery.approve',
          'monitoring.dashboard.view',
          'system_health.view',
          'error_logs.view',
          'retention_policies.view',
          'production_readiness.view',
          'production_readiness.approve',
          'environment_checks.view',
        ].includes(p.code),
      (p) =>
        [
          'performance.dashboard.view',
          'scalability.dashboard.view',
          'deployment.dashboard.view',
          'deployment.releases.view',
          'production_ops.dashboard.view',
        ].includes(p.code),
      // M16: QA, Launch, Documentation, Training, Support
      (p) =>
        [
          'launch.dashboard.view',
          'launch.blockers.view',
          'launch.blockers.accept_risk',
          'launch.assessments.view',
          'launch.assessments.approve',
          'documentation.view',
          'help_center.view',
          'training.dashboard.view',
          'training.courses.view',
          'training.enrollments.view',
          'final_qa.go_live_signoff',
          'final_qa.security_review',
          'final_qa.accounting_review',
          'support.tickets.view',
        ].includes(p.code),
    ),
  },
  {
    name: 'GROUP_FINANCE_CONTROLLER',
    displayName: 'Group Finance Controller',
    description: 'Full management of all Group Control financial records.',
    scope: RoleScope.GROUP,
    filter: combine(
      groupCtrl,
      inModules('companies', 'divisions', 'branches', 'documents', 'reports', 'audit-logs'),
      inModules(...FINANCE_MODULES, 'expenses', 'record_book'),
      inModules(...ACCOUNTING_ENGINE_MODULES, ...PROCUREMENT_MODULES),
      (p) => inModules(...OPERATIONS_MODULES)(p) && readExport(p),
      (p) => p.code === 'payroll.approve.finance',
      (p) =>
        inModules('fuel_collections', 'fuel_credit_sales', 'fuel_reconciliation', 'petroleum')(p) &&
        !['manage', 'approve', 'post'].includes(p.action),
      // M13: Integration & payment access for finance controller
      (p) =>
        [
          'integrations.dashboard.view',
          'integration_providers.view',
          'integration_providers.manage',
          'integration_connections.view',
          'integration_connections.manage',
          'integration_connections.test',
          'integration_events.view',
          'external_payments.view',
          'external_payments.create',
          'external_payments.confirm',
          'external_payments.reverse',
          'external_payments.sensitive.view',
          'external_messages.view',
          'message_templates.view',
          'integration_mappings.view',
        ].includes(p.code),
      (p) =>
        [
          'backups.dashboard.view',
          'backup_runs.view',
          'monitoring.dashboard.view',
          'security.dashboard.view',
          'security_events.view',
          'retention_policies.view',
          'production_readiness.view',
          'environment_checks.view',
          'performance.dashboard.view',
          'background_jobs.view',
        ].includes(p.code),
      // M16: QA, Launch, Documentation, Training, Support
      (p) =>
        [
          'qa.dashboard.view',
          'qa.test_runs.view',
          'launch.dashboard.view',
          'launch.blockers.view',
          'launch.assessments.view',
          'documentation.view',
          'help_center.view',
          'final_qa.accounting_review',
          'training.courses.view',
          'training.enrollments.view',
          'support.tickets.create',
        ].includes(p.code),
    ),
  },
  {
    name: 'GROUP_AUDITOR',
    displayName: 'Group Auditor',
    description: 'Read-only access across all modules including Group Control.',
    scope: RoleScope.GROUP,
    filter: combine(
      readExport,
      (p) => p.code === 'integrations.dashboard.view',
      (p) =>
        inModules(
          ...SECURITY_MODULES,
          ...BACKUP_DR_MODULES,
          ...MONITORING_MODULES,
          ...RETENTION_MODULES,
          ...PRODUCTION_MODULES,
          ...ACCOUNTING_ENGINE_MODULES,
        )(p) && readExport(p),
      (p) =>
        [
          'data_isolation.view',
          'data_isolation.sensitive.view',
          'deployment.dashboard.view',
          'deployment.releases.view',
        ].includes(p.code),
      // M16: QA, Launch, Documentation, Training, Support
      (p) =>
        [
          'qa.dashboard.view',
          'qa.test_suites.view',
          'qa.test_cases.view',
          'qa.test_runs.view',
          'qa.evidence.view',
          'launch.dashboard.view',
          'launch.blockers.view',
          'launch.assessments.view',
          'documentation.view',
          'help_center.view',
          'final_qa.security_review',
          'final_qa.data_quality_review',
          'support.tickets.view',
        ].includes(p.code),
    ),
  },
  {
    name: 'COMPANY_MANAGER',
    displayName: 'Company Manager',
    description: 'Full operational control within an assigned company. No Group Control access.',
    scope: RoleScope.COMPANY,
    filter: combine(
      (p) =>
        inModules(
          'companies',
          'divisions',
          'branches',
          'users',
          'documents',
          'inventory',
          'sales',
          'expenses',
          'employees',
          'reports',
          'audit-logs',
          ...FINANCE_MODULES,
          ...OPERATIONS_MODULES,
          ...PETROLEUM_MODULES,
          ...WESTSIDES_MODULES,
          ...ALL_ITEMBA_MODULES,
          ...ALL_M8_MODULES,
          ...ALL_M9_MODULES,
          ...ALL_M10_MODULES,
          ...ALL_M13_MODULES,
          ...ALL_M14_MODULES,
          ...ACCOUNTING_ENGINE_MODULES,
          ...PROCUREMENT_MODULES,
          ...CRM_MODULES,
          ...DOC_TEMPLATE_MODULES,
          'qa',
          'launch',
          'documentation',
          'help_center',
          'help_articles',
          'training',
          'guided_walkthroughs',
          'training_environment',
          'support',
          'final_qa',
        )(p) && notGroupCtrl(p),
      notGroupCtrl,
      // Mobile POS Lite stock-in purchases + stock counts (manager-level; not
      // granted to cashiers/salespeople by default).
      (p) => p.code === 'mobile_pos_lite.purchase' || p.code === 'mobile_pos_lite.stock_count',
    ),
  },
  {
    name: 'BRANCH_MANAGER',
    displayName: 'Branch Manager',
    description: 'Manages day-to-day operations of an assigned branch.',
    scope: RoleScope.BRANCH,
    filter: combine(
      inModules(
        'branches',
        'employees',
        'inventory',
        'sales',
        'purchases',
        'supplier_order_drafts',
        'expenses',
        'documents',
        'reports',
        'customers',
        'suppliers',
        'products',
        'operations',
        // Petroleum branch manager access
        'petroleum',
        'fuel_tanks',
        'fuel_pumps',
        'fuel_nozzles',
        'fuel_prices',
        'fuel_shifts',
        'fuel_readings',
        'tank_dips',
        'fuel_collections',
        'fuel_credit_sales',
        'fuel_deliveries',
        'fuel_reconciliation',
        // Westsides branch manager access
        ...WESTSIDES_MODULES,
        // Itemba shared
        ...ITEMBA_SHARED_MODULES,
      ),
      // M13: Branch manager view access for devices, mobile, offline sync, payments, messaging
      (p) =>
        inModules(
          'devices',
          'mobile_sessions',
          'offline_sync',
          'external_payments',
          'external_messages',
        )(p) && readExport(p),
      // Mobile POS Lite stock-in purchases + stock counts (manager-level; not
      // granted to cashiers/salespeople by default).
      (p) => p.code === 'mobile_pos_lite.purchase' || p.code === 'mobile_pos_lite.stock_count',
    ),
  },
  {
    name: 'STATION_SUPERVISOR',
    displayName: 'Station Supervisor',
    description: 'Supervises shift operations at a fuel station branch.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'fuel_shifts' &&
        ['view', 'submit', 'supervisor_approve', 'reject'].includes(p.action)) ||
      (p.module === 'fuel_readings' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'tank_dips' && ['view', 'create', 'approve'].includes(p.action)) ||
      (p.module === 'fuel_collections' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'fuel_credit_sales' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'fuel_deliveries' && ['view', 'create', 'approve'].includes(p.action)) ||
      (p.module === 'fuel_reconciliation' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'petroleum' && ['dashboard.view', 'reports.view'].includes(p.action)),
  },
  {
    name: 'PUMP_ATTENDANT',
    displayName: 'Pump Attendant',
    description: 'Records nozzle readings and collections during assigned shift.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'fuel_shifts' && ['view', 'open', 'update'].includes(p.action)) ||
      (p.module === 'fuel_readings' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'fuel_collections' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'fuel_credit_sales' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'petroleum' && p.action === 'dashboard.view'),
  },
  {
    name: 'ACCOUNTANT',
    displayName: 'Accountant',
    description: 'Manages financial transactions and generates financial reports.',
    scope: RoleScope.COMPANY,
    filter: combine(
      inModules(
        'expenses',
        'record_book',
        'reports',
        'documents',
        'audit-logs',
        ...FINANCE_MODULES,
        ...ACCOUNTING_ENGINE_MODULES,
      ),
      (p) =>
        inModules('companies', 'divisions', 'branches', 'sales', 'employees')(p) && readExport(p),
      (p) => inModules('customers', 'suppliers', 'purchases', 'inventory')(p) && readExport(p),
      (p) =>
        inModules('fuel_collections', 'fuel_credit_sales', 'fuel_reconciliation', 'petroleum')(p) &&
        (readExport(p) || ['create', 'manage'].includes(p.action)),
      (p) => inModules(...ITEMBA_SHARED_MODULES)(p) && readExport(p),
      // M16: Base user access for Accountant
      (p) =>
        [
          'help_center.view',
          'support.tickets.create',
          'training.courses.view',
          'guided_walkthroughs.view',
        ].includes(p.code),
    ),
  },
  {
    name: 'CASHIER',
    displayName: 'Cashier',
    description: 'Records sales transactions and basic expenses at branch level.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'sales' && ['read', 'create', 'view'].includes(p.action)) ||
      (p.module === 'expenses' && ['read', 'create', 'view'].includes(p.action)) ||
      (p.module === 'record_book' &&
        ['view', 'create', 'update', 'finalize', 'export'].includes(p.action)) ||
      (p.module === 'cash_accounts' && p.action === 'view') ||
      (p.module === 'customers' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'operations' && p.action === 'dashboard.view') ||
      // Westsides POS
      (p.module === 'pos' && ['view', 'create', 'complete'].includes(p.action)) ||
      (p.module === 'retail_sales' && p.action === 'view') ||
      (p.module === 'westsides' && p.action === 'dashboard.view') ||
      p.code === 'mobile_pos_lite.use',
  },
  {
    name: 'INVENTORY_OFFICER',
    displayName: 'Inventory Officer',
    description: 'Manages stock levels and inventory records.',
    scope: RoleScope.BRANCH,
    filter: combine(
      inModules('inventory', 'products', 'product_categories', 'units', 'purchases'),
      (p) => inModules('reports', 'documents', 'suppliers', 'operations')(p) && readExport(p),
      inModules('fuel_tanks', 'tank_dips', 'fuel_deliveries'),
      (p) => inModules('petroleum')(p) && readExport(p),
      // Westsides inventory
      inModules('product_batches', 'stock_damage', 'delivery_notes'),
      (p) => inModules('westsides')(p) && readExport(p),
      // Itemba inventory read access
      (p) => inModules('farm_inputs', 'harvests', 'project_materials')(p) && readExport(p),
    ),
  },
  {
    name: 'SALESPERSON',
    displayName: 'Salesperson',
    description: 'Creates quotations, proformas, and customer orders. View delivery notes.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'quotations' && ['view', 'create', 'update'].includes(p.action)) ||
      (p.module === 'proformas' && ['view', 'create', 'update'].includes(p.action)) ||
      (p.module === 'delivery_notes' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'customers' && ['view', 'create', 'update'].includes(p.action)) ||
      (p.module === 'sales' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'wholesale_sales' && p.action === 'view') ||
      (p.module === 'retail_sales' && p.action === 'view') ||
      (p.module === 'price_lists' && p.action === 'view') ||
      (p.module === 'westsides' && p.action === 'dashboard.view') ||
      p.code === 'mobile_pos_lite.use',
  },

  // ── Itemba Enterprises Roles (Milestone 7) ──────────────────────────────────
  {
    name: 'LOGISTICS_MANAGER',
    displayName: 'Logistics Manager',
    description:
      'Full access to logistics operations, fleet, drivers, trips, and shared Itemba modules.',
    scope: RoleScope.COMPANY,
    filter: combine(inModules(...LOGISTICS_MODULES), inModules(...ITEMBA_SHARED_MODULES), (p) =>
      [
        'operations.dashboard.view',
        'customers.view',
        'suppliers.view',
        'products.view',
        'units.view',
      ].includes(p.code),
    ),
  },
  {
    name: 'AGRICULTURE_MANAGER',
    displayName: 'Agriculture Manager',
    description:
      'Full access to agriculture operations, farms, crops, harvests, and shared Itemba modules.',
    scope: RoleScope.COMPANY,
    filter: combine(inModules(...AGRICULTURE_MODULES), inModules(...ITEMBA_SHARED_MODULES), (p) =>
      [
        'operations.dashboard.view',
        'customers.view',
        'suppliers.view',
        'products.view',
        'units.view',
        'inventory.view',
      ].includes(p.code),
    ),
  },
  {
    name: 'CONSTRUCTION_MANAGER',
    displayName: 'Construction Manager',
    description:
      'Full access to construction operations, projects, sites, BOQ, and shared Itemba modules.',
    scope: RoleScope.COMPANY,
    filter: combine(inModules(...CONSTRUCTION_MODULES), inModules(...ITEMBA_SHARED_MODULES), (p) =>
      [
        'operations.dashboard.view',
        'customers.view',
        'suppliers.view',
        'products.view',
        'units.view',
        'inventory.view',
        'sales.view',
      ].includes(p.code),
    ),
  },
  {
    name: 'SITE_SUPERVISOR',
    displayName: 'Site Supervisor',
    description: 'Supervises construction site operations, materials, and progress.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'construction.dashboard' && p.action === 'view') ||
      (p.module === 'construction_sites' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'project_materials' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'project_progress' && ['view', 'submit'].includes(p.action)) ||
      (p.module === 'subcontractors' && p.action === 'view'),
  },
  {
    name: 'FARM_SUPERVISOR',
    displayName: 'Farm Supervisor',
    description: 'Supervises farm field operations, inputs, and harvests.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'agriculture.dashboard' && p.action === 'view') ||
      (p.module === 'farms' && p.action === 'view') ||
      (p.module === 'farm_fields' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'farm_inputs' && ['view', 'apply'].includes(p.action)) ||
      (p.module === 'harvests' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'agriculture_activities' && ['view', 'manage'].includes(p.action)),
  },

  // ── Milestone 8 Roles ──────────────────────────────────────────────────────
  {
    name: 'PROPERTY_MANAGER',
    displayName: 'Property Manager',
    description: 'Manages rental properties, units, tenants, leases, invoices, maintenance.',
    scope: RoleScope.COMPANY,
    filter: combine(inModules(...RENTAL_MODULES, ...LICENSED_BU_MODULES), (p) =>
      ['customers.view', 'suppliers.view', 'rental.dashboard.view', 'rental.reports.view'].includes(
        p.code,
      ),
    ),
  },
  {
    name: 'PARKING_SUPERVISOR',
    displayName: 'Parking Supervisor',
    description: 'Manages truck parking sessions, payments, and rates at the facility.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      inModules(...PARKING_MODULES)(p) ||
      (p.module === 'licensed_business_units' && p.action === 'view'),
  },
  {
    name: 'RECEPTIONIST',
    displayName: 'Receptionist',
    description: 'Handles guest check-in, check-out, bookings, and room assignments.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'room_bookings' &&
        ['view', 'create', 'check_in', 'check_out', 'cancel'].includes(p.action)) ||
      (p.module === 'guests' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'rooms' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'hospitality' && p.action === 'dashboard.view') ||
      (p.module === 'hospitality_payments' && ['view', 'create'].includes(p.action)),
  },
  {
    name: 'HOUSEKEEPER',
    displayName: 'Housekeeper',
    description: 'Manages room cleaning and housekeeping tasks.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      (p.module === 'housekeeping' && ['view', 'manage'].includes(p.action)) ||
      (p.module === 'rooms' && p.action === 'view') ||
      (p.module === 'hospitality' && p.action === 'dashboard.view'),
  },
  {
    name: 'RESTAURANT_SUPERVISOR',
    displayName: 'Restaurant / Bar Supervisor',
    description: 'Manages restaurant and bar orders, menu items, tables, and payments.',
    scope: RoleScope.BRANCH,
    filter: (p) =>
      inModules(
        'restaurant_orders',
        'restaurant_tables',
        'menu_items',
        'menu_categories',
        'hospitality_payments',
      )(p) ||
      (p.module === 'hospitality' && p.action === 'dashboard.view') ||
      (p.module === 'guests' && ['view', 'create'].includes(p.action)),
  },

  // ── Milestone 9 — HR & Payroll Roles ────────────────────────────────────────
  {
    name: 'GROUP_HR_DIRECTOR',
    displayName: 'Group HR Director',
    description: 'Group-level HR oversight with HR sign-off authority for payroll runs.',
    scope: RoleScope.GROUP,
    filter: combine(
      inModules(...HR_CORE_MODULES, ...HR_ATTENDANCE_MODULES, ...HR_OTHER_MODULES),
      (p) => HR_GROUP_APPROVAL_CODES.includes(p.code),
      (p) =>
        inModules(...HR_PAYROLL_MODULES)(p) &&
        (readExport(p) || ['payroll.approve.hr', 'payroll.sensitive.view'].includes(p.code)),
      (p) =>
        [
          'companies.read',
          'divisions.read',
          'branches.read',
          'users.read',
          'documents.read',
          'documents.create',
        ].includes(p.code),
    ),
  },
  {
    name: 'DIVISION_MANAGER',
    displayName: 'Division Manager',
    description:
      'Division-level operational manager with line-authority HR execution and first-stage approvals.',
    scope: RoleScope.DIVISION,
    filter: combine(
      (p) =>
        inModules(
          'companies',
          'divisions',
          'branches',
          'departments',
          'positions',
          'employees',
          'employment_contracts',
          'attendance',
          'leave_requests',
          'shift_schedules',
          'shifts',
          'reports',
        )(p) && !p.isGroupControl,
      (p) => ['employees.termination.request', 'leave_requests.approve'].includes(p.code),
    ),
  },
  {
    name: 'HR_MANAGER',
    displayName: 'HR Manager',
    description:
      'Full HR management for the assigned company: employees, contracts, attendance, leave, performance.',
    scope: RoleScope.COMPANY,
    filter: combine(
      inModules(...HR_CORE_MODULES, ...HR_ATTENDANCE_MODULES, ...HR_OTHER_MODULES),
      (p) => inModules(...HR_PAYROLL_MODULES)(p) && readExport(p),
      (p) =>
        [
          'companies.read',
          'divisions.read',
          'branches.read',
          'users.read',
          'documents.read',
          'documents.create',
        ].includes(p.code),
      // M16: Training and documentation for HR Manager
      (p) =>
        [
          'training.dashboard.view',
          'training.courses.view',
          'training.courses.manage',
          'training.lessons.manage',
          'training.enrollments.view',
          'training.enrollments.manage',
          'training.progress.view',
          'guided_walkthroughs.view',
          'help_center.view',
          'documentation.view',
          'support.tickets.create',
        ].includes(p.code),
    ),
  },
  {
    name: 'PAYROLL_OFFICER',
    displayName: 'Payroll Officer',
    description: 'Processes payroll, manages allowances, deductions, salary payments and advances.',
    scope: RoleScope.COMPANY,
    filter: combine(
      (p) =>
        inModules(...HR_PAYROLL_MODULES)(p) &&
        !['payroll.approve.hr', 'payroll.approve.finance'].includes(p.code),
      (p) => inModules(...HR_CORE_MODULES)(p) && readExport(p),
      (p) => ['companies.read', 'divisions.read', 'branches.read'].includes(p.code),
    ),
  },

  // ── Milestone 10 — Compliance Officer Role ──────────────────────────────────
  {
    name: 'COMPLIANCE_OFFICER',
    displayName: 'Compliance Officer',
    description:
      'Manages compliance obligations, tax registrations, filing periods, document requirements, and evidence packs.',
    scope: RoleScope.COMPANY,
    filter: combine(
      (p) => inModules(...ALL_M10_MODULES)(p) && notGroupCtrl(p),
      (p) => inModules(...FINANCE_MODULES)(p) && readExport(p),
      (p) => inModules(...HR_PAYROLL_MODULES)(p) && readExport(p),
      (p) =>
        [
          'companies.read',
          'divisions.read',
          'branches.read',
          'documents.read',
          'documents.create',
          'audit-logs.read',
        ].includes(p.code),
      // M13: Integration & payment visibility for compliance purposes
      (p) =>
        [
          'integrations.dashboard.view',
          'integration_providers.view',
          'integration_connections.view',
          'integration_events.view',
          'external_payments.view',
          'integration_mappings.view',
        ].includes(p.code),
      (p) =>
        inModules(...RETENTION_MODULES, ...SECURITY_MODULES)(p) &&
        (readExport(p) || ['manage', 'approve'].includes(p.action)),
      (p) =>
        inModules(...BACKUP_DR_MODULES, ...PRODUCTION_MODULES, ...MONITORING_MODULES)(p) &&
        readExport(p),
    ),
  },

  // ── Milestone 14.5 — Procurement Officer Role ────────────────────────────────
  {
    name: 'PROCUREMENT_OFFICER',
    displayName: 'Procurement Officer',
    description:
      'Manages procurement processes, supplier quotations, purchase requisitions, GRNs, and supplier relationships.',
    scope: RoleScope.COMPANY,
    filter: combine(
      inModules(...PROCUREMENT_MODULES, ...CRM_MODULES),
      (p) =>
        inModules(
          'companies',
          'divisions',
          'branches',
          'documents',
          'reports',
          'suppliers',
          'customers',
        )(p) && readExport(p),
      (p) => inModules(...FINANCE_MODULES)(p) && readExport(p),
    ),
  },
];

// ─── Msaidizi is admin-only by default (integration plan D4 / §5) ────────────

/**
 * Msaidizi's permission modules — `msaidizi` and anything under `msaidizi.*`.
 * Matching by prefix rather than by a fixed list means a permission module
 * added later (`msaidizi.oversight`, say) is covered the day it is defined,
 * instead of quietly reopening the default.
 */
const isMsaidiziPerm = (p: PermDef): boolean =>
  p.module === 'msaidizi' || p.module.startsWith('msaidizi.');

/**
 * The only role the seed grants Msaidizi to. `GROUP_SUPER_ADMIN` has
 * `filter: all`, so it picks up every Msaidizi permission — present and future
 * — automatically. There is no per-user permission model in this system
 * (`jwt.strategy.ts` and `auth.service.ts` both compute a user's permissions as
 * the union over `userRoles → rolePermissions` and nothing else contributes),
 * so "the admin account alone" is only expressible as "the role only the admin
 * holds".
 */
const MSAIDIZI_SEEDED_ROLES = ['GROUP_SUPER_ADMIN'];

// Stage one exposes Fuel Grid as a separately authenticated application. Keep
// its launcher admin-only until the external rollout has its own access policy.
const FUEL_GRID_SEEDED_ROLES = ['GROUP_SUPER_ADMIN'];

const isFuelGridPerm = (p: PermDef): boolean => p.module === 'fuel_grid';

/**
 * Remove Msaidizi from every other role's grant, whatever that role's own
 * filter says.
 *
 * This is applied structurally rather than by editing each role's module list,
 * because editing the list does not work. `combine` is a logical OR: a role
 * keeps a permission if *any* clause of its filter matches, so deleting
 * `'msaidizi'` from an `inModules(...)` list is only a revocation when no other
 * clause happens to match it. Measured against this matrix, with the
 * `inModules` entries already deleted:
 *
 *   • `COMPANY_MANAGER` — filter contains a bare `notGroupCtrl`, which matches
 *     every non-group-control permission. Deleting `'msaidizi'` from its module
 *     list changed its grant by exactly nothing: still all four permissions.
 *   • `GROUP_DIRECTOR`, `GROUP_AUDITOR` — filters contain `readExport`, which
 *     matches `action === 'view'`. `msaidizi.procedures.view` survived the
 *     deletion in both.
 *
 * So the deletions express the intent and this expresses the guarantee. A role
 * that should hold Msaidizi deliberately gets it from a non-system role created
 * through `POST /roles` (`MSAIDIZI_USER`), which the seed does not manage and
 * therefore does not overwrite — see the integration plan §5.4.
 */
export const ROLES: RoleDef[] = BASE_ROLES.map((role) => {
  const mayUseMsaidizi = MSAIDIZI_SEEDED_ROLES.includes(role.name);
  const mayAccessFuelGrid = FUEL_GRID_SEEDED_ROLES.includes(role.name);

  return {
    ...role,
    filter: (permission) =>
      (mayUseMsaidizi || !isMsaidiziPerm(permission)) &&
      (mayAccessFuelGrid || !isFuelGridPerm(permission)) &&
      role.filter(permission),
  };
});
