/**
 * ITEMBA-R — Production Seed v2
 *
 * Idempotent (safe to run multiple times). Creates:
 *   • 1 Group: "Itemba Group"
 *   • 3 BRELA-recognised Companies with full legal profiles
 *   • 6 Divisions across all three companies
 *   • Comprehensive permission set (60+ codes)
 *   • 9 system roles with tailored permission matrices
 *   • 1 Group Super Admin user
 */
import {
  PrismaClient,
  RoleScope,
  DivisionType,
  CompanyStatus,
  CurrencyCode,
  AccountType,
  FiscalPeriodStatus,
  CashAccountType,
  UnitType,
  ProductCategoryType,
  ProductType,
  FuelTankStatus,
  FuelPumpStatus,
  FuelNozzleStatus,
  FuelPriceStatus,
  BranchType,
  SalesChannelType,
  PriceListType,
  PriceListStatus,
  ReturnablePackageType,
  ReturnablePackageStatus,
  VehicleStatus,
  VehicleType,
  VehicleFuelType,
  DriverStatus,
  RouteStatus,
  FarmOwnershipType,
  FarmStatus,
  CropType,
  CropStatus,
  ConstructionProjectType,
  ConstructionProjectStatus,
  // Milestone 8
  BusinessUnitType,
  BusinessUnitStatus,
  BusinessLicenseType,
  BusinessLicenseStatus,
  RentalPropertyType,
  RentalOwnershipType,
  RentalPropertyStatus,
  RentalUnitType,
  RentalUnitStatus,
  BillingFrequency,
  TenantType,
  TenantStatus,
  LeaseStatus,
  RentInvoiceStatus,
  ParkingFacilityStatus,
  ParkingZoneVehicleType,
  ParkingZoneStatus,
  ParkingRateType,
  ParkingRateStatus,
  HospitalityFacilityType,
  HospitalityFacilityStatus,
  RoomType,
  RoomStatus,
  GuestStatus,
  RoomBookingStatus,
  BookingSource,
  MenuCategoryType,
  MenuItemType,
  RestaurantTableStatus,
  RestaurantOrderType,
  RestaurantOrderStatus,
  // Milestone 9
  DepartmentStatus,
  PositionType,
  PositionStatus,
  Gender,
  EmploymentType,
  EmploymentStatus,
  HRPaymentFrequency,
  EmploymentContractType,
  EmploymentContractStatus,
  ShiftType,
  // Milestone 10
  TaxAuthorityType,
  TaxAuthorityStatus,
  TaxRegistrationType,
  TaxRegistrationStatus,
  TaxCategory,
  TaxRateCalculationMethod,
  TaxRateStatus,
  TaxCodeAppliesTo,
  TaxCodeStatus,
  ComplianceObligationType,
  ComplianceObligationRecurrence,
  CompliancePriority,
  ComplianceObligationStatus,
  StatutoryDeductionCalcMethod,
  StatutoryDeductionStatus,
  ComplianceDocReqType,
  AuditEvidencePackType,
  AuditEvidencePackStatus,
  // Milestone 11
  WorkflowScope,
  WorkflowTriggerAction,
  ApproverType,
  ApprovalRequestStatus,
  DelegationStatus,
  NotificationType,
  NotificationPriority,
  NotificationStatus,
  AlertType,
  AlertFrequency,
  AlertRecipientType,
  AlertEventStatus,
  TaskType,
  TaskPriority,
  TaskStatus,
  ControlType,
  EnforcementLevel,
  // Milestone 13
  IntegrationProviderType,
  IntegrationProviderStatus,
  ExternalMessageChannel,
  MessageTemplateType,
} from '../../backend/node_modules/@prisma/client';
import * as argon2 from 'argon2';
import { seedTzReferenceData } from './tz-reference';
import { seedC1TaxExtensions } from './c1-tz-tax-extensions';

const prisma = new PrismaClient();

// ─── Permission definitions ──────────────────────────────────────────────────

interface PermDef {
  code: string;
  description: string;
  module: string;
  action: string;
  isGroupControl: boolean;
}

function perms(module: string, actions: string[], isGroupControl = false): PermDef[] {
  return actions.map((action) => ({
    code: `${module}.${action}`,
    description: `${action.charAt(0).toUpperCase() + action.slice(1)} ${module.replace(/-/g, ' ')}`,
    module,
    action,
    isGroupControl,
  }));
}

const ALL_PERMISSIONS: PermDef[] = [
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
  ...perms('documents', ['read', 'create', 'update', 'delete', 'view', 'manage']),
  ...perms('reports', ['read', 'export']),

  // Operational
  ...perms('inventory', ['read', 'create', 'update', 'delete']),
  ...perms('sales', ['read', 'create', 'update']),
  ...perms('expenses', ['read', 'create', 'update', 'delete']),
  ...perms('employees', ['read', 'create', 'update']),

  // Group Control — sensitive financial records (restricted to GROUP-scoped roles)
  ...perms('group-control', ['view', 'manage'], true),
  ...perms('bank-accounts', ['read', 'create', 'update', 'delete', 'approve'], true),
  ...perms('loans', ['read', 'create', 'update', 'delete', 'approve', 'manage'], true),
  ...perms('debts', ['read', 'create', 'update', 'delete'], true),
  ...perms('contracts', ['read', 'create', 'update', 'delete', 'approve', 'view', 'manage'], true),
  ...perms('fixed-assets', ['read', 'create', 'update', 'delete'], true),

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
    code: 'employees.termination.approve.gm',
    description: 'Company GM approval for employee termination',
    module: 'hr_governance',
    action: 'termination.approve.gm',
    isGroupControl: false,
  },
  {
    code: 'employees.transfer.approve.division',
    description: 'Division Manager approval for employee transfer',
    module: 'hr_governance',
    action: 'transfer.approve.division',
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
    code: 'employees.transfer.approve.gm',
    description: 'Company GM approval for employee transfer',
    module: 'hr_governance',
    action: 'transfer.approve.gm',
    isGroupControl: false,
  },
  {
    code: 'employees.transfer.approve.finance',
    description: 'Group Finance approval for inter-company employee transfer',
    module: 'hr_governance',
    action: 'transfer.approve.finance',
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
  {
    code: 'disciplinary_actions.approve.gm',
    description: 'Company GM co-sign for disciplinary actions',
    module: 'hr_governance',
    action: 'disciplinary.approve.gm',
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
  ...perms('data_exports', ['view', 'create', 'download']),
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
    isGroupControl: false,
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
  ...perms('security_events', ['view', 'review', 'resolve']),
  ...perms('active_sessions', ['view', 'revoke']),
  ...perms('two_factor', ['manage']),
  ...perms('account_locks', ['manage']),

  // ── Backup & Disaster Recovery (Milestone 14) ───────────────────────────────
  {
    code: 'backups.dashboard.view',
    description: 'View backups dashboard',
    module: 'backups',
    action: 'dashboard.view',
    isGroupControl: false,
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
  ...perms('customer_segments', ['list', 'view', 'create', 'update', 'manage_members']),
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
  ...perms('scalability', ['dashboard.view']),
  ...perms('load_tests', ['view', 'manage', 'run']),
  ...perms('data_isolation', ['view', 'run_tests', 'resolve_issues', 'sensitive.view']),
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

type PermFilter = (p: PermDef) => boolean;

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
const HR_COMPANY_GM_APPROVAL_CODES = [
  'employees.termination.approve.gm',
  'employees.transfer.approve.gm',
  'disciplinary_actions.approve.gm',
];
const HR_DIVISION_MANAGER_APPROVAL_CODES = ['employees.transfer.approve.division'];
const HR_FINANCE_APPROVAL_CODES = ['employees.transfer.approve.finance'];

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
  ...perms('data_isolation', ['view', 'run_tests', 'resolve_issues', 'sensitive.view']),
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

interface RoleDef {
  name: string;
  displayName: string;
  description: string;
  scope: RoleScope;
  filter: PermFilter;
}

const ROLES: RoleDef[] = [
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
      inModules(...FINANCE_MODULES, 'expenses'),
      inModules(...ACCOUNTING_ENGINE_MODULES, ...PROCUREMENT_MODULES),
      (p) => inModules(...OPERATIONS_MODULES)(p) && readExport(p),
      (p) => p.code === 'payroll.approve.finance',
      (p) => HR_FINANCE_APPROVAL_CODES.includes(p.code),
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
      ),
      notGroupCtrl,
      (p) => HR_COMPANY_GM_APPROVAL_CODES.includes(p.code),
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
      (p.module === 'cash_accounts' && p.action === 'view') ||
      (p.module === 'customers' && ['view', 'create'].includes(p.action)) ||
      (p.module === 'operations' && p.action === 'dashboard.view') ||
      // Westsides POS
      (p.module === 'pos' && ['view', 'create', 'complete'].includes(p.action)) ||
      (p.module === 'retail_sales' && p.action === 'view') ||
      (p.module === 'westsides' && p.action === 'dashboard.view'),
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
      (p.module === 'westsides' && p.action === 'dashboard.view'),
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
      (p) => HR_DIVISION_MANAGER_APPROVAL_CODES.includes(p.code),
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
      inModules(...ALL_M10_MODULES),
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
      // M15: Data isolation visibility for compliance
      (p) => ['data_isolation.view', 'data_isolation.sensitive.view'].includes(p.code),
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

// ─── Company seed data ───────────────────────────────────────────────────────

interface CompanySeed {
  code: string;
  name: string;
  industryType: string;
  profile: {
    registeredName: string;
    brelaRegNumber: string;
    tin: string;
    vrn?: string;
    businessLicenseNumber?: string;
    registeredAddress: string;
    taxOffice: string;
    natureOfBusiness: string;
    incorporationDate: Date;
  };
  divisions: { name: string; code: string; type: DivisionType; description: string }[];
}

const COMPANIES: CompanySeed[] = [
  {
    code: 'MWANJALISI',
    name: 'Mwanjalisi Oil',
    industryType: 'Petroleum & Energy',
    profile: {
      registeredName: 'Mwanjalisi Oil Limited',
      brelaRegNumber: 'BRN-TZ-2010-001234',
      tin: '100-123-456',
      vrn: 'TZ-100-123456-V',
      businessLicenseNumber: 'BL-2010-MOL-001',
      registeredAddress: 'Plot 45, Nyerere Road, Dar es Salaam, Tanzania',
      taxOffice: 'TRA Dar es Salaam City',
      natureOfBusiness: 'Petroleum products retail and distribution',
      incorporationDate: new Date('2010-03-15'),
    },
    divisions: [
      {
        name: 'Petroleum Division',
        code: 'PETRO',
        type: DivisionType.PETROLEUM,
        description: 'Fuel retail, station operations, supplier purchases, and fuel management',
      },
      {
        name: 'Truck Parking Division',
        code: 'PARKING',
        type: DivisionType.TRUCK_PARKING,
        description: 'Licensed truck parking facility operations and parking revenue',
      },
      {
        name: 'Rental Shops Division',
        code: 'RENTAL',
        type: DivisionType.RENTAL_SHOPS,
        description: 'Rental shops management, lease agreements, and rent collection',
      },
    ],
  },
  {
    code: 'ITEMBA_ENT',
    name: 'Itemba Enterprises Co. Ltd',
    industryType: 'Logistics, Agriculture & Construction',
    profile: {
      registeredName: 'Itemba Enterprises Company Limited',
      brelaRegNumber: 'BRN-TZ-2008-005678',
      tin: '100-234-567',
      vrn: 'TZ-100-234567-V',
      businessLicenseNumber: 'BL-2008-IEC-001',
      registeredAddress: 'Mikocheni Light Industrial Area, Dar es Salaam, Tanzania',
      taxOffice: 'TRA Dar es Salaam City',
      natureOfBusiness: 'Logistics, agriculture, and construction services',
      incorporationDate: new Date('2008-07-01'),
    },
    divisions: [
      {
        name: 'Logistics Division',
        code: 'LOG',
        type: DivisionType.LOGISTICS,
        description: 'Fleet management, transport operations, trip revenue and profitability',
      },
      {
        name: 'Agriculture Division',
        code: 'AGRI',
        type: DivisionType.AGRICULTURE,
        description: 'Farm management, crop seasons, inputs, harvests, and produce inventory',
      },
      {
        name: 'Construction Division',
        code: 'CON',
        type: DivisionType.CONSTRUCTION,
        description: 'Projects, BOQ tracking, subcontractors, labor, and project profitability',
      },
      {
        name: 'Real Estate Division',
        code: 'REAL_ESTATE',
        type: DivisionType.REAL_ESTATE,
        description: 'Shops and houses for rent, lease management, and property maintenance',
      },
    ],
  },
  {
    code: 'WESTSIDES',
    name: 'Westsides Company Ltd',
    industryType: 'Wholesale & Retail Trade',
    profile: {
      registeredName: 'Westsides Company Limited',
      brelaRegNumber: 'BRN-TZ-2015-009012',
      tin: '100-345-678',
      vrn: 'TZ-100-345678-V',
      businessLicenseNumber: 'BL-2015-WCL-001',
      registeredAddress: 'Kariakoo Commercial District, Dar es Salaam, Tanzania',
      taxOffice: 'TRA Kariakoo',
      natureOfBusiness: 'Wholesale and retail of beverages, hardware, and building materials',
      incorporationDate: new Date('2015-01-20'),
    },
    divisions: [
      {
        name: 'Beverages Division',
        code: 'BEV',
        type: DivisionType.BEVERAGES,
        description:
          'Wholesale and retail of alcoholic and non-alcoholic beverages; batch/expiry tracking',
      },
      {
        name: 'Hardware & Building Materials Division',
        code: 'HWB',
        type: DivisionType.HARDWARE_BUILDING,
        description: 'Wholesale and retail of hardware and building materials',
      },
      {
        name: 'Hospitality Division',
        code: 'HOSPITALITY',
        type: DivisionType.HOSPITALITY,
        description: 'Uzunguni Inn — guest house, restaurant, and bar operations',
      },
    ],
  },
];

// ─── Branch seed helper ───────────────────────────────────────────────────────

interface BranchSeed {
  code: string;
  name: string;
  type: BranchType;
  divisionCode: string;
  location?: string;
}

const COMPANY_BRANCHES: Record<string, BranchSeed[]> = {
  MWANJALISI: [
    {
      code: 'FS-001',
      name: 'Main Fuel Station',
      type: BranchType.FUEL_STATION,
      divisionCode: 'PETRO',
      location: 'Nyerere Road, Dar es Salaam',
    },
  ],
  ITEMBA_ENT: [
    {
      code: 'LOG-HQ',
      name: 'Logistics HQ',
      type: BranchType.OFFICE,
      divisionCode: 'LOG',
      location: 'Mikocheni, Dar es Salaam',
    },
    {
      code: 'FARM-001',
      name: 'Main Farm',
      type: BranchType.FARM,
      divisionCode: 'AGRI',
      location: 'Morogoro Region',
    },
    {
      code: 'SITE-001',
      name: 'Construction Site 1',
      type: BranchType.SITE,
      divisionCode: 'CON',
      location: 'Dar es Salaam',
    },
  ],
  WESTSIDES: [
    {
      code: 'BEV-STORE',
      name: 'Beverages Warehouse',
      type: BranchType.WAREHOUSE,
      divisionCode: 'BEV',
      location: 'Kariakoo, Dar es Salaam',
    },
    {
      code: 'HWB-STORE',
      name: 'Hardware Store',
      type: BranchType.BRANCH,
      divisionCode: 'HWB',
      location: 'Kariakoo, Dar es Salaam',
    },
  ],
};

async function seedCompanyBranches(companyId: string, companyCode: string) {
  const branchDefs = COMPANY_BRANCHES[companyCode] ?? [];
  for (const b of branchDefs) {
    const division = await prisma.division.findFirst({
      where: { companyId, code: b.divisionCode },
    });
    if (!division) continue;
    await prisma.branch.upsert({
      where: { divisionId_code: { divisionId: division.id, code: b.code } },
      update: { name: b.name, type: b.type, location: b.location },
      create: {
        code: b.code,
        name: b.name,
        type: b.type,
        location: b.location,
        divisionId: division.id,
        isActive: true,
      },
    });
  }
}

// ─── Main seed function ──────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding ITEMBA-R (production schema v2)...\n');

  // ── 1. Group ──────────────────────────────────────────────────────────────
  console.log('  ▸ Group...');
  const group = await prisma.group.upsert({
    where: { name: 'Itemba Group' },
    update: {},
    create: {
      name: 'Itemba Group',
      code: 'ITEMBA',
      description:
        'Parent governance entity for Mwanjalisi Oil, Itemba Enterprises, and Westsides Company',
      address: 'ITEMBA House, Ohio Street, Dar es Salaam, Tanzania',
      phone: '+255 22 000 0000',
      email: 'group@itemba.co.tz',
    },
  });

  // ── 2. Companies + legal profiles + divisions ─────────────────────────────
  console.log('  ▸ Companies, legal profiles, and divisions...');
  // Prefix used by auto-generated employee codes — matches the convention
  // already used in the demo employee seed (MWAN-EMP-001, WEST-EMP-002, etc.).
  const PREFIX_BY_CODE: Record<string, string> = {
    MWANJALISI: 'MWAN',
    WESTSIDES: 'WEST',
    ITEMBA_ENT: 'ITEM',
  };
  for (const c of COMPANIES) {
    const prefix = PREFIX_BY_CODE[c.code] ?? c.code.slice(0, 4).toUpperCase();
    const company = await prisma.company.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        groupId: group.id,
        industryType: c.industryType,
        employeeCodePrefix: prefix,
      },
      create: {
        code: c.code,
        name: c.name,
        industryType: c.industryType,
        groupId: group.id,
        employeeCodePrefix: prefix,
        status: CompanyStatus.ACTIVE,
      },
    });

    await prisma.companyProfile.upsert({
      where: { companyId: company.id },
      update: { ...c.profile },
      create: {
        companyId: company.id,
        ...c.profile,
        currency: CurrencyCode.TZS,
        status: CompanyStatus.ACTIVE,
      },
    });

    for (const d of c.divisions) {
      await prisma.division.upsert({
        where: { companyId_code: { companyId: company.id, code: d.code } },
        update: { name: d.name, type: d.type, description: d.description },
        create: { ...d, companyId: company.id },
      });
    }

    // Seed default branches for each company
    await seedCompanyBranches(company.id, c.code);
  }

  // ── 3. Permissions ────────────────────────────────────────────────────────
  console.log(`  ▸ Permissions (${ALL_PERMISSIONS.length} total)...`);
  for (const p of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, isGroupControl: p.isGroupControl },
      create: p,
    });
  }

  // ── 4. Roles with permission matrices ────────────────────────────────────
  console.log(`  ▸ Roles (${ROLES.length} total)...`);
  const allPerms = await prisma.permission.findMany();

  for (const r of ROLES) {
    const permIds = allPerms.filter(r.filter).map((p) => p.id);

    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { displayName: r.displayName, description: r.description, scope: r.scope },
      create: {
        name: r.name,
        displayName: r.displayName,
        description: r.description,
        scope: r.scope,
        isSystem: true,
      },
    });

    // Replace role permissions (full replace for idempotency)
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permIds.map((pid) => ({ roleId: role.id, permissionId: pid })),
      skipDuplicates: true,
    });

    console.log(`      ${r.displayName}: ${permIds.length} permissions`);
  }

  // ── 5. Super admin user ───────────────────────────────────────────────────
  console.log('  ▸ Admin user...');
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const isProductionSeed = process.env.NODE_ENV === 'production';
  const seedDemoData = !isProductionSeed || process.env.SEED_DEMO_DATA === 'true';
  if (isProductionSeed && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD is required when running the seed in production');
  }
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';
  const passwordHash = await argon2.hash(adminPassword);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { fullName: 'Group Administrator' },
    create: {
      email: adminEmail,
      passwordHash,
      fullName: 'Group Administrator',
      title: 'System Administrator',
      mustChangePassword: true,
    },
  });

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: 'GROUP_SUPER_ADMIN' },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: superAdminRole.id },
  });

  // ── 6. Finance Foundation seed (Milestone 3) ──────────────────────────────
  console.log('  ▸ Finance foundation (COA, fiscal years, periods, cash, categories)...');
  await seedFinance();

  // ── 7. Operations Foundation seed (Milestone 4) ────────────────────────────
  console.log('  ▸ Operations foundation (units, categories, locations, products)...');
  await seedOperations();

  // ── 8. Petroleum Operations seed (Milestone 5) ─────────────────────────────
  if (seedDemoData) {
    console.log('  ▸ Petroleum operations (tanks, pumps, nozzles, prices)...');
    await seedPetroleum();
  }

  // ── 9. Westsides Operations seed (Milestone 6) ─────────────────────────────
  if (seedDemoData) {
    console.log('  ▸ Westsides operations (sales channels, price lists, packages)...');
    await seedWestsides();
  }

  // ── 10. Itemba Enterprises seed (Milestone 7) ──────────────────────────────
  if (seedDemoData) {
    console.log('  ▸ Itemba Enterprises operations (logistics, agriculture, construction)...');
    await seedItemba();
  }

  // ── 11. Rental, Parking, Hospitality seed (Milestone 8) ────────────────────
  if (seedDemoData) {
    console.log('  ▸ Milestone 8 (licensed business units, rental, parking, hospitality)...');
    await seedM8();
  }

  // ── 12. HR, Payroll, Attendance seed (Milestone 9) ─────────────────────────
  if (seedDemoData) {
    console.log('  ▸ Milestone 9 (HR, payroll, departments, positions, employees)...');
    await seedM9();
  }

  // ── Milestone 10 seed ──────────────────────────────────────────────────
  console.log('  ▸ Milestone 10 (Tax authorities, types, registrations, compliance)...');
  await seedM10();

  // ── C1 — Tanzania tax library extensions (transactional + corporate) ───
  // Layered on top of M10's core authorities/types and tz-reference's payroll
  // bands. Adds WHT variants, VAT-0 / VAT-EXEMPT, City Service Levy, CIT,
  // provisional ITX, and the operator-facing tax codes.
  const c1Admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  await seedC1TaxExtensions(prisma, c1Admin.id);

  // ── Milestone 11 seed ──────────────────────────────────────────────────
  if (seedDemoData) {
    console.log('  ▸ Milestone 11 (Approval workflows, notifications, alerts, controls, tasks)...');
    await seedM11();
  }

  // ── Milestone 12 seed ──────────────────────────────────────────────────
  if (seedDemoData) {
    console.log('  ▸ Milestone 12 (BI & Executive Intelligence)...');
    await seedM12();
  }

  // ── Milestone 13 seed ──────────────────────────────────────────────────
  if (seedDemoData) {
    console.log(
      '  ▸ Milestone 13 (Integrations, API Gateway, Webhooks, Mobile, Payments, Messaging)...',
    );
    await seedM13();
  }

  // ── Milestone 14 — Security Policies ──────────────────────────────────────
  console.log('Seeding security policies...');
  const securityPolicies = [
    {
      policyCode: 'POL-PWD-001',
      name: 'Default Password Policy',
      policyType: 'PASSWORD' as any,
      settings: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSpecial: false,
        passwordExpiryDays: 90,
        preventPasswordReuseCount: 5,
      },
      isActive: true,
      createdById: admin.id,
    },
    {
      policyCode: 'POL-SES-001',
      name: 'Default Session Policy',
      policyType: 'SESSION' as any,
      settings: {
        idleTimeoutMinutes: 30,
        absoluteTimeoutHours: 8,
        maxConcurrentSessions: 3,
        requireReauthForSensitiveActions: true,
      },
      isActive: true,
      createdById: admin.id,
    },
    {
      policyCode: 'POL-LOGIN-001',
      name: 'Default Login Attempt Policy',
      policyType: 'LOGIN_ATTEMPT' as any,
      settings: {
        maxFailedAttempts: 5,
        lockoutMinutes: 15,
        suspiciousLoginAlert: true,
      },
      isActive: true,
      createdById: admin.id,
    },
    {
      policyCode: 'POL-2FA-001',
      name: 'Default Two-Factor Policy',
      policyType: 'TWO_FACTOR' as any,
      settings: {
        requiredForAdmins: false,
        requiredForSensitiveRoles: false,
        requiredForExternalAccess: false,
        allowedMethods: ['TOTP', 'EMAIL'],
      },
      isActive: true,
      createdById: admin.id,
    },
    {
      policyCode: 'POL-API-001',
      name: 'Default API Security Policy',
      policyType: 'API_SECURITY' as any,
      settings: {
        requireApiKeyForExternalAccess: true,
        rateLimit: 100,
        rateLimitWindowMinutes: 1,
        logAllRequests: true,
      },
      isActive: true,
      createdById: admin.id,
    },
  ];

  for (const policy of securityPolicies) {
    await prisma.securityPolicy.upsert({
      where: { policyCode: policy.policyCode },
      update: {},
      create: policy,
    });
  }

  // ── Milestone 14 — System Health Checks ──────────────────────────────────
  console.log('Seeding system health checks...');
  const publicApiUrl = (
    process.env.NEXT_PUBLIC_API_URL ?? 'https://api.itembagrouptz.com/api/v1'
  ).replace(/\/$/, '');
  const healthChecks = [
    {
      healthCheckCode: 'HC-DB-001',
      name: 'Database Connectivity',
      checkType: 'DATABASE' as any,
      endpointOrTarget: 'postgresql',
      isActive: true,
    },
    {
      healthCheckCode: 'HC-API-001',
      name: 'API Server',
      checkType: 'API' as any,
      endpointOrTarget: `${publicApiUrl}/health`,
      isActive: true,
    },
    {
      healthCheckCode: 'HC-AUTH-001',
      name: 'Authentication Service',
      checkType: 'AUTH' as any,
      endpointOrTarget: 'auth-module',
      isActive: true,
    },
    {
      healthCheckCode: 'HC-STR-001',
      name: 'File Storage',
      checkType: 'STORAGE' as any,
      endpointOrTarget: 'local-storage',
      isActive: true,
    },
    {
      healthCheckCode: 'HC-DISK-001',
      name: 'Disk Space',
      checkType: 'DISK' as any,
      endpointOrTarget: 'system-disk',
      isActive: true,
    },
    {
      healthCheckCode: 'HC-MEM-001',
      name: 'Memory Usage',
      checkType: 'MEMORY' as any,
      endpointOrTarget: 'system-memory',
      isActive: true,
    },
    {
      healthCheckCode: 'HC-INT-001',
      name: 'Integration Services',
      checkType: 'INTEGRATION' as any,
      endpointOrTarget: 'integration-module',
      isActive: true,
    },
    {
      healthCheckCode: 'HC-BCK-001',
      name: 'Backup Status',
      checkType: 'BACKUP' as any,
      endpointOrTarget: 'backup-module',
      isActive: true,
    },
  ];

  for (const check of healthChecks) {
    await prisma.systemHealthCheck.upsert({
      where: { healthCheckCode: check.healthCheckCode },
      update: {},
      create: check,
    });
  }

  // ── Milestone 14 — Backup Jobs ────────────────────────────────────────────
  console.log('Seeding backup jobs...');
  const backupJobs = [
    {
      backupJobCode: 'BJ-DB-001',
      name: 'Daily Database Backup',
      backupType: 'DATABASE' as any,
      schedule: 'DAILY' as any,
      scheduleConfig: { hour: 2, minute: 0 },
      storageTarget: 'LOCAL' as any,
      retentionDays: 30,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      backupJobCode: 'BJ-DOC-001',
      name: 'Weekly Documents Backup',
      backupType: 'DOCUMENTS' as any,
      schedule: 'WEEKLY' as any,
      scheduleConfig: { dayOfWeek: 0, hour: 3, minute: 0 },
      storageTarget: 'LOCAL' as any,
      retentionDays: 90,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      backupJobCode: 'BJ-FULL-001',
      name: 'Monthly Full System Backup',
      backupType: 'FULL_SYSTEM' as any,
      schedule: 'MONTHLY' as any,
      scheduleConfig: { dayOfMonth: 1, hour: 1, minute: 0 },
      storageTarget: 'LOCAL' as any,
      retentionDays: 365,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
  ];

  for (const job of backupJobs) {
    await prisma.backupJob.upsert({
      where: { backupJobCode: job.backupJobCode },
      update: {},
      create: job,
    });
  }

  // ── Milestone 14 — Disaster Recovery Plan ────────────────────────────────
  console.log('Seeding disaster recovery plan...');
  await prisma.disasterRecoveryPlan.upsert({
    where: { drPlanCode: 'DR-GRP-001' },
    update: {},
    create: {
      drPlanCode: 'DR-GRP-001',
      name: 'Itemba Group — Business Continuity & Disaster Recovery Plan',
      description:
        'Group-wide disaster recovery plan covering database, documents, and critical business systems.',
      recoveryPointObjectiveMinutes: 60,
      recoveryTimeObjectiveMinutes: 240,
      criticalSystems: ['Database', 'Authentication', 'Finance Module', 'Documents Vault'],
      backupStrategy:
        'Daily database backups, weekly document backups, monthly full-system backups stored locally and offsite.',
      recoverySteps:
        '1. Assess damage\n2. Restore database from latest backup\n3. Restore documents\n4. Verify data integrity\n5. Resume operations\n6. Notify stakeholders',
      responsibleUsers: ['Group Super Admin', 'Group IT Manager'],
      emergencyContacts: [{ name: 'Group IT Support', phone: '+255700000001' }],
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
  });

  // ── Milestone 14 — Retention Policies ────────────────────────────────────
  console.log('Seeding retention policies...');
  const retentionPolicies = [
    {
      retentionPolicyCode: 'RET-AUDIT-001',
      name: 'Audit Log Retention',
      dataCategory: 'AUDIT_LOGS' as any,
      retentionDays: 2555,
      archiveAfterDays: 365,
      deletionAllowed: false,
      requiresApproval: true,
      legalHold: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      retentionPolicyCode: 'RET-SEC-001',
      name: 'Security Events Retention',
      dataCategory: 'SECURITY_EVENTS' as any,
      retentionDays: 1095,
      archiveAfterDays: 180,
      deletionAllowed: false,
      requiresApproval: true,
      legalHold: false,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      retentionPolicyCode: 'RET-FIN-001',
      name: 'Financial Records Retention',
      dataCategory: 'FINANCIAL_RECORDS' as any,
      retentionDays: 2555,
      archiveAfterDays: 1095,
      deletionAllowed: false,
      requiresApproval: true,
      legalHold: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      retentionPolicyCode: 'RET-HR-001',
      name: 'HR Records Retention',
      dataCategory: 'HR_RECORDS' as any,
      retentionDays: 2190,
      archiveAfterDays: 730,
      deletionAllowed: false,
      requiresApproval: true,
      legalHold: false,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      retentionPolicyCode: 'RET-PAY-001',
      name: 'Payroll Records Retention',
      dataCategory: 'PAYROLL_RECORDS' as any,
      retentionDays: 2555,
      archiveAfterDays: 1095,
      deletionAllowed: false,
      requiresApproval: true,
      legalHold: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      retentionPolicyCode: 'RET-TAX-001',
      name: 'Tax Records Retention',
      dataCategory: 'TAX_RECORDS' as any,
      retentionDays: 3650,
      archiveAfterDays: 1095,
      deletionAllowed: false,
      requiresApproval: true,
      legalHold: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      retentionPolicyCode: 'RET-ERR-001',
      name: 'Error Log Retention',
      dataCategory: 'ERROR_LOGS' as any,
      retentionDays: 365,
      archiveAfterDays: 90,
      deletionAllowed: true,
      requiresApproval: false,
      legalHold: false,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
  ];

  for (const policy of retentionPolicies) {
    await prisma.retentionPolicy.upsert({
      where: { retentionPolicyCode: policy.retentionPolicyCode },
      update: {},
      create: policy,
    });
  }

  // ── Milestone 14 — Production Readiness Checks ───────────────────────────
  console.log('Seeding production readiness checks...');
  const readinessChecks = [
    {
      checkCode: 'PRC-SEC-001',
      category: 'SECURITY' as any,
      title: 'SSL/TLS Certificate Configured',
      priority: 'CRITICAL' as any,
      status: 'NOT_STARTED' as any,
      description:
        'Ensure HTTPS with a valid SSL/TLS certificate is configured for all public endpoints.',
    },
    {
      checkCode: 'PRC-SEC-002',
      category: 'SECURITY' as any,
      title: 'Strong Password Policy Active',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description:
        'Password policy requiring minimum 8 characters, uppercase, lowercase, and numbers.',
    },
    {
      checkCode: 'PRC-SEC-003',
      category: 'SECURITY' as any,
      title: 'Login Attempt Protection Active',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description: 'Account lockout after 5 failed login attempts for 15 minutes.',
    },
    {
      checkCode: 'PRC-SEC-004',
      category: 'SECURITY' as any,
      title: 'Rate Limiting Configured',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description: 'API rate limiting enabled with ThrottlerModule.',
    },
    {
      checkCode: 'PRC-SEC-005',
      category: 'SECURITY' as any,
      title: 'Helmet Security Headers',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description: 'HTTP security headers configured via NestJS Helmet middleware.',
    },
    {
      checkCode: 'PRC-BCK-001',
      category: 'BACKUP' as any,
      title: 'Daily Database Backup Configured',
      priority: 'CRITICAL' as any,
      status: 'IN_PROGRESS' as any,
      description: 'Automated daily database backup job configured and tested.',
    },
    {
      checkCode: 'PRC-BCK-002',
      category: 'BACKUP' as any,
      title: 'Backup Restore Tested',
      priority: 'CRITICAL' as any,
      status: 'NOT_STARTED' as any,
      description: 'Backup restore procedure tested and documented.',
    },
    {
      checkCode: 'PRC-BCK-003',
      category: 'BACKUP' as any,
      title: 'Offsite Backup Storage',
      priority: 'HIGH' as any,
      status: 'NOT_STARTED' as any,
      description: 'Backup copies stored at a secondary offsite location.',
    },
    {
      checkCode: 'PRC-DB-001',
      category: 'DATABASE' as any,
      title: 'Database Connection Pooling',
      priority: 'HIGH' as any,
      status: 'NOT_STARTED' as any,
      description: 'PostgreSQL connection pooling configured appropriately for production load.',
    },
    {
      checkCode: 'PRC-DB-002',
      category: 'DATABASE' as any,
      title: 'Database Indexes Optimized',
      priority: 'MEDIUM' as any,
      status: 'NOT_STARTED' as any,
      description: 'Database indexes reviewed and optimized for production query patterns.',
    },
    {
      checkCode: 'PRC-ENV-001',
      category: 'ENVIRONMENT' as any,
      title: 'Production Environment Variables Set',
      priority: 'CRITICAL' as any,
      status: 'NOT_STARTED' as any,
      description: 'All required environment variables configured for production environment.',
    },
    {
      checkCode: 'PRC-ENV-002',
      category: 'ENVIRONMENT' as any,
      title: 'NODE_ENV Set to Production',
      priority: 'HIGH' as any,
      status: 'NOT_STARTED' as any,
      description: 'NODE_ENV environment variable is set to "production".',
    },
    {
      checkCode: 'PRC-MON-001',
      category: 'MONITORING' as any,
      title: 'System Health Checks Configured',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description: 'System health check endpoints configured and active.',
    },
    {
      checkCode: 'PRC-MON-002',
      category: 'MONITORING' as any,
      title: 'Error Logging Active',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description: 'Error logging system active and capturing server errors.',
    },
    {
      checkCode: 'PRC-DEP-001',
      category: 'DEPLOYMENT' as any,
      title: 'Disaster Recovery Plan Documented',
      priority: 'HIGH' as any,
      status: 'PASSED' as any,
      description: 'Disaster recovery plan documented and approved.',
    },
  ];

  for (const check of readinessChecks) {
    await prisma.productionReadinessCheck.upsert({
      where: { checkCode: check.checkCode },
      update: {},
      create: check,
    });
  }

  // ── Milestone 14.5 — Document Number Sequences ───────────────────────────
  console.log('Seeding document number sequences...');
  const docSequences = [
    {
      sequenceCode: 'SEQ-PR-001',
      entityType: 'PurchaseRequisition',
      prefix: 'REQ-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-RFQ-001',
      entityType: 'RequestForQuotation',
      prefix: 'RFQ-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-GRN-001',
      entityType: 'GoodsReceivedNote',
      prefix: 'GRN-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-SINV-001',
      entityType: 'SupplierInvoice',
      prefix: 'SINV-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-SQOT-001',
      entityType: 'SupplierQuotation',
      prefix: 'SQOT-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-RECON-001',
      entityType: 'BankReconciliation',
      prefix: 'RECON-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-DEP-001',
      entityType: 'DepreciationSchedule',
      prefix: 'DEP-',
      padding: 5,
      isActive: true,
    },
    {
      sequenceCode: 'SEQ-LOAN-001',
      entityType: 'LoanRepaymentSchedule',
      prefix: 'LRS-',
      padding: 5,
      isActive: true,
    },
  ];

  for (const seq of docSequences) {
    await prisma.documentNumberSequence.upsert({
      where: { sequenceCode: seq.sequenceCode },
      update: {},
      create: seq,
    });
  }

  // ── Milestone 14.5 — Document Templates ──────────────────────────────────
  console.log('Seeding document templates...');
  const docTemplates = [
    {
      templateCode: 'TMPL-INV-001',
      name: 'Standard Sales Invoice',
      templateType: 'SALES_INVOICE' as any,
      format: 'HTML' as any,
      content: `<!DOCTYPE html><html><head><title>Invoice {{invoiceNumber}}</title></head><body>
<div class="header"><h1>INVOICE</h1><p>No: {{invoiceNumber}}</p><p>Date: {{invoiceDate}}</p></div>
<div class="company"><h2>{{companyName}}</h2><p>{{companyAddress}}</p></div>
<div class="customer"><h3>Bill To:</h3><p>{{customerName}}</p><p>{{customerAddress}}</p></div>
<table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
<tbody>{{lineItems}}</tbody></table>
<div class="totals"><p>Subtotal: {{subtotal}}</p><p>Tax: {{taxAmount}}</p><strong>Total: {{totalAmount}}</strong></div>
</body></html>`,
      variables: {
        invoiceNumber: '',
        invoiceDate: '',
        companyName: '',
        customerName: '',
        lineItems: '',
        subtotal: '',
        taxAmount: '',
        totalAmount: '',
      },
      isDefault: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      templateCode: 'TMPL-RCPT-001',
      name: 'Standard Receipt',
      templateType: 'RECEIPT' as any,
      format: 'HTML' as any,
      content: `<!DOCTYPE html><html><body>
<div style="text-align:center"><h2>RECEIPT</h2><p>No: {{receiptNumber}}</p><p>Date: {{receiptDate}}</p></div>
<p>Received from: {{customerName}}</p><p>Amount: {{amount}}</p><p>For: {{description}}</p>
<p>Payment Method: {{paymentMethod}}</p><hr/><p>Thank you!</p></body></html>`,
      variables: {
        receiptNumber: '',
        receiptDate: '',
        customerName: '',
        amount: '',
        description: '',
        paymentMethod: '',
      },
      isDefault: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      templateCode: 'TMPL-PO-001',
      name: 'Standard Purchase Order',
      templateType: 'PURCHASE_ORDER' as any,
      format: 'HTML' as any,
      content: `<!DOCTYPE html><html><body>
<h1>PURCHASE ORDER</h1><p>PO No: {{poNumber}}</p><p>Date: {{poDate}}</p>
<p>To: {{supplierName}}</p><p>{{supplierAddress}}</p>
<table><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
<tbody>{{lineItems}}</tbody></table>
<p><strong>Total: {{totalAmount}}</strong></p></body></html>`,
      variables: {
        poNumber: '',
        poDate: '',
        supplierName: '',
        supplierAddress: '',
        lineItems: '',
        totalAmount: '',
      },
      isDefault: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      templateCode: 'TMPL-PAYSLIP-001',
      name: 'Standard Payslip',
      templateType: 'PAYSLIP' as any,
      format: 'HTML' as any,
      content: `<!DOCTYPE html><html><body>
<h2>PAYSLIP</h2><p>Period: {{period}}</p><p>Employee: {{employeeName}}</p><p>ID: {{employeeId}}</p>
<table><tr><td>Basic Salary</td><td>{{basicSalary}}</td></tr>
<tr><td>Allowances</td><td>{{allowances}}</td></tr>
<tr><td>Deductions</td><td>{{deductions}}</td></tr>
<tr><td><strong>Net Pay</strong></td><td><strong>{{netPay}}</strong></td></tr></table></body></html>`,
      variables: {
        period: '',
        employeeName: '',
        employeeId: '',
        basicSalary: '',
        allowances: '',
        deductions: '',
        netPay: '',
      },
      isDefault: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
    {
      templateCode: 'TMPL-QUOTATION-001',
      name: 'Standard Quotation',
      templateType: 'QUOTATION' as any,
      format: 'HTML' as any,
      content: `<!DOCTYPE html><html><body>
<h1>QUOTATION</h1><p>Ref: {{quoteNumber}}</p><p>Date: {{quoteDate}}</p><p>Valid Until: {{validUntil}}</p>
<p>To: {{customerName}}</p>
<table><thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
<tbody>{{lineItems}}</tbody></table>
<p><strong>Total: {{totalAmount}}</strong></p></body></html>`,
      variables: {
        quoteNumber: '',
        quoteDate: '',
        validUntil: '',
        customerName: '',
        lineItems: '',
        totalAmount: '',
      },
      isDefault: true,
      status: 'ACTIVE' as any,
      createdById: admin.id,
    },
  ];

  for (const tmpl of docTemplates) {
    await prisma.documentTemplate.upsert({
      where: { templateCode: tmpl.templateCode },
      update: {},
      create: tmpl,
    });
  }

  // ── Milestone 14.5 — Automation Rules ────────────────────────────────────
  console.log('Seeding automation rules...');
  const automationRules = [
    {
      automationRuleCode: 'AUTO-DEP-001',
      name: 'Monthly Depreciation Posting',
      description:
        'Automatically create monthly depreciation entries for all active depreciation schedules.',
      automationType: 'DEPRECIATION_POSTING' as any,
      triggerType: 'SCHEDULE' as any,
      triggerConfig: { frequency: 'MONTHLY', dayOfMonth: 1, hour: 2, minute: 0 },
      actionConfig: { action: 'CREATE_DEPRECIATION_ENTRIES', autoPost: false },
      status: 'INACTIVE' as any,
      createdById: admin.id,
    },
    {
      automationRuleCode: 'AUTO-REORDER-001',
      name: 'Stock Reorder Suggestion',
      description: 'Automatically suggest stock reorders when inventory drops below reorder level.',
      automationType: 'STOCK_REORDER_SUGGESTION' as any,
      triggerType: 'THRESHOLD' as any,
      triggerConfig: { checkFrequency: 'DAILY', threshold: 'REORDER_LEVEL' },
      actionConfig: { action: 'CREATE_PURCHASE_REQUISITION', status: 'DRAFT' },
      status: 'INACTIVE' as any,
      createdById: admin.id,
    },
    {
      automationRuleCode: 'AUTO-LOAN-REM-001',
      name: 'Loan Repayment Reminder',
      description:
        'Send reminders for upcoming loan repayment installments 7 days before due date.',
      automationType: 'LOAN_REPAYMENT_REMINDER' as any,
      triggerType: 'SCHEDULE' as any,
      triggerConfig: { frequency: 'DAILY', daysBeforeDue: 7, hour: 8, minute: 0 },
      actionConfig: { action: 'SEND_NOTIFICATION', channels: ['EMAIL', 'SYSTEM'] },
      status: 'INACTIVE' as any,
      createdById: admin.id,
    },
    {
      automationRuleCode: 'AUTO-COMP-REM-001',
      name: 'Compliance Reminder',
      description:
        'Send reminders for upcoming regulatory compliance deadlines 14 days before due date.',
      automationType: 'COMPLIANCE_REMINDER' as any,
      triggerType: 'SCHEDULE' as any,
      triggerConfig: { frequency: 'DAILY', daysBeforeDue: 14, hour: 8, minute: 0 },
      actionConfig: { action: 'SEND_NOTIFICATION', channels: ['EMAIL', 'SYSTEM'] },
      status: 'INACTIVE' as any,
      createdById: admin.id,
    },
  ];

  for (const rule of automationRules) {
    await prisma.automationRule.upsert({
      where: { automationRuleCode: rule.automationRuleCode },
      update: {},
      create: rule,
    });
  }

  // ── Milestone 14.5 — Customer Segments ──────────────────────────────────
  console.log('Seeding customer segments...');
  const customerSegments = [
    {
      segmentCode: 'SEG-RETAIL-001',
      name: 'Retail Customers',
      description: 'Walk-in retail customers for all business units.',
      criteria: { type: 'RETAIL', minPurchases: 1 },
      isActive: true,
    },
    {
      segmentCode: 'SEG-WHOLESALE-001',
      name: 'Wholesale Customers',
      description: 'Wholesale buyers with bulk purchases.',
      criteria: { type: 'WHOLESALE', minOrderValue: 1000000 },
      isActive: true,
    },
    {
      segmentCode: 'SEG-CREDIT-001',
      name: 'Credit Customers',
      description: 'Customers with approved credit accounts.',
      criteria: { hasCreditLimit: true },
      isActive: true,
    },
    {
      segmentCode: 'SEG-VIP-001',
      name: 'VIP Customers',
      description: 'High-value, priority customers.',
      criteria: { minAnnualPurchases: 50000000 },
      isActive: true,
    },
  ];

  const firstCompany = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (firstCompany) {
    for (const seg of customerSegments) {
      await prisma.customerSegment.upsert({
        where: { segmentCode: seg.segmentCode },
        update: {},
        create: { ...seg, companyId: firstCompany.id },
      });
    }
  }

  // ============================================================
  // M15 - Performance, Scalability, Deployment Seed Data
  // ============================================================
  console.log('Seeding M15 data...');

  // 1. Job Queue Configs
  const jobQueueConfigs = [
    {
      queueName: 'reports',
      description: 'Report generation queue',
      concurrency: 2,
      retryAttempts: 3,
      retryBackoffSeconds: 60,
      timeoutSeconds: 300,
    },
    {
      queueName: 'notifications',
      description: 'Notification dispatch queue',
      concurrency: 5,
      retryAttempts: 3,
      retryBackoffSeconds: 30,
      timeoutSeconds: 60,
    },
    {
      queueName: 'exports',
      description: 'Data export queue',
      concurrency: 1,
      retryAttempts: 2,
      retryBackoffSeconds: 120,
      timeoutSeconds: 600,
    },
    {
      queueName: 'bi-snapshots',
      description: 'BI snapshot generation queue',
      concurrency: 1,
      retryAttempts: 3,
      retryBackoffSeconds: 300,
      timeoutSeconds: 1800,
    },
    {
      queueName: 'integrations',
      description: 'External integration retry queue',
      concurrency: 3,
      retryAttempts: 5,
      retryBackoffSeconds: 60,
      timeoutSeconds: 120,
    },
    {
      queueName: 'automation',
      description: 'Automation rule execution queue',
      concurrency: 2,
      retryAttempts: 3,
      retryBackoffSeconds: 60,
      timeoutSeconds: 300,
    },
    {
      queueName: 'emails',
      description: 'Email dispatch queue',
      concurrency: 5,
      retryAttempts: 3,
      retryBackoffSeconds: 30,
      timeoutSeconds: 60,
    },
    {
      queueName: 'sms',
      description: 'SMS dispatch queue',
      concurrency: 3,
      retryAttempts: 3,
      retryBackoffSeconds: 30,
      timeoutSeconds: 60,
    },
  ];

  for (const config of jobQueueConfigs) {
    await prisma.jobQueueConfig.upsert({
      where: { queueName: config.queueName },
      update: {},
      create: { ...config, isActive: true },
    });
  }
  console.log('Job queue configs seeded');

  // 2. Demo Deployment Releases (seeded only if no releases exist yet)
  const releaseCount = await prisma.deploymentRelease.count();
  if (releaseCount === 0) {
    await prisma.deploymentRelease.createMany({
      data: [
        {
          releaseNumber: 'REL-001',
          version: '1.0.0',
          environment: 'DEVELOPMENT',
          status: 'DEPLOYED',
          commitHash: 'abc123def456',
          imageTag: 'itemba-r:1.0.0',
          migrationStatus: 'COMPLETED',
          notes: 'Initial development release',
          deployedAt: new Date(),
        },
        {
          releaseNumber: 'REL-002',
          version: '1.1.0',
          environment: 'STAGING',
          status: 'PLANNED',
          migrationStatus: 'PENDING',
          notes: 'Milestone 15 staging release',
        },
      ],
    });
    console.log('Deployment releases seeded');
  }

  // ============================================================
  // M16 - QA, Launch Readiness, Documentation, Training, Support
  // ============================================================
  console.log('Seeding M16 data...');

  // Get first superadmin user for seeding
  const superAdmin = await prisma.user.findFirst({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local' },
  });
  const adminUserId = superAdmin?.id;

  if (adminUserId) {
    // 1. QA Test Suites
    const qaSuites = [
      {
        suiteCode: 'QTS-AUTH',
        name: 'Authentication and User Access QA',
        suiteType: 'MODULE',
        moduleName: 'auth',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-GROUP',
        name: 'Group Control QA',
        suiteType: 'MODULE',
        moduleName: 'group-control',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-FINANCE',
        name: 'Finance and Accounting QA',
        suiteType: 'ACCOUNTING',
        moduleName: 'finance',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-PROC',
        name: 'Procurement QA',
        suiteType: 'MODULE',
        moduleName: 'procurement',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-SALES',
        name: 'Sales and Inventory QA',
        suiteType: 'MODULE',
        moduleName: 'sales',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-PETROL',
        name: 'Mwanjalisi Petroleum QA',
        suiteType: 'MODULE',
        moduleName: 'petroleum',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-WEST',
        name: 'Westsides Trading QA',
        suiteType: 'MODULE',
        moduleName: 'westsides',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-ITEMBA',
        name: 'Itemba Enterprises QA',
        suiteType: 'MODULE',
        moduleName: 'itemba',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-RENT',
        name: 'Rentals and Parking QA',
        suiteType: 'MODULE',
        moduleName: 'rentals',
        priority: 'MEDIUM',
      },
      {
        suiteCode: 'QTS-HOSP',
        name: 'Hospitality QA',
        suiteType: 'MODULE',
        moduleName: 'hospitality',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-HR',
        name: 'HR and Payroll QA',
        suiteType: 'MODULE',
        moduleName: 'hr',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-TAX',
        name: 'Compliance and Tax QA',
        suiteType: 'MODULE',
        moduleName: 'compliance',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-APPR',
        name: 'Approvals and Controls QA',
        suiteType: 'MODULE',
        moduleName: 'approvals',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-BI',
        name: 'BI and Reports QA',
        suiteType: 'MODULE',
        moduleName: 'bi',
        priority: 'MEDIUM',
      },
      {
        suiteCode: 'QTS-INTG',
        name: 'Integrations and Offline QA',
        suiteType: 'INTEGRATION',
        moduleName: 'integrations',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-SEC',
        name: 'Security and Production QA',
        suiteType: 'SECURITY',
        moduleName: 'security',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-UI',
        name: 'Aurora UI/UX QA',
        suiteType: 'UI_UX',
        moduleName: 'aurora',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-E2E-BIZ',
        name: 'End-to-End Business Flow QA',
        suiteType: 'END_TO_END',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-E2E-PETROL',
        name: 'End-to-End Petroleum Flow QA',
        suiteType: 'END_TO_END',
        moduleName: 'petroleum',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-E2E-HOSP',
        name: 'End-to-End Hospitality Flow QA',
        suiteType: 'END_TO_END',
        moduleName: 'hospitality',
        priority: 'HIGH',
      },
      {
        suiteCode: 'QTS-E2E-PROC',
        name: 'End-to-End Procurement-to-Payment QA',
        suiteType: 'END_TO_END',
        moduleName: 'procurement',
        priority: 'CRITICAL',
      },
      {
        suiteCode: 'QTS-E2E-PAY',
        name: 'End-to-End Payroll Flow QA',
        suiteType: 'END_TO_END',
        moduleName: 'hr',
        priority: 'CRITICAL',
      },
    ];

    for (const suite of qaSuites) {
      await prisma.qATestSuite.upsert({
        where: { suiteCode: suite.suiteCode },
        update: {},
        create: {
          ...suite,
          status: 'ACTIVE',
          createdById: adminUserId,
        } as any,
      });
    }
    console.log(`QA test suites seeded: ${qaSuites.length}`);

    // 2. Sample test cases for Auth suite
    const authSuite = await prisma.qATestSuite.findUnique({ where: { suiteCode: 'QTS-AUTH' } });
    if (authSuite) {
      const authTestCases = [
        {
          testCaseCode: 'QTC-AUTH-001',
          title: 'Successful Login with Valid Credentials',
          steps: [
            { step: 1, action: 'Navigate to /login' },
            { step: 2, action: 'Enter valid email and password' },
            { step: 3, action: 'Click Login button' },
          ],
          expectedResult: 'User is redirected to dashboard, JWT token issued',
          priority: 'CRITICAL',
          testType: 'MANUAL',
          moduleName: 'auth',
        },
        {
          testCaseCode: 'QTC-AUTH-002',
          title: 'Login Fails with Wrong Password',
          steps: [
            { step: 1, action: 'Navigate to /login' },
            { step: 2, action: 'Enter valid email with wrong password' },
            { step: 3, action: 'Click Login button' },
          ],
          expectedResult:
            'Error message shown, no token issued, failed login event recorded in SecurityEvent',
          priority: 'CRITICAL',
          testType: 'MANUAL',
          moduleName: 'auth',
        },
        {
          testCaseCode: 'QTC-AUTH-003',
          title: 'Role Permission Enforcement',
          steps: [
            { step: 1, action: 'Login as a user without admin permissions' },
            { step: 2, action: 'Attempt to access /users page' },
          ],
          expectedResult: 'Access denied (403), page shows permission error',
          priority: 'CRITICAL',
          testType: 'MANUAL',
          moduleName: 'auth',
        },
        {
          testCaseCode: 'QTC-AUTH-004',
          title: 'Company Data Isolation',
          steps: [
            { step: 1, action: 'Login as Company A user' },
            { step: 2, action: 'Attempt to access Company B records via API' },
          ],
          expectedResult: 'Company B records are not returned, 403 or empty response',
          priority: 'CRITICAL',
          testType: 'MANUAL',
          moduleName: 'auth',
        },
        {
          testCaseCode: 'QTC-AUTH-005',
          title: 'Session Revocation',
          steps: [
            { step: 1, action: 'Login and get JWT token' },
            { step: 2, action: 'Admin revokes the session' },
            { step: 3, action: 'Use the old JWT to access a protected endpoint' },
          ],
          expectedResult: 'Request is rejected with 401, old token is invalid',
          priority: 'HIGH',
          testType: 'MANUAL',
          moduleName: 'auth',
        },
      ];

      for (const tc of authTestCases) {
        await prisma.qATestCase.upsert({
          where: { testCaseCode: tc.testCaseCode },
          update: {},
          create: {
            ...tc,
            testSuiteId: authSuite.id,
            status: 'ACTIVE',
            steps: tc.steps as any,
          },
        });
      }
      console.log('Auth QA test cases seeded');
    }

    // 3. User Manuals
    const manuals = [
      {
        manualCode: 'UM-GETTING-STARTED',
        title: 'Getting Started with ITEMBA-R',
        manualType: 'QUICK_START',
        version: '1.0',
        moduleName: null,
      },
      {
        manualCode: 'UM-GROUP-CONTROL',
        title: 'Group Control User Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'group-control',
      },
      {
        manualCode: 'UM-FINANCE',
        title: 'Finance and Accounting Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'finance',
      },
      {
        manualCode: 'UM-PROCUREMENT',
        title: 'Procurement Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'procurement',
      },
      {
        manualCode: 'UM-SALES',
        title: 'Sales and Inventory Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'sales',
      },
      {
        manualCode: 'UM-PETROLEUM',
        title: 'Mwanjalisi Petroleum Operations Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'petroleum',
      },
      {
        manualCode: 'UM-WESTSIDES',
        title: 'Westsides Trading Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'westsides',
      },
      {
        manualCode: 'UM-ITEMBA',
        title: 'Itemba Enterprises Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'itemba',
      },
      {
        manualCode: 'UM-RENTALS',
        title: 'Rentals and Parking Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'rentals',
      },
      {
        manualCode: 'UM-HOSPITALITY',
        title: 'Hospitality / Uzunguni Inn Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'hospitality',
      },
      {
        manualCode: 'UM-HR',
        title: 'HR and Payroll Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'hr',
      },
      {
        manualCode: 'UM-COMPLIANCE',
        title: 'Compliance and Tax Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'compliance',
      },
      {
        manualCode: 'UM-APPROVALS',
        title: 'Approvals and Controls Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'approvals',
      },
      {
        manualCode: 'UM-BI',
        title: 'BI and Reporting Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'bi',
      },
      {
        manualCode: 'UM-INTEGRATIONS',
        title: 'Integrations and API Guide',
        manualType: 'USER_GUIDE',
        version: '1.0',
        moduleName: 'integrations',
      },
      {
        manualCode: 'UM-SECURITY-ADMIN',
        title: 'Security and Admin Guide',
        manualType: 'ADMIN_GUIDE',
        version: '1.0',
        moduleName: 'security',
      },
    ];

    for (const manual of manuals) {
      await prisma.userManual.upsert({
        where: { manualCode: manual.manualCode },
        update: {},
        create: {
          ...manual,
          content: `# ${manual.title}\n\nThis guide covers the ${manual.title.replace(' Guide', '').replace(' User Guide', '')} module of ITEMBA-R.\n\n## Overview\n\nThis manual is a draft and will be updated before go-live.\n\n## Getting Help\n\nContact support at support@itemba-r.com or submit a support ticket through the system.`,
          status: 'PUBLISHED',
          createdById: adminUserId,
          publishedById: adminUserId,
          publishedAt: new Date(),
        } as any,
      });
    }
    console.log(`User manuals seeded: ${manuals.length}`);

    // 4. Help Articles
    const helpArticles = [
      {
        articleCode: 'HA-LOGIN',
        title: 'How to log in to ITEMBA-R',
        category: 'GETTING_STARTED',
        content:
          '## How to Log In\n\n1. Navigate to the ITEMBA-R login page.\n2. Enter your email address and password.\n3. Click **Login**.\n4. You will be redirected to your dashboard.\n\n**Trouble logging in?** Contact your system administrator or submit a support ticket.',
      },
      {
        articleCode: 'HA-CHANGE-PWD',
        title: 'How to change your password',
        category: 'GETTING_STARTED',
        content:
          '## Changing Your Password\n\n1. Click your profile icon in the top-right corner.\n2. Select **Profile Settings**.\n3. Click **Change Password**.\n4. Enter your current password and new password.\n5. Click **Save**.',
      },
      {
        articleCode: 'HA-SWITCH-COMPANY',
        title: 'How to switch company context',
        category: 'GETTING_STARTED',
        content:
          '## Switching Company\n\nIf you have access to multiple companies, you can switch context from the top navigation bar.\n\n1. Click the company selector in the topbar.\n2. Select the company you want to work in.\n3. The dashboard and data will reload for that company.',
      },
      {
        articleCode: 'HA-CREATE-CUSTOMER',
        title: 'How to create a customer',
        category: 'SALES',
        content:
          '## Creating a Customer\n\n1. Navigate to **Operations → Customers**.\n2. Click **New Customer**.\n3. Fill in customer name, phone, email, and address.\n4. Set the customer type and company.\n5. Click **Save**.',
      },
      {
        articleCode: 'HA-RECORD-SALE',
        title: 'How to record a sale',
        category: 'SALES',
        content:
          '## Recording a Sale\n\n1. Navigate to **Operations → Sales Orders**.\n2. Click **New Sales Order**.\n3. Select the customer.\n4. Add products and quantities.\n5. Set the order date and status.\n6. Click **Save** or **Confirm Order**.',
      },
      {
        articleCode: 'HA-RECORD-EXPENSE',
        title: 'How to record an expense',
        category: 'FINANCE',
        content:
          '## Recording an Expense\n\n1. Navigate to **Finance → Expenses**.\n2. Click **New Expense**.\n3. Select the expense category.\n4. Enter the amount, date, and description.\n5. Select the cash account.\n6. Submit for approval or save as draft.',
      },
      {
        articleCode: 'HA-APPROVE-REQUEST',
        title: 'How to approve a request',
        category: 'APPROVALS',
        content:
          '## Approving a Request\n\n1. Navigate to **Approvals → Pending Approvals**.\n2. Click on the request to review.\n3. Review the details and attachments.\n4. Click **Approve** or **Reject**.\n5. Add a comment if needed.',
      },
      {
        articleCode: 'HA-VIEW-NOTIFICATIONS',
        title: 'How to view notifications',
        category: 'GETTING_STARTED',
        content:
          '## Viewing Notifications\n\n1. Click the bell icon in the topbar.\n2. Notifications panel opens on the right.\n3. Click a notification to go to the related record.\n4. Click **Mark All Read** to clear the badge.',
      },
      {
        articleCode: 'HA-GENERATE-REPORTS',
        title: 'How to generate reports',
        category: 'BI',
        content:
          '## Generating Reports\n\n1. Navigate to **Reports** or **BI Dashboard**.\n2. Select the report type.\n3. Set filters (date range, company, module).\n4. Click **Run Report**.\n5. Download as CSV or PDF if needed.',
      },
      {
        articleCode: 'HA-CONTACT-SUPPORT',
        title: 'How to contact support',
        category: 'FAQ',
        content:
          '## Contacting Support\n\n1. Navigate to **Support → My Tickets**.\n2. Click **New Ticket**.\n3. Describe your issue or question.\n4. Set the priority.\n5. Submit the ticket.\n\nOur support team will respond within 24 hours.',
      },
    ];

    for (const article of helpArticles) {
      await prisma.helpArticle.upsert({
        where: { articleCode: article.articleCode },
        update: {},
        create: {
          ...article,
          status: 'PUBLISHED',
          createdById: adminUserId,
          publishedById: adminUserId,
          publishedAt: new Date(),
          tags: [article.category.toLowerCase()],
        } as any,
      });
    }
    console.log(`Help articles seeded: ${helpArticles.length}`);

    // 5. Training Courses
    const trainingCourses = [
      {
        courseCode: 'TC-DIRECTOR',
        title: 'Group Director Training',
        roleName: 'GROUP_DIRECTOR',
        difficulty: 'INTERMEDIATE',
        estimatedMinutes: 120,
      },
      {
        courseCode: 'TC-FINANCE-CTRL',
        title: 'Finance Controller Training',
        roleName: 'GROUP_FINANCE_CONTROLLER',
        difficulty: 'ADVANCED',
        estimatedMinutes: 180,
      },
      {
        courseCode: 'TC-ACCOUNTANT',
        title: 'Accountant Training',
        roleName: 'ACCOUNTANT',
        difficulty: 'INTERMEDIATE',
        estimatedMinutes: 150,
      },
      {
        courseCode: 'TC-MWANJALISI-OPS',
        title: 'Mwanjalisi Operations Training',
        roleName: 'COMPANY_MANAGER',
        moduleName: 'petroleum',
        difficulty: 'INTERMEDIATE',
        estimatedMinutes: 120,
      },
      {
        courseCode: 'TC-WESTSIDES-OPS',
        title: 'Westsides Operations Training',
        roleName: 'COMPANY_MANAGER',
        moduleName: 'westsides',
        difficulty: 'BEGINNER',
        estimatedMinutes: 90,
      },
      {
        courseCode: 'TC-ITEMBA-OPS',
        title: 'Itemba Enterprises Operations Training',
        roleName: 'COMPANY_MANAGER',
        moduleName: 'itemba',
        difficulty: 'INTERMEDIATE',
        estimatedMinutes: 150,
      },
      {
        courseCode: 'TC-HR-MANAGER',
        title: 'HR Manager Training',
        roleName: 'HR_MANAGER',
        moduleName: 'hr',
        difficulty: 'INTERMEDIATE',
        estimatedMinutes: 120,
      },
      {
        courseCode: 'TC-COMPLIANCE',
        title: 'Compliance Officer Training',
        roleName: 'COMPLIANCE_OFFICER',
        moduleName: 'compliance',
        difficulty: 'ADVANCED',
        estimatedMinutes: 120,
      },
      {
        courseCode: 'TC-IT-ADMIN',
        title: 'IT/Admin Training',
        roleName: 'SYSTEM_ADMIN',
        difficulty: 'ADVANCED',
        estimatedMinutes: 240,
      },
      {
        courseCode: 'TC-GENERAL',
        title: 'General User Training',
        roleName: null,
        difficulty: 'BEGINNER',
        estimatedMinutes: 60,
      },
    ];

    for (const course of trainingCourses) {
      await prisma.trainingCourse.upsert({
        where: { courseCode: course.courseCode },
        update: {},
        create: {
          ...course,
          status: 'ACTIVE',
          createdById: adminUserId,
        } as any,
      });
    }
    console.log(`Training courses seeded: ${trainingCourses.length}`);

    // 6. Guided Walkthroughs
    const walkthroughs = [
      {
        walkthroughCode: 'GW-DASHBOARD',
        title: 'Dashboard Overview',
        routePath: '/',
        moduleName: 'dashboard',
        steps: [
          {
            step: 1,
            title: 'Welcome',
            content: 'This is your ITEMBA-R dashboard. It shows a summary of your company data.',
          },
          {
            step: 2,
            title: 'Navigation',
            content: 'Use the left sidebar to navigate between modules.',
          },
          {
            step: 3,
            title: 'Stats Cards',
            content: 'The stats cards show key metrics for your company.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-CREATE-CUSTOMER',
        title: 'Create a Customer',
        routePath: '/operations/customers',
        moduleName: 'operations',
        steps: [
          {
            step: 1,
            title: 'Open Customers',
            content: 'You are on the Customers page. Here you manage all customers.',
          },
          {
            step: 2,
            title: 'New Customer',
            content: 'Click the New Customer button to create your first customer.',
          },
          {
            step: 3,
            title: 'Fill Form',
            content: 'Fill in the customer name, phone, and other details.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-RECORD-EXPENSE',
        title: 'Record an Expense',
        routePath: '/finance/expenses',
        moduleName: 'finance',
        steps: [
          {
            step: 1,
            title: 'Expenses Page',
            content: 'This is the Expenses page. All company expenses are recorded here.',
          },
          { step: 2, title: 'New Expense', content: 'Click New Expense to record a new expense.' },
          {
            step: 3,
            title: 'Select Category',
            content: 'Choose the expense category that matches your expense.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-SUBMIT-APPROVAL',
        title: 'Submit an Approval Request',
        routePath: '/approvals',
        moduleName: 'approvals',
        steps: [
          {
            step: 1,
            title: 'Approvals',
            content: 'This is the Approvals module. All approval requests flow through here.',
          },
          {
            step: 2,
            title: 'New Request',
            content:
              'Some actions automatically create approval requests. You can also submit manual requests.',
          },
          {
            step: 3,
            title: 'Track Status',
            content: 'Track the status of your requests in the My Requests tab.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-VIEW-REPORT',
        title: 'View a Report',
        routePath: '/bi',
        moduleName: 'bi',
        steps: [
          { step: 1, title: 'Reports', content: 'This is the BI and Reports section.' },
          { step: 2, title: 'Choose Report', content: 'Select a report type from the list.' },
          {
            step: 3,
            title: 'Run Report',
            content: 'Set your filters and click Run to generate the report.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-PETROL-SHIFT',
        title: 'Petroleum Shift Flow',
        routePath: '/petroleum/fuel-shifts',
        moduleName: 'petroleum',
        steps: [
          {
            step: 1,
            title: 'Fuel Shifts',
            content: 'Fuel shifts track daily operations at the fuel station.',
          },
          {
            step: 2,
            title: 'Start Shift',
            content: 'Click Start Shift to open a new shift. Record the opening nozzle readings.',
          },
          {
            step: 3,
            title: 'Close Shift',
            content:
              'At end of day, record closing readings and collections, then close the shift.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-HOSPITALITY-BOOKING',
        title: 'Hospitality Booking Flow',
        routePath: '/hospitality',
        moduleName: 'hospitality',
        steps: [
          {
            step: 1,
            title: 'Hospitality',
            content: 'The Hospitality module manages Uzunguni Inn operations.',
          },
          {
            step: 2,
            title: 'Room Bookings',
            content: 'Go to Room Bookings to create a new booking.',
          },
          {
            step: 3,
            title: 'Check In',
            content: 'When guest arrives, use Check In to confirm arrival.',
          },
        ],
      },
      {
        walkthroughCode: 'GW-PAYROLL-FLOW',
        title: 'Payroll Approval Flow',
        routePath: '/hr/payroll',
        moduleName: 'hr',
        steps: [
          {
            step: 1,
            title: 'Payroll',
            content: 'The Payroll module handles employee salary processing.',
          },
          { step: 2, title: 'Run Payroll', content: 'Create a new payroll run for the period.' },
          {
            step: 3,
            title: 'Approve',
            content: 'Submit the payroll run for approval before processing salary payments.',
          },
        ],
      },
    ];

    for (const wt of walkthroughs) {
      await prisma.guidedWalkthrough.upsert({
        where: { walkthroughCode: wt.walkthroughCode },
        update: {},
        create: {
          ...wt,
          steps: wt.steps as any,
          status: 'ACTIVE',
          createdById: adminUserId,
        } as any,
      });
    }
    console.log(`Guided walkthroughs seeded: ${walkthroughs.length}`);

    // 7. Training Environment Config
    const trainingEnvCount = await prisma.trainingEnvironmentConfig.count();
    if (trainingEnvCount === 0) {
      await prisma.trainingEnvironmentConfig.create({
        data: {
          configCode: 'TE-STANDARD',
          name: 'Standard Training Environment',
          description: 'Demo/training environment for staff onboarding and system familiarization',
          environment: 'TRAINING',
          seedProfile: 'STANDARD',
          resetFrequency: 'WEEKLY',
          status: 'ACTIVE',
          createdById: adminUserId,
        } as any,
      });
      console.log('Training environment config seeded');
    }

    // 8. Demo Support Ticket
    const ticketCount = await prisma.supportTicket.count();
    if (ticketCount === 0) {
      await prisma.supportTicket.create({
        data: {
          ticketNumber: 'ST-DEMO-001',
          title: 'Demo Support Ticket - System Training',
          description:
            'This is a demo support ticket created during system seeding. Users can create tickets to report bugs, ask questions, or request access.',
          ticketType: 'QUESTION',
          priority: 'LOW',
          status: 'CLOSED',
          reportedById: adminUserId,
          resolvedById: adminUserId,
          resolvedAt: new Date(),
          closedAt: new Date(),
          resolution: 'This is a demo ticket for training purposes.',
        } as any,
      });
      console.log('Demo support ticket seeded');
    }

    // 9. Launch Readiness Assessment (initial)
    const assessmentCount = await prisma.launchReadinessAssessment.count();
    if (assessmentCount === 0) {
      const assessment = await prisma.launchReadinessAssessment.create({
        data: {
          assessmentNumber: 'LRA-001',
          environment: 'STAGING',
          assessmentDate: new Date(),
          status: 'IN_PROGRESS',
          assessedById: adminUserId,
        } as any,
      });

      // Add readiness items
      const readinessItems = [
        { category: 'SECURITY', title: 'Security review completed', status: 'NOT_STARTED' },
        {
          category: 'ACCOUNTING',
          title: 'Accounting verification completed',
          status: 'NOT_STARTED',
        },
        { category: 'BACKUP', title: 'Backup system verified', status: 'NOT_STARTED' },
        { category: 'BACKUP', title: 'Restore test completed', status: 'NOT_STARTED' },
        {
          category: 'DEPLOYMENT',
          title: 'Production environment configured',
          status: 'NOT_STARTED',
        },
        { category: 'DATA_QUALITY', title: 'Critical QA suites passed', status: 'NOT_STARTED' },
        {
          category: 'USER_ACCESS',
          title: 'User roles and permissions verified',
          status: 'NOT_STARTED',
        },
        { category: 'DATA_QUALITY', title: 'Data isolation verified', status: 'NOT_STARTED' },
        { category: 'UI_UX', title: 'Aurora UI polish reviewed', status: 'NOT_STARTED' },
        { category: 'DOCUMENTATION', title: 'Help Center published', status: 'PASSED' },
        {
          category: 'TRAINING',
          title: 'Training plan published and courses active',
          status: 'PASSED',
        },
        { category: 'SUPPORT', title: 'Support process ready', status: 'PASSED' },
        { category: 'DEPLOYMENT', title: 'Go-live approval completed', status: 'NOT_STARTED' },
      ];

      for (const item of readinessItems) {
        await prisma.launchReadinessItem.create({
          data: {
            assessmentId: assessment.id,
            ...item,
            notes:
              item.status === 'PASSED'
                ? 'Seeded as initially completed during system setup.'
                : null,
            completedById: item.status === 'PASSED' ? adminUserId : null,
            completedAt: item.status === 'PASSED' ? new Date() : null,
          } as any,
        });
      }
      console.log('Launch readiness assessment and items seeded');
    }
  } else {
    console.log('No super admin user found for M16 seed — skipping relational seed data');
  }

  // ── Tanzania reference data (Phase 0 of HR & Payroll refinement) ────────
  {
    const tzAdmin = await prisma.user.findFirst({
      where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local' },
    });
    if (tzAdmin) {
      await seedTzReferenceData(prisma, tzAdmin.id);
    } else {
      console.log('  ⚠ TZ reference data skipped — admin user not found.');
    }
  }

  console.log(`\n✅  Seed complete.\n`);
  console.log(`   Group:     Itemba Group`);
  console.log(`   Companies: ${COMPANIES.length} (with legal profiles)`);
  const divCount = COMPANIES.reduce((n, c) => n + c.divisions.length, 0);
  console.log(`   Divisions: ${divCount}`);
  console.log(`   Roles:     ${ROLES.length}`);
  console.log(`   Perms:     ${ALL_PERMISSIONS.length}`);
  console.log(`   Admin:     ${adminEmail}`);
}

main()
  .catch((e) => {
    console.error('❌  Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// ─── Finance seed helpers (Milestone 3) ──────────────────────────────────────

interface AccountSeed {
  code: string;
  name: string;
  type: AccountType;
  subType?: string;
}

const DEFAULT_COA: AccountSeed[] = [
  // Assets
  { code: '1000', name: 'Cash on Hand', type: AccountType.ASSET, subType: 'Current Asset' },
  { code: '1010', name: 'Bank', type: AccountType.ASSET, subType: 'Current Asset' },
  { code: '1100', name: 'Accounts Receivable', type: AccountType.ASSET, subType: 'Current Asset' },
  {
    code: '1110',
    name: 'Employee Receivable (Salary Advances)',
    type: AccountType.ASSET,
    subType: 'Current Asset',
  },
  { code: '1200', name: 'Inventory', type: AccountType.ASSET, subType: 'Current Asset' },
  { code: '1500', name: 'Fixed Assets', type: AccountType.ASSET, subType: 'Non-Current Asset' },
  {
    code: '1599',
    name: 'Accumulated Depreciation',
    type: AccountType.ASSET,
    subType: 'accumulated_depreciation',
  },
  // Liabilities
  {
    code: '2000',
    name: 'Accounts Payable',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  {
    code: '2100',
    name: 'Loans Payable',
    type: AccountType.LIABILITY,
    subType: 'Long-Term Liability',
  },
  {
    code: '2200',
    name: 'Taxes Payable',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  // ── Tanzania payroll statutory payables ──────────────────────────────────
  // Each cleared monthly to TRA / NSSF / PSSSF / WCF / NHIF / HESLB.
  {
    code: '2210',
    name: 'PAYE Payable (TRA)',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  { code: '2220', name: 'NSSF Payable', type: AccountType.LIABILITY, subType: 'Current Liability' },
  {
    code: '2225',
    name: 'PSSSF Payable',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  { code: '2230', name: 'WCF Payable', type: AccountType.LIABILITY, subType: 'Current Liability' },
  {
    code: '2240',
    name: 'SDL Payable (TRA)',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  { code: '2250', name: 'NHIF Payable', type: AccountType.LIABILITY, subType: 'Current Liability' },
  {
    code: '2260',
    name: 'HESLB Payable',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  {
    code: '2270',
    name: 'Salaries Payable (Net)',
    type: AccountType.LIABILITY,
    subType: 'Current Liability',
  },
  // Equity
  { code: '3000', name: 'Owner Capital', type: AccountType.EQUITY },
  { code: '3100', name: 'Retained Earnings', type: AccountType.EQUITY },
  { code: '3900', name: 'Income Summary', type: AccountType.EQUITY, subType: 'income_summary' },
  // Income
  { code: '4000', name: 'Sales Revenue', type: AccountType.INCOME },
  { code: '4100', name: 'Service Revenue', type: AccountType.INCOME },
  { code: '4200', name: 'Crop Production Income', type: AccountType.INCOME },
  { code: '4900', name: 'Other Income', type: AccountType.INCOME },
  // Expenses
  { code: '6000', name: 'Salaries Expense', type: AccountType.EXPENSE },
  {
    code: '5500',
    name: 'Depreciation Expense',
    type: AccountType.EXPENSE,
    subType: 'depreciation_expense',
  },
  // ── Tanzania employer-side payroll expenses (employer contributions) ────
  { code: '6040', name: 'NSSF Employer Contribution', type: AccountType.EXPENSE },
  { code: '6045', name: 'PSSSF Employer Contribution', type: AccountType.EXPENSE },
  { code: '6050', name: 'WCF Expense', type: AccountType.EXPENSE },
  { code: '6060', name: 'SDL Expense', type: AccountType.EXPENSE },
  { code: '6070', name: 'NHIF Employer Contribution', type: AccountType.EXPENSE },
  { code: '6100', name: 'Transport Expense', type: AccountType.EXPENSE },
  { code: '6200', name: 'Fuel Expense', type: AccountType.EXPENSE },
  { code: '6300', name: 'Rent Expense', type: AccountType.EXPENSE },
  { code: '6400', name: 'Maintenance Expense', type: AccountType.EXPENSE },
  { code: '6500', name: 'Utilities Expense', type: AccountType.EXPENSE },
  { code: '6900', name: 'General Expense', type: AccountType.EXPENSE },
  // COGS
  { code: '5000', name: 'Cost of Goods Sold', type: AccountType.COST_OF_GOODS_SOLD },
  {
    code: '5100',
    name: 'Direct Project Labour Cost',
    type: AccountType.COST_OF_GOODS_SOLD,
    subType: 'Direct Cost',
  },
  {
    code: '5200',
    name: 'Direct Project Materials Cost',
    type: AccountType.COST_OF_GOODS_SOLD,
    subType: 'Direct Cost',
  },
  {
    code: '5300',
    name: 'Direct Project Subcontractor Cost',
    type: AccountType.COST_OF_GOODS_SOLD,
    subType: 'Direct Cost',
  },
];

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Salaries & Wages', linkedAccountCode: '6000' },
  { name: 'Transport', linkedAccountCode: '6100' },
  { name: 'Fuel', linkedAccountCode: '6200' },
  { name: 'Rent', linkedAccountCode: '6300' },
  { name: 'Maintenance & Repairs', linkedAccountCode: '6400' },
  { name: 'Utilities', linkedAccountCode: '6500' },
  { name: 'General & Administrative', linkedAccountCode: '6900' },
];

async function seedFinance() {
  const companies = await prisma.company.findMany({ where: { deletedAt: null } });
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1);
  const yearEnd = new Date(currentYear, 11, 31);

  for (const company of companies) {
    // Chart of Accounts
    const accountIdByCode = new Map<string, string>();
    for (const a of DEFAULT_COA) {
      const acc = await prisma.chartOfAccount.upsert({
        where: { companyId_accountCode: { companyId: company.id, accountCode: a.code } },
        update: { accountName: a.name, accountType: a.type, accountSubType: a.subType },
        create: {
          companyId: company.id,
          accountCode: a.code,
          accountName: a.name,
          accountType: a.type,
          accountSubType: a.subType,
          isSystemAccount: true,
        },
      });
      accountIdByCode.set(a.code, acc.id);
    }

    // Fiscal Year
    const fiscalYearName = `FY ${currentYear}`;
    const fy = await prisma.fiscalYear.upsert({
      where: { companyId_name: { companyId: company.id, name: fiscalYearName } },
      update: {},
      create: {
        companyId: company.id,
        name: fiscalYearName,
        startDate: yearStart,
        endDate: yearEnd,
        status: FiscalPeriodStatus.OPEN,
      },
    });

    // 12 monthly periods
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    for (let m = 0; m < 12; m++) {
      const start = new Date(currentYear, m, 1);
      const end = new Date(currentYear, m + 1, 0);
      const name = `${monthNames[m]} ${currentYear}`;
      await prisma.accountingPeriod.upsert({
        where: { fiscalYearId_name: { fiscalYearId: fy.id, name } },
        update: {},
        create: {
          companyId: company.id,
          fiscalYearId: fy.id,
          name,
          startDate: start,
          endDate: end,
          status: FiscalPeriodStatus.OPEN,
        },
      });
    }

    // Sample Cash Account (one CASH_ON_HAND per company) — use deterministic name for idempotency
    const cashName = 'Main Cash on Hand';
    const existingCash = await prisma.cashAccount.findFirst({
      where: { companyId: company.id, accountName: cashName },
    });
    if (!existingCash) {
      await prisma.cashAccount.create({
        data: {
          companyId: company.id,
          accountName: cashName,
          accountType: CashAccountType.CASH_ON_HAND,
          currency: CurrencyCode.TZS,
          openingBalance: 0,
          currentBalance: 0,
        },
      });
    }

    // Sample Expense Categories
    for (const c of DEFAULT_EXPENSE_CATEGORIES) {
      await prisma.expenseCategory.upsert({
        where: { companyId_name: { companyId: company.id, name: c.name } },
        update: { linkedAccountId: accountIdByCode.get(c.linkedAccountCode) ?? null },
        create: {
          companyId: company.id,
          name: c.name,
          linkedAccountId: accountIdByCode.get(c.linkedAccountCode) ?? null,
        },
      });
    }
  }
  console.log(`      Finance seeded for ${companies.length} companies`);
}

// ─── Operations seed helpers (Milestone 4) ───────────────────────────────────

const SYSTEM_UNITS = [
  { name: 'Piece', symbol: 'pcs', unitType: 'PIECE' as const },
  { name: 'Litre', symbol: 'L', unitType: 'VOLUME' as const },
  { name: 'Bottle', symbol: 'btl', unitType: 'PIECE' as const },
  { name: 'Crate', symbol: 'crt', unitType: 'PACKAGE' as const },
  { name: 'Carton', symbol: 'ctn', unitType: 'PACKAGE' as const },
  { name: 'Pack', symbol: 'pk', unitType: 'PACKAGE' as const },
  { name: 'Bag', symbol: 'bag', unitType: 'PACKAGE' as const },
  { name: 'Kilogram', symbol: 'kg', unitType: 'WEIGHT' as const },
  { name: 'Ton', symbol: 't', unitType: 'WEIGHT' as const },
  { name: 'Meter', symbol: 'm', unitType: 'LENGTH' as const },
  { name: 'Square Meter', symbol: 'm2', unitType: 'AREA' as const },
  { name: 'Acre', symbol: 'ac', unitType: 'AREA' as const },
  { name: 'Hour', symbol: 'hr', unitType: 'TIME' as const },
  { name: 'Day', symbol: 'day', unitType: 'TIME' as const },
  { name: 'Trip', symbol: 'trip', unitType: 'SERVICE' as const },
  { name: 'Service', symbol: 'svc', unitType: 'SERVICE' as const },
];

interface ProductCatDef {
  name: string;
  categoryType: ProductCategoryType;
}

const COMPANY_CATEGORIES: Record<string, ProductCatDef[]> = {
  MWANJALISI: [
    { name: 'Fuel', categoryType: ProductCategoryType.FUEL },
    { name: 'Lubricants', categoryType: ProductCategoryType.LUBRICANT },
    { name: 'Station Accessories', categoryType: ProductCategoryType.TRADING_GOODS },
  ],
  ITEMBA: [
    { name: 'Logistics Services', categoryType: ProductCategoryType.SERVICE },
    { name: 'Vehicle Spare Parts', categoryType: ProductCategoryType.SPARE_PART },
    { name: 'Agriculture Inputs', categoryType: ProductCategoryType.AGRICULTURE_INPUT },
    { name: 'Agriculture Produce', categoryType: ProductCategoryType.AGRICULTURE_PRODUCE },
    { name: 'Construction Materials', categoryType: ProductCategoryType.CONSTRUCTION_MATERIAL },
    { name: 'Tools and Equipment', categoryType: ProductCategoryType.SPARE_PART },
  ],
  WESTSIDES: [
    { name: 'Alcoholic Beverages', categoryType: ProductCategoryType.BEVERAGE_ALCOHOLIC },
    { name: 'Non-Alcoholic Beverages', categoryType: ProductCategoryType.BEVERAGE_NON_ALCOHOLIC },
    { name: 'Hardware', categoryType: ProductCategoryType.HARDWARE },
    { name: 'Building Materials', categoryType: ProductCategoryType.BUILDING_MATERIAL },
    { name: 'Plumbing', categoryType: ProductCategoryType.HARDWARE },
    { name: 'Electrical', categoryType: ProductCategoryType.HARDWARE },
    { name: 'Paint', categoryType: ProductCategoryType.TRADING_GOODS },
    { name: 'Tools', categoryType: ProductCategoryType.SPARE_PART },
  ],
};

interface ProductDef {
  productCode: string;
  name: string;
  productType: ProductType;
  categoryName: string;
  defaultSellingPrice?: number;
  defaultPurchasePrice?: number;
  trackInventory?: boolean;
  trackBatch?: boolean;
}

const COMPANY_PRODUCTS: Record<string, ProductDef[]> = {
  MWANJALISI: [
    {
      productCode: 'PETROL',
      name: 'Petrol (PMS)',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Fuel',
      defaultSellingPrice: 3200,
      defaultPurchasePrice: 3000,
      trackInventory: true,
    },
    {
      productCode: 'DIESEL',
      name: 'Diesel (AGO)',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Fuel',
      defaultSellingPrice: 2900,
      defaultPurchasePrice: 2700,
      trackInventory: true,
    },
    {
      productCode: 'ENGINE-OIL',
      name: 'Engine Oil 4L',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Lubricants',
      defaultSellingPrice: 35000,
      defaultPurchasePrice: 28000,
      trackInventory: true,
    },
  ],
  ITEMBA: [
    {
      productCode: 'TRANSPORT-SVC',
      name: 'Transport Service',
      productType: ProductType.SERVICE,
      categoryName: 'Logistics Services',
      defaultSellingPrice: 150000,
      trackInventory: false,
    },
    {
      productCode: 'MAIZE-SEEDS',
      name: 'Maize Seeds (kg)',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Agriculture Inputs',
      defaultSellingPrice: 4500,
      defaultPurchasePrice: 3500,
      trackInventory: true,
    },
    {
      productCode: 'CEMENT-50KG',
      name: 'Cement 50kg Bag',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Construction Materials',
      defaultSellingPrice: 22000,
      defaultPurchasePrice: 18000,
      trackInventory: true,
    },
    {
      productCode: 'TRUCK-PART',
      name: 'Truck Spare Part',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Vehicle Spare Parts',
      defaultSellingPrice: 0,
      defaultPurchasePrice: 0,
      trackInventory: true,
    },
  ],
  WESTSIDES: [
    {
      productCode: 'WATER-500ML',
      name: 'Bottled Water 500ml',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Non-Alcoholic Beverages',
      defaultSellingPrice: 500,
      defaultPurchasePrice: 350,
      trackInventory: true,
      trackBatch: true,
    },
    {
      productCode: 'SODA-500ML',
      name: 'Soft Drink 500ml',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Non-Alcoholic Beverages',
      defaultSellingPrice: 800,
      defaultPurchasePrice: 600,
      trackInventory: true,
    },
    {
      productCode: 'BEER-500ML',
      name: 'Beer 500ml Bottle',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Alcoholic Beverages',
      defaultSellingPrice: 3000,
      defaultPurchasePrice: 2200,
      trackInventory: true,
      trackBatch: true,
    },
    {
      productCode: 'CEMENT-WS',
      name: 'Cement 50kg',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Building Materials',
      defaultSellingPrice: 23000,
      defaultPurchasePrice: 18500,
      trackInventory: true,
    },
    {
      productCode: 'PAINT-4L',
      name: 'Paint 4 Litre',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Paint',
      defaultSellingPrice: 28000,
      defaultPurchasePrice: 22000,
      trackInventory: true,
    },
    {
      productCode: 'PVC-PIPE-3M',
      name: 'PVC Pipe 3m',
      productType: ProductType.STOCK_ITEM,
      categoryName: 'Plumbing',
      defaultSellingPrice: 8500,
      defaultPurchasePrice: 6500,
      trackInventory: true,
    },
  ],
};

async function seedOperations() {
  // 1. System units (shared, companyId = null)
  for (const u of SYSTEM_UNITS) {
    await prisma.unitOfMeasure.upsert({
      where: { id: `unit-sys-${u.symbol}` },
      update: {
        name: u.name,
        symbol: u.symbol,
        unitType: u.unitType as UnitType,
        isSystemUnit: true,
      },
      create: {
        id: `unit-sys-${u.symbol}`,
        name: u.name,
        symbol: u.symbol,
        unitType: u.unitType as UnitType,
        isBaseUnit: false,
        isSystemUnit: true,
      },
    });
  }

  // Get piece unit id for products
  const pieceUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'pcs', isSystemUnit: true },
  });
  const litreUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'L', isSystemUnit: true },
  });
  const kgUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'kg', isSystemUnit: true },
  });
  const bagUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'bag', isSystemUnit: true },
  });
  const svcUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'svc', isSystemUnit: true },
  });

  const companies = await prisma.company.findMany({ where: { deletedAt: null } });

  for (const company of companies) {
    const code = company.code; // MWANJALISI / ITEMBA / WESTSIDES

    // 2. Product categories
    const catDefs = COMPANY_CATEGORIES[code] ?? [];
    const catIdByName = new Map<string, string>();
    for (const cat of catDefs) {
      const existing = await prisma.productCategory.findFirst({
        where: { companyId: company.id, name: cat.name },
      });
      if (existing) {
        catIdByName.set(cat.name, existing.id);
      } else {
        const created = await prisma.productCategory.create({
          data: { companyId: company.id, name: cat.name, categoryType: cat.categoryType },
        });
        catIdByName.set(cat.name, created.id);
      }
    }

    // 3. Sample products
    const prodDefs = COMPANY_PRODUCTS[code] ?? [];
    for (const prod of prodDefs) {
      const categoryId = catIdByName.get(prod.categoryName);
      if (!categoryId) continue;

      // Pick base unit based on product
      let baseUnitId = pieceUnit?.id ?? '';
      if (prod.productType === ProductType.SERVICE) baseUnitId = svcUnit?.id ?? pieceUnit?.id ?? '';
      else if (
        prod.name.includes('Petrol') ||
        prod.name.includes('Diesel') ||
        prod.name.includes('Litre')
      )
        baseUnitId = litreUnit?.id ?? pieceUnit?.id ?? '';
      else if (prod.name.includes('kg') || prod.name.includes('Kg') || prod.name.includes('Seeds'))
        baseUnitId = kgUnit?.id ?? pieceUnit?.id ?? '';
      else if (prod.name.includes('Bag') || prod.name.includes('bag'))
        baseUnitId = bagUnit?.id ?? pieceUnit?.id ?? '';

      const existing = await prisma.product.findFirst({
        where: { companyId: company.id, productCode: prod.productCode },
      });
      if (!existing) {
        await prisma.product.create({
          data: {
            companyId: company.id,
            productCode: prod.productCode,
            name: prod.name,
            categoryId,
            productType: prod.productType,
            baseUnitId,
            defaultSellingPrice: prod.defaultSellingPrice ?? null,
            defaultPurchasePrice: prod.defaultPurchasePrice ?? null,
            trackInventory: prod.trackInventory ?? true,
            trackBatch: prod.trackBatch ?? false,
          },
        });
      }
    }
  }

  console.log(`      Operations seeded for ${companies.length} companies`);
}

// ─── Petroleum seed helpers (Milestone 5) ────────────────────────────────────

async function seedPetroleum() {
  // Get Mwanjalisi Oil company
  const company = await prisma.company.findFirst({ where: { code: 'MWANJALISI' } });
  if (!company) {
    console.log('      Mwanjalisi Oil not found — skipping petroleum seed');
    return;
  }

  // Get petroleum division
  const division = await prisma.division.findFirst({
    where: { companyId: company.id, code: 'PETRO' },
  });

  // Get first branch (fuel station)
  let branch = await prisma.branch.findFirst({ where: { division: { companyId: company.id } } });
  if (!branch) {
    console.log('      No branch found for Mwanjalisi Oil — skipping petroleum seed');
    return;
  }

  // Get admin user for seeding
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const admin = await prisma.user.findFirst({ where: { email: adminEmail } });
  if (!admin) {
    console.log('      Admin user not found — skipping petroleum seed');
    return;
  }

  // Get petrol and diesel products
  const petrolProduct = await prisma.product.findFirst({
    where: { companyId: company.id, name: { contains: 'Petrol' } },
  });
  const dieselProduct = await prisma.product.findFirst({
    where: { companyId: company.id, name: { contains: 'Diesel' } },
  });

  if (!petrolProduct || !dieselProduct) {
    console.log('      Petrol/Diesel products not found — skipping petroleum seed');
    return;
  }

  // ── 1. Fuel Tanks ──────────────────────────────────────────────────────────
  const tanks: { tankCode: string; tankName: string; productId: string; capacityLitres: number }[] =
    [
      {
        tankCode: 'TK-001',
        tankName: 'Petrol Tank 1',
        productId: petrolProduct.id,
        capacityLitres: 30000,
      },
      {
        tankCode: 'TK-002',
        tankName: 'Diesel Tank 1',
        productId: dieselProduct.id,
        capacityLitres: 40000,
      },
    ];

  const tankMap = new Map<string, string>(); // tankCode → id
  for (const t of tanks) {
    let existing = await prisma.fuelTank.findFirst({
      where: { branchId: branch.id, tankCode: t.tankCode },
    });
    if (!existing) {
      existing = await prisma.fuelTank.create({
        data: {
          tankCode: t.tankCode,
          companyId: company.id,
          divisionId: division?.id ?? null,
          branchId: branch.id,
          productId: t.productId,
          tankName: t.tankName,
          capacityLitres: t.capacityLitres,
          currentBookBalance: 0,
          status: FuelTankStatus.ACTIVE,
        },
      });
    }
    tankMap.set(t.tankCode, existing.id);
  }

  // ── 2. Fuel Pumps ──────────────────────────────────────────────────────────
  const pumpMap = new Map<string, string>(); // pumpCode → id
  const pumps = [
    { pumpCode: 'PUMP-01', pumpName: 'Pump 1' },
    { pumpCode: 'PUMP-02', pumpName: 'Pump 2' },
  ];
  for (const p of pumps) {
    let existing = await prisma.fuelPump.findFirst({
      where: { branchId: branch.id, pumpCode: p.pumpCode },
    });
    if (!existing) {
      existing = await prisma.fuelPump.create({
        data: {
          pumpCode: p.pumpCode,
          companyId: company.id,
          divisionId: division?.id ?? null,
          branchId: branch.id,
          pumpName: p.pumpName,
          status: FuelPumpStatus.ACTIVE,
        },
      });
    }
    pumpMap.set(p.pumpCode, existing.id);
  }

  // ── 3. Fuel Nozzles ────────────────────────────────────────────────────────
  const nozzles = [
    {
      nozzleCode: 'NZ-01',
      pumpCode: 'PUMP-01',
      tankCode: 'TK-001',
      productId: petrolProduct.id,
      nozzleName: 'Pump 1 Petrol',
    },
    {
      nozzleCode: 'NZ-02',
      pumpCode: 'PUMP-01',
      tankCode: 'TK-002',
      productId: dieselProduct.id,
      nozzleName: 'Pump 1 Diesel',
    },
    {
      nozzleCode: 'NZ-03',
      pumpCode: 'PUMP-02',
      tankCode: 'TK-001',
      productId: petrolProduct.id,
      nozzleName: 'Pump 2 Petrol',
    },
    {
      nozzleCode: 'NZ-04',
      pumpCode: 'PUMP-02',
      tankCode: 'TK-002',
      productId: dieselProduct.id,
      nozzleName: 'Pump 2 Diesel',
    },
  ];
  for (const n of nozzles) {
    const pumpId = pumpMap.get(n.pumpCode);
    const tankId = tankMap.get(n.tankCode);
    if (!pumpId || !tankId) continue;
    const existing = await prisma.fuelNozzle.findFirst({
      where: { pumpId, nozzleCode: n.nozzleCode },
    });
    if (!existing) {
      await prisma.fuelNozzle.create({
        data: {
          nozzleCode: n.nozzleCode,
          companyId: company.id,
          divisionId: division?.id ?? null,
          branchId: branch.id,
          pumpId,
          tankId,
          productId: n.productId,
          nozzleName: n.nozzleName,
          currentMeterReading: 0,
          status: FuelNozzleStatus.ACTIVE,
        },
      });
    }
  }

  // ── 4. Fuel Prices ─────────────────────────────────────────────────────────
  const prices = [
    { productId: petrolProduct.id, pricePerLitre: 3250, notes: 'Initial petrol price' },
    { productId: dieselProduct.id, pricePerLitre: 2950, notes: 'Initial diesel price' },
  ];
  for (const pr of prices) {
    const existing = await prisma.fuelPrice.findFirst({
      where: {
        companyId: company.id,
        productId: pr.productId,
        status: FuelPriceStatus.ACTIVE,
      },
    });
    if (!existing) {
      await prisma.fuelPrice.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          productId: pr.productId,
          pricePerLitre: pr.pricePerLitre,
          currency: CurrencyCode.TZS,
          effectiveFrom: new Date('2026-01-01'),
          status: FuelPriceStatus.ACTIVE,
          createdById: admin.id,
          notes: pr.notes,
        },
      });
    }
  }

  console.log('      Petroleum seeded: 2 tanks, 2 pumps, 4 nozzles, 2 fuel prices');
}

// ─── Westsides seed helpers (Milestone 6) ────────────────────────────────────

async function seedWestsides() {
  const company = await prisma.company.findFirst({ where: { code: 'WESTSIDES' } });
  if (!company) {
    console.log('      Westsides Company not found — skipping westsides seed');
    return;
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const admin = await prisma.user.findFirst({ where: { email: adminEmail } });
  if (!admin) return;

  // ── 1. Sales Channels ──────────────────────────────────────────────────────
  const channels = [
    { name: 'Retail Counter', channelType: SalesChannelType.RETAIL },
    { name: 'Wholesale', channelType: SalesChannelType.WHOLESALE },
    { name: 'POS Terminal', channelType: SalesChannelType.POS },
    { name: 'Delivery', channelType: SalesChannelType.DELIVERY },
  ];
  for (const ch of channels) {
    const existing = await prisma.salesChannel.findFirst({
      where: { companyId: company.id, name: ch.name },
    });
    if (!existing) {
      await prisma.salesChannel.create({
        data: { ...ch, companyId: company.id, isActive: true },
      });
    }
  }

  // ── 2. Price Lists ─────────────────────────────────────────────────────────
  const priceLists = [
    { name: 'Westsides Retail Price List', priceListType: PriceListType.RETAIL },
    { name: 'Westsides Wholesale Price List', priceListType: PriceListType.WHOLESALE },
    { name: 'Westsides Contractor Price List', priceListType: PriceListType.CONTRACTOR },
  ];
  for (const pl of priceLists) {
    const existing = await prisma.priceList.findFirst({
      where: { companyId: company.id, name: pl.name },
    });
    if (!existing) {
      await prisma.priceList.create({
        data: {
          ...pl,
          companyId: company.id,
          currency: CurrencyCode.TZS,
          effectiveFrom: new Date('2026-01-01'),
          status: PriceListStatus.ACTIVE,
          createdById: admin.id,
        },
      });
    }
  }

  // ── 3. Returnable Packages ─────────────────────────────────────────────────
  const packages = [
    {
      packageCode: 'PKG-CRATE',
      name: 'Empty Crate',
      packageType: ReturnablePackageType.EMPTY_CRATE,
      depositValue: 3000,
    },
    {
      packageCode: 'PKG-BOTTLE',
      name: 'Empty Bottle',
      packageType: ReturnablePackageType.EMPTY_BOTTLE,
      depositValue: 100,
    },
  ];
  for (const pkg of packages) {
    const existing = await prisma.returnablePackage.findFirst({
      where: { companyId: company.id, packageCode: pkg.packageCode },
    });
    if (!existing) {
      await prisma.returnablePackage.create({
        data: { ...pkg, companyId: company.id, status: ReturnablePackageStatus.ACTIVE },
      });
    }
  }

  // ── 4. Ensure product categories exist ────────────────────────────────────
  const westsidesCategories = [
    { name: 'Alcoholic Beverages', type: ProductCategoryType.PRODUCT },
    { name: 'Non-Alcoholic Beverages', type: ProductCategoryType.PRODUCT },
    { name: 'Hardware', type: ProductCategoryType.PRODUCT },
    { name: 'Building Materials', type: ProductCategoryType.PRODUCT },
    { name: 'Plumbing', type: ProductCategoryType.PRODUCT },
    { name: 'Electrical', type: ProductCategoryType.PRODUCT },
    { name: 'Paint', type: ProductCategoryType.PRODUCT },
    { name: 'Tools', type: ProductCategoryType.PRODUCT },
  ];
  for (const cat of westsidesCategories) {
    const existing = await prisma.productCategory.findFirst({
      where: { companyId: company.id, name: cat.name },
    });
    if (!existing) {
      await prisma.productCategory.create({
        data: { companyId: company.id, name: cat.name, categoryType: cat.type },
      });
    }
  }

  // ── 5. Ensure key units exist ──────────────────────────────────────────────
  const keyUnits = [
    { code: 'btl', name: 'Bottle', symbol: 'btl', unitType: UnitType.PIECE },
    { code: 'crt', name: 'Crate', symbol: 'crt', unitType: UnitType.PACKAGE },
    { code: 'ctn', name: 'Carton', symbol: 'ctn', unitType: UnitType.PACKAGE },
    { code: 'pk', name: 'Pack', symbol: 'pk', unitType: UnitType.PACKAGE },
    { code: 'bag', name: 'Bag', symbol: 'bag', unitType: UnitType.PACKAGE },
    { code: 'kg', name: 'Kilogram', symbol: 'kg', unitType: UnitType.WEIGHT },
    { code: 'ton', name: 'Ton', symbol: 'ton', unitType: UnitType.WEIGHT },
    { code: 'm', name: 'Meter', symbol: 'm', unitType: UnitType.LENGTH },
  ];
  for (const u of keyUnits) {
    const existing = await prisma.unitOfMeasure.findFirst({
      where: { symbol: u.symbol, isSystemUnit: true },
    });
    if (!existing) {
      await prisma.unitOfMeasure.create({
        data: { name: u.name, symbol: u.symbol, unitType: u.unitType, isSystemUnit: true },
      });
    }
  }

  // ── 6. Sample Products ─────────────────────────────────────────────────────
  const bottleUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'btl', isSystemUnit: true },
  });
  const bagUnit2 = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'bag', isSystemUnit: true },
  });
  const mtrUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'm', isSystemUnit: true },
  });
  const alcoCat = await prisma.productCategory.findFirst({
    where: { companyId: company.id, name: 'Alcoholic Beverages' },
  });
  const nonAlcoCat = await prisma.productCategory.findFirst({
    where: { companyId: company.id, name: 'Non-Alcoholic Beverages' },
  });
  const bldCat = await prisma.productCategory.findFirst({
    where: { companyId: company.id, name: 'Building Materials' },
  });
  const hwCat = await prisma.productCategory.findFirst({
    where: { companyId: company.id, name: 'Hardware' },
  });

  const sampleProducts = [
    {
      name: 'Beer (Bottle)',
      code: 'BEV-001',
      catId: alcoCat?.id,
      unit: bottleUnit?.id,
      trackBatch: true,
      trackExpiry: true,
      retail: 2500,
      wholesale: 2200,
    },
    {
      name: 'Soft Drink',
      code: 'BEV-002',
      catId: nonAlcoCat?.id,
      unit: bottleUnit?.id,
      trackBatch: true,
      trackExpiry: true,
      retail: 1000,
      wholesale: 800,
    },
    {
      name: 'Bottled Water',
      code: 'BEV-003',
      catId: nonAlcoCat?.id,
      unit: bottleUnit?.id,
      trackBatch: true,
      trackExpiry: true,
      retail: 500,
      wholesale: 400,
    },
    {
      name: 'Cement (50kg bag)',
      code: 'BLD-001',
      catId: bldCat?.id,
      unit: bagUnit2?.id,
      trackBatch: false,
      trackExpiry: false,
      retail: 22000,
      wholesale: 20000,
    },
    {
      name: 'PVC Pipe (3m)',
      code: 'HW-001',
      catId: hwCat?.id,
      unit: mtrUnit?.id,
      trackBatch: false,
      trackExpiry: false,
      retail: 8000,
      wholesale: 7000,
    },
    {
      name: 'Paint (20L)',
      code: 'HW-002',
      catId: hwCat?.id,
      unit: bagUnit2?.id,
      trackBatch: false,
      trackExpiry: false,
      retail: 45000,
      wholesale: 40000,
    },
  ];

  for (const sp of sampleProducts) {
    if (!sp.catId || !sp.unit) continue;
    const existing = await prisma.product.findFirst({
      where: { companyId: company.id, productCode: sp.code },
    });
    if (!existing) {
      await prisma.product.create({
        data: {
          companyId: company.id,
          productCode: sp.code,
          name: sp.name,
          categoryId: sp.catId,
          baseUnitId: sp.unit,
          productType: ProductType.STOCK_ITEM,
          trackInventory: true,
          trackBatch: sp.trackBatch,
          trackExpiry: sp.trackExpiry,
          retailPrice: sp.retail,
          wholesalePrice: sp.wholesale,
          defaultSellingPrice: sp.retail,
        },
      });
    }
  }

  console.log(
    '      Westsides seeded: 4 sales channels, 3 price lists, 2 returnable packages, 8 product categories, 6 sample products',
  );
}

// ─── Itemba Enterprises seed helpers (Milestone 7) ───────────────────────────

async function seedItemba() {
  console.log('      Seeding Itemba Enterprises operational data...');

  const itemba = await prisma.company.findFirst({ where: { code: 'ITEMBA_ENT' } });
  if (!itemba) {
    console.log('      Itemba Enterprises company not found, skipping itemba seed');
    return;
  }

  const logisticsDivision = await prisma.division.findFirst({
    where: { companyId: itemba.id, name: { contains: 'Logistics' } },
  });
  const agricultureDivision = await prisma.division.findFirst({
    where: { companyId: itemba.id, name: { contains: 'Agriculture' } },
  });
  const constructionDivision = await prisma.division.findFirst({
    where: { companyId: itemba.id, name: { contains: 'Construction' } },
  });

  const kgUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'kg', isSystemUnit: true },
  });
  const haUnit = await prisma.unitOfMeasure.findFirst({
    where: { symbol: 'ha', isSystemUnit: true },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const adminUser = await prisma.user.findFirst({ where: { email: adminEmail } });
  if (!adminUser) {
    console.log('      Admin user not found, skipping itemba seed');
    return;
  }

  // ── Logistics ───────────────────────────────────────────────────────────────
  if (logisticsDivision) {
    const route1 = await prisma.route.findFirst({
      where: { companyId: itemba.id, routeCode: 'RT-00001' },
    });
    if (!route1) {
      await prisma.route.create({
        data: {
          routeCode: 'RT-00001',
          companyId: itemba.id,
          divisionId: logisticsDivision.id,
          name: 'Dar es Salaam - Mbeya',
          origin: 'Dar es Salaam',
          destination: 'Mbeya',
          distanceKm: 840,
          estimatedDuration: '12 hours',
          standardRate: 1500000,
          currency: 'TZS',
          status: RouteStatus.ACTIVE,
        },
      });
    }

    const route2 = await prisma.route.findFirst({
      where: { companyId: itemba.id, routeCode: 'RT-00002' },
    });
    if (!route2) {
      await prisma.route.create({
        data: {
          routeCode: 'RT-00002',
          companyId: itemba.id,
          divisionId: logisticsDivision.id,
          name: 'Dar es Salaam - Dodoma',
          origin: 'Dar es Salaam',
          destination: 'Dodoma',
          distanceKm: 450,
          estimatedDuration: '6 hours',
          standardRate: 800000,
          currency: 'TZS',
          status: RouteStatus.ACTIVE,
        },
      });
    }

    const vehicle1 = await prisma.vehicle.findFirst({
      where: { companyId: itemba.id, vehicleCode: 'VEH-00001' },
    });
    if (!vehicle1) {
      await prisma.vehicle.create({
        data: {
          vehicleCode: 'VEH-00001',
          companyId: itemba.id,
          divisionId: logisticsDivision.id,
          registrationNumber: 'T 123 ABC',
          vehicleType: VehicleType.TRUCK,
          make: 'Isuzu',
          model: 'FVR 34',
          year: 2020,
          fuelType: VehicleFuelType.DIESEL,
          status: VehicleStatus.ACTIVE,
          currentOdometer: 45000,
          capacityDescription: '7 Tonnes',
        },
      });
    }

    const driver1 = await prisma.driverProfile.findFirst({
      where: { companyId: itemba.id, driverCode: 'DRV-00001' },
    });
    if (!driver1) {
      await prisma.driverProfile.create({
        data: {
          driverCode: 'DRV-00001',
          companyId: itemba.id,
          divisionId: logisticsDivision.id,
          fullName: 'John Mwangi',
          phone: '+255712000001',
          licenseNumber: 'TZ-DL-001001',
          licenseClass: 'Class C',
          status: DriverStatus.ACTIVE,
        },
      });
    }
  }

  // ── Agriculture ─────────────────────────────────────────────────────────────
  if (agricultureDivision) {
    const maize = await prisma.crop.findFirst({
      where: { companyId: itemba.id, cropCode: 'CROP-00001' },
    });
    if (!maize) {
      await prisma.crop.create({
        data: {
          cropCode: 'CROP-00001',
          companyId: itemba.id,
          divisionId: agricultureDivision.id,
          name: 'Maize',
          cropType: CropType.GRAIN,
          defaultGrowingDays: 120,
          defaultUnitId: kgUnit?.id,
          status: CropStatus.ACTIVE,
        },
      });
    }

    const sunflower = await prisma.crop.findFirst({
      where: { companyId: itemba.id, cropCode: 'CROP-00002' },
    });
    if (!sunflower) {
      await prisma.crop.create({
        data: {
          cropCode: 'CROP-00002',
          companyId: itemba.id,
          divisionId: agricultureDivision.id,
          name: 'Sunflower',
          cropType: CropType.CASH_CROP,
          defaultGrowingDays: 90,
          defaultUnitId: kgUnit?.id,
          status: CropStatus.ACTIVE,
        },
      });
    }

    const farm1 = await prisma.farm.findFirst({
      where: { companyId: itemba.id, farmCode: 'FARM-00001' },
    });
    if (!farm1) {
      await prisma.farm.create({
        data: {
          farmCode: 'FARM-00001',
          companyId: itemba.id,
          divisionId: agricultureDivision.id,
          name: 'Itemba Main Farm',
          location: 'Iringa, Tanzania',
          sizeValue: 50,
          sizeUnitId: haUnit?.id,
          ownershipType: FarmOwnershipType.OWNED,
          status: FarmStatus.ACTIVE,
        },
      });
    }
  }

  // ── Construction ─────────────────────────────────────────────────────────────
  if (constructionDivision) {
    const proj1 = await prisma.constructionProject.findFirst({
      where: { companyId: itemba.id, projectCode: 'PROJ-00001' },
    });
    if (!proj1) {
      await prisma.constructionProject.create({
        data: {
          projectCode: 'PROJ-00001',
          companyId: itemba.id,
          divisionId: constructionDivision.id,
          projectName: 'Dodoma Warehouse Construction',
          projectType: ConstructionProjectType.COMMERCIAL,
          location: 'Dodoma, Tanzania',
          contractValue: 250000000,
          budgetAmount: 220000000,
          currency: 'TZS',
          status: ConstructionProjectStatus.PLANNED,
          createdById: adminUser.id,
        },
      });
    }
  }

  console.log('      Itemba seed complete.');
}

// ─── Milestone 8 seed helper ─────────────────────────────────────────────────

async function seedM8() {
  const adminUser = await prisma.user.findFirstOrThrow({ where: { email: { contains: 'admin' } } });

  // ── Companies ─────────────────────────────────────────────────────────────
  const mwanjalisi = await prisma.company.findFirstOrThrow({ where: { code: 'MWANJALISI' } });
  const westsides = await prisma.company.findFirstOrThrow({ where: { code: 'WESTSIDES' } });
  const itemba = await prisma.company.findFirstOrThrow({ where: { code: 'ITEMBA_ENT' } });

  // ── Divisions ──────────────────────────────────────────────────────────────
  const parkingDiv = await prisma.division.findFirst({
    where: { companyId: mwanjalisi.id, code: 'PARKING' },
  });
  const rentalShopsDiv = await prisma.division.findFirst({
    where: { companyId: mwanjalisi.id, code: 'RENTAL' },
  });
  const hospitalityDiv = await prisma.division.findFirst({
    where: { companyId: westsides.id, code: 'HOSPITALITY' },
  });
  const realEstateDiv = await prisma.division.findFirst({
    where: { companyId: itemba.id, code: 'REAL_ESTATE' },
  });

  // ── Licensed Business Units ───────────────────────────────────────────────

  // Truck Parking
  const parkingBU = await prisma.licensedBusinessUnit.findFirst({
    where: { companyId: mwanjalisi.id, businessUnitCode: 'LBU-MOL-PARKING-001' },
  });
  const parkingBURecord =
    parkingBU ??
    (await prisma.licensedBusinessUnit.create({
      data: {
        businessUnitCode: 'LBU-MOL-PARKING-001',
        companyId: mwanjalisi.id,
        divisionId: parkingDiv?.id,
        name: 'Mwanjalisi Truck Parking Business',
        tradingName: 'Mwanjalisi Truck Park',
        businessUnitType: BusinessUnitType.TRUCK_PARKING,
        licenseRequired: true,
        status: BusinessUnitStatus.ACTIVE,
        location: 'Nyerere Road, Dar es Salaam',
      },
    }));

  // Uzunguni Inn
  const uzunguniBU = await prisma.licensedBusinessUnit.findFirst({
    where: { companyId: westsides.id, businessUnitCode: 'LBU-WSC-UZUNGUNI-001' },
  });
  const uzunguniBURecord =
    uzunguniBU ??
    (await prisma.licensedBusinessUnit.create({
      data: {
        businessUnitCode: 'LBU-WSC-UZUNGUNI-001',
        companyId: westsides.id,
        divisionId: hospitalityDiv?.id,
        name: 'Uzunguni Inn',
        tradingName: 'Uzunguni Inn',
        businessUnitType: BusinessUnitType.HOSPITALITY,
        licenseRequired: true,
        status: BusinessUnitStatus.ACTIVE,
        location: 'Uzunguni, Dar es Salaam',
      },
    }));

  // Real Estate
  const realEstateBU = await prisma.licensedBusinessUnit.findFirst({
    where: { companyId: itemba.id, businessUnitCode: 'LBU-IEC-REALESTATE-001' },
  });
  const realEstateBURecord =
    realEstateBU ??
    (await prisma.licensedBusinessUnit.create({
      data: {
        businessUnitCode: 'LBU-IEC-REALESTATE-001',
        companyId: itemba.id,
        divisionId: realEstateDiv?.id,
        name: 'Itemba Real Estate',
        tradingName: 'Itemba Properties',
        businessUnitType: BusinessUnitType.REAL_ESTATE_RENTAL,
        licenseRequired: false,
        status: BusinessUnitStatus.ACTIVE,
        location: 'Dar es Salaam, Tanzania',
      },
    }));

  // ── Business Licenses ─────────────────────────────────────────────────────

  const truckParkingLic = await prisma.businessLicense.findFirst({
    where: { companyId: mwanjalisi.id, licenseCode: 'LIC-MOL-PARKING-001' },
  });
  if (!truckParkingLic) {
    await prisma.businessLicense.create({
      data: {
        licenseCode: 'LIC-MOL-PARKING-001',
        companyId: mwanjalisi.id,
        divisionId: parkingDiv?.id,
        licensedBusinessUnitId: parkingBURecord.id,
        licenseType: BusinessLicenseType.TRUCK_PARKING_LICENSE,
        licenseNumber: 'TPC-DSM-2024-0045',
        issuingAuthority: 'Dar es Salaam City Council',
        issueDate: new Date('2024-01-01'),
        expiryDate: new Date('2025-12-31'),
        renewalDate: new Date('2025-11-01'),
        status: BusinessLicenseStatus.ACTIVE,
        responsibleUserId: adminUser.id,
      },
    });
  }

  const hotelLic = await prisma.businessLicense.findFirst({
    where: { companyId: westsides.id, licenseCode: 'LIC-WSC-GUESTHOUSE-001' },
  });
  if (!hotelLic) {
    await prisma.businessLicense.create({
      data: {
        licenseCode: 'LIC-WSC-GUESTHOUSE-001',
        companyId: westsides.id,
        divisionId: hospitalityDiv?.id,
        licensedBusinessUnitId: uzunguniBURecord.id,
        licenseType: BusinessLicenseType.GUEST_HOUSE_LICENSE,
        licenseNumber: 'GHL-DSM-2024-0012',
        issuingAuthority: 'Tanzania Tourism Board',
        issueDate: new Date('2024-03-01'),
        expiryDate: new Date('2025-02-28'),
        renewalDate: new Date('2025-01-15'),
        status: BusinessLicenseStatus.ACTIVE,
        responsibleUserId: adminUser.id,
      },
    });
  }

  const liquorLic = await prisma.businessLicense.findFirst({
    where: { companyId: westsides.id, licenseCode: 'LIC-WSC-LIQUOR-001' },
  });
  if (!liquorLic) {
    await prisma.businessLicense.create({
      data: {
        licenseCode: 'LIC-WSC-LIQUOR-001',
        companyId: westsides.id,
        divisionId: hospitalityDiv?.id,
        licensedBusinessUnitId: uzunguniBURecord.id,
        licenseType: BusinessLicenseType.LIQUOR_LICENSE,
        licenseNumber: 'LIQ-TZ-2024-0098',
        issuingAuthority: 'Tanzania Revenue Authority',
        issueDate: new Date('2024-01-01'),
        expiryDate: new Date('2024-12-31'),
        renewalDate: new Date('2024-11-01'),
        status: BusinessLicenseStatus.ACTIVE,
        responsibleUserId: adminUser.id,
      },
    });
  }

  // ── Parking Facility ──────────────────────────────────────────────────────
  const parkFacility = await prisma.parkingFacility.findFirst({
    where: { companyId: mwanjalisi.id, facilityCode: 'PF-MOL-001' },
  });
  const parkFacilityRecord =
    parkFacility ??
    (await prisma.parkingFacility.create({
      data: {
        facilityCode: 'PF-MOL-001',
        companyId: mwanjalisi.id,
        divisionId: parkingDiv?.id,
        licensedBusinessUnitId: parkingBURecord.id,
        facilityName: 'Mwanjalisi Truck Parking Yard',
        location: 'Nyerere Road, Dar es Salaam',
        capacityTrucks: 50,
        status: ParkingFacilityStatus.ACTIVE,
        managerId: adminUser.id,
      },
    }));

  // Parking Zone
  const parkZone = await prisma.parkingZone.findFirst({
    where: { companyId: mwanjalisi.id, zoneCode: 'PZ-MOL-001-A' },
  });
  const parkZoneRecord =
    parkZone ??
    (await prisma.parkingZone.create({
      data: {
        zoneCode: 'PZ-MOL-001-A',
        companyId: mwanjalisi.id,
        facilityId: parkFacilityRecord.id,
        zoneName: 'Zone A — Large Trucks',
        vehicleType: ParkingZoneVehicleType.LARGE_TRUCK,
        capacity: 30,
        status: ParkingZoneStatus.ACTIVE,
      },
    }));

  // Parking Rate
  const parkRate = await prisma.parkingRate.findFirst({
    where: { companyId: mwanjalisi.id, rateCode: 'PR-MOL-001-DAILY' },
  });
  if (!parkRate) {
    await prisma.parkingRate.create({
      data: {
        rateCode: 'PR-MOL-001-DAILY',
        companyId: mwanjalisi.id,
        facilityId: parkFacilityRecord.id,
        zoneId: parkZoneRecord.id,
        rateName: 'Daily Truck Rate',
        rateType: ParkingRateType.DAILY,
        amount: 10000,
        currency: 'TZS',
        effectiveFrom: new Date('2024-01-01'),
        status: ParkingRateStatus.ACTIVE,
        createdById: adminUser.id,
      },
    });
  }

  // ── Rental Properties ─────────────────────────────────────────────────────

  // Mwanjalisi Rental Shops
  const molRentalProp = await prisma.rentalProperty.findFirst({
    where: { companyId: mwanjalisi.id, propertyCode: 'PROP-MOL-001' },
  });
  const molRentalPropRecord =
    molRentalProp ??
    (await prisma.rentalProperty.create({
      data: {
        propertyCode: 'PROP-MOL-001',
        companyId: mwanjalisi.id,
        divisionId: rentalShopsDiv?.id,
        propertyName: 'Mwanjalisi Shops Block',
        propertyType: RentalPropertyType.SHOP_BLOCK,
        location: 'Nyerere Road, Dar es Salaam',
        ownershipType: RentalOwnershipType.OWNED,
        status: RentalPropertyStatus.ACTIVE,
        managerId: adminUser.id,
      },
    }));

  // Sample rental unit
  const molShop1 = await prisma.rentalUnit.findFirst({
    where: { companyId: mwanjalisi.id, unitCode: 'UNIT-MOL-001-S01' },
  });
  if (!molShop1) {
    await prisma.rentalUnit.create({
      data: {
        unitCode: 'UNIT-MOL-001-S01',
        companyId: mwanjalisi.id,
        propertyId: molRentalPropRecord.id,
        unitType: RentalUnitType.SHOP,
        unitNumber: 'S-01',
        floor: 'Ground Floor',
        sizeDescription: '20 sqm corner shop',
        rentAmount: 300000,
        currency: 'TZS',
        billingFrequency: BillingFrequency.MONTHLY,
        securityDepositAmount: 600000,
        status: RentalUnitStatus.VACANT,
      },
    });
  }

  // Itemba Real Estate — shops
  const iecShopProp = await prisma.rentalProperty.findFirst({
    where: { companyId: itemba.id, propertyCode: 'PROP-IEC-SHOPS-001' },
  });
  const iecShopPropRecord =
    iecShopProp ??
    (await prisma.rentalProperty.create({
      data: {
        propertyCode: 'PROP-IEC-SHOPS-001',
        companyId: itemba.id,
        divisionId: realEstateDiv?.id,
        licensedBusinessUnitId: realEstateBURecord.id,
        propertyName: 'Itemba Commercial Shops Block',
        propertyType: RentalPropertyType.SHOP_BLOCK,
        location: 'Dodoma, Tanzania',
        ownershipType: RentalOwnershipType.OWNED,
        status: RentalPropertyStatus.ACTIVE,
        managerId: adminUser.id,
      },
    }));

  // Itemba Real Estate — houses
  const iecHouseProp = await prisma.rentalProperty.findFirst({
    where: { companyId: itemba.id, propertyCode: 'PROP-IEC-HOUSES-001' },
  });
  const iecHousePropRecord =
    iecHouseProp ??
    (await prisma.rentalProperty.create({
      data: {
        propertyCode: 'PROP-IEC-HOUSES-001',
        companyId: itemba.id,
        divisionId: realEstateDiv?.id,
        licensedBusinessUnitId: realEstateBURecord.id,
        propertyName: 'Itemba Residential Houses',
        propertyType: RentalPropertyType.RESIDENTIAL_HOUSE,
        location: 'Iringa, Tanzania',
        ownershipType: RentalOwnershipType.OWNED,
        status: RentalPropertyStatus.ACTIVE,
        managerId: adminUser.id,
      },
    }));

  // Sample house unit
  const iecHouse1 = await prisma.rentalUnit.findFirst({
    where: { companyId: itemba.id, unitCode: 'UNIT-IEC-H001-H01' },
  });
  if (!iecHouse1) {
    await prisma.rentalUnit.create({
      data: {
        unitCode: 'UNIT-IEC-H001-H01',
        companyId: itemba.id,
        propertyId: iecHousePropRecord.id,
        unitType: RentalUnitType.HOUSE,
        unitNumber: 'H-01',
        sizeDescription: '3-bedroom standalone house',
        rentAmount: 500000,
        currency: 'TZS',
        billingFrequency: BillingFrequency.MONTHLY,
        securityDepositAmount: 1000000,
        status: RentalUnitStatus.VACANT,
      },
    });
  }

  // ── Hospitality Facility — Uzunguni Inn ───────────────────────────────────
  const uzunguniFacility = await prisma.hospitalityFacility.findFirst({
    where: { companyId: westsides.id, facilityCode: 'HF-WSC-UZUNGUNI-001' },
  });
  const uzunguniFacilityRecord =
    uzunguniFacility ??
    (await prisma.hospitalityFacility.create({
      data: {
        facilityCode: 'HF-WSC-UZUNGUNI-001',
        companyId: westsides.id,
        divisionId: hospitalityDiv?.id,
        licensedBusinessUnitId: uzunguniBURecord.id,
        facilityName: 'Uzunguni Inn',
        facilityType: HospitalityFacilityType.MIXED_HOSPITALITY,
        location: 'Uzunguni, Dar es Salaam',
        status: HospitalityFacilityStatus.ACTIVE,
        managerId: adminUser.id,
      },
    }));

  // Rooms
  const room101 = await prisma.room.findFirst({
    where: { companyId: westsides.id, roomCode: 'ROOM-UZN-101' },
  });
  if (!room101) {
    await prisma.room.create({
      data: {
        roomCode: 'ROOM-UZN-101',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        roomNumber: '101',
        roomType: RoomType.SINGLE,
        floor: 'Ground',
        defaultRate: 50000,
        currency: 'TZS',
        maxOccupancy: 1,
        status: RoomStatus.AVAILABLE,
      },
    });
  }

  const room102 = await prisma.room.findFirst({
    where: { companyId: westsides.id, roomCode: 'ROOM-UZN-102' },
  });
  if (!room102) {
    await prisma.room.create({
      data: {
        roomCode: 'ROOM-UZN-102',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        roomNumber: '102',
        roomType: RoomType.DOUBLE,
        floor: 'Ground',
        defaultRate: 80000,
        currency: 'TZS',
        maxOccupancy: 2,
        status: RoomStatus.AVAILABLE,
      },
    });
  }

  const room201 = await prisma.room.findFirst({
    where: { companyId: westsides.id, roomCode: 'ROOM-UZN-201' },
  });
  if (!room201) {
    await prisma.room.create({
      data: {
        roomCode: 'ROOM-UZN-201',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        roomNumber: '201',
        roomType: RoomType.DELUXE,
        floor: 'First',
        defaultRate: 120000,
        currency: 'TZS',
        maxOccupancy: 2,
        status: RoomStatus.AVAILABLE,
      },
    });
  }

  // Restaurant tables
  const table1 = await prisma.restaurantTable.findFirst({
    where: { companyId: westsides.id, tableCode: 'TBL-UZN-001' },
  });
  if (!table1) {
    await prisma.restaurantTable.create({
      data: {
        tableCode: 'TBL-UZN-001',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        tableNumber: 'T-01',
        seatingCapacity: 4,
        status: RestaurantTableStatus.AVAILABLE,
      },
    });
  }

  const table2 = await prisma.restaurantTable.findFirst({
    where: { companyId: westsides.id, tableCode: 'TBL-UZN-002' },
  });
  if (!table2) {
    await prisma.restaurantTable.create({
      data: {
        tableCode: 'TBL-UZN-002',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        tableNumber: 'T-02',
        seatingCapacity: 6,
        status: RestaurantTableStatus.AVAILABLE,
      },
    });
  }

  // Menu categories
  const foodCat = await prisma.menuCategory.findFirst({
    where: {
      companyId: westsides.id,
      name: 'Main Meals',
      hospitalityFacilityId: uzunguniFacilityRecord.id,
    },
  });
  const foodCatRecord =
    foodCat ??
    (await prisma.menuCategory.create({
      data: {
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        name: 'Main Meals',
        categoryType: MenuCategoryType.FOOD,
        isActive: true,
      },
    }));

  const drinkCat = await prisma.menuCategory.findFirst({
    where: {
      companyId: westsides.id,
      name: 'Soft Drinks',
      hospitalityFacilityId: uzunguniFacilityRecord.id,
    },
  });
  const drinkCatRecord =
    drinkCat ??
    (await prisma.menuCategory.create({
      data: {
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        name: 'Soft Drinks',
        categoryType: MenuCategoryType.NON_ALCOHOLIC_DRINK,
        isActive: true,
      },
    }));

  const barCat = await prisma.menuCategory.findFirst({
    where: {
      companyId: westsides.id,
      name: 'Bar Drinks',
      hospitalityFacilityId: uzunguniFacilityRecord.id,
    },
  });
  const barCatRecord =
    barCat ??
    (await prisma.menuCategory.create({
      data: {
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        name: 'Bar Drinks',
        categoryType: MenuCategoryType.ALCOHOLIC_DRINK,
        isActive: true,
      },
    }));

  // Menu items
  const ugaliItem = await prisma.menuItem.findFirst({
    where: { companyId: westsides.id, menuItemCode: 'MENU-UZN-FOOD-001' },
  });
  if (!ugaliItem) {
    await prisma.menuItem.create({
      data: {
        menuItemCode: 'MENU-UZN-FOOD-001',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        menuCategoryId: foodCatRecord.id,
        name: 'Ugali na Nyama',
        description: 'Ugali served with beef stew',
        price: 8000,
        currency: 'TZS',
        itemType: MenuItemType.FOOD,
        isAlcoholic: false,
        trackInventory: false,
        isActive: true,
      },
    });
  }

  const sodaItem = await prisma.menuItem.findFirst({
    where: { companyId: westsides.id, menuItemCode: 'MENU-UZN-DRINK-001' },
  });
  if (!sodaItem) {
    await prisma.menuItem.create({
      data: {
        menuItemCode: 'MENU-UZN-DRINK-001',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        menuCategoryId: drinkCatRecord.id,
        name: 'Coca-Cola 500ml',
        price: 2000,
        currency: 'TZS',
        itemType: MenuItemType.DRINK,
        isAlcoholic: false,
        trackInventory: true,
        isActive: true,
      },
    });
  }

  const beerItem = await prisma.menuItem.findFirst({
    where: { companyId: westsides.id, menuItemCode: 'MENU-UZN-BAR-001' },
  });
  if (!beerItem) {
    await prisma.menuItem.create({
      data: {
        menuItemCode: 'MENU-UZN-BAR-001',
        companyId: westsides.id,
        hospitalityFacilityId: uzunguniFacilityRecord.id,
        menuCategoryId: barCatRecord.id,
        name: 'Safari Lager 500ml',
        price: 3500,
        currency: 'TZS',
        itemType: MenuItemType.BAR_ITEM,
        isAlcoholic: true,
        trackInventory: true,
        isActive: true,
      },
    });
  }

  console.log('      Milestone 8 seed complete.');
}

// ─── Milestone 9 — HR, Payroll, Attendance ────────────────────────────────────

async function seedM9() {
  // Get companies
  const mwanjalisi = await prisma.company.findFirst({ where: { code: 'MWANJALISI' } });
  const westsides = await prisma.company.findFirst({ where: { code: 'WESTSIDES' } });
  const itemba = await prisma.company.findFirst({ where: { code: 'ITEMBA_ENT' } });
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const adminUser = await prisma.user.findFirst({ where: { email: adminEmail } });

  if (!mwanjalisi || !westsides || !itemba || !adminUser) {
    console.warn('      M9: required companies or admin user not found — skipping.');
    return;
  }

  // ── Departments ────────────────────────────────────────────────────────────
  const deptDefs: { companyId: string; code: string; name: string; description: string }[] = [
    // Mwanjalisi Oil
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-OPS',
      name: 'Operations',
      description: 'Fuel station operations',
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-FIN',
      name: 'Finance',
      description: 'Finance and accounting',
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-SEC',
      name: 'Security',
      description: 'Security and access control',
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-ADM',
      name: 'Administration',
      description: 'General administration',
    },
    // Westsides
    {
      companyId: westsides.id,
      code: 'WEST-SALES',
      name: 'Sales',
      description: 'Wholesale and retail sales',
    },
    {
      companyId: westsides.id,
      code: 'WEST-WH',
      name: 'Warehouse',
      description: 'Warehouse and inventory',
    },
    {
      companyId: westsides.id,
      code: 'WEST-HOSP',
      name: 'Hospitality',
      description: 'Uzunguni Inn hotel and bar',
    },
    {
      companyId: westsides.id,
      code: 'WEST-FIN',
      name: 'Finance',
      description: 'Finance and accounting',
    },
    // Itemba Enterprises
    {
      companyId: itemba.id,
      code: 'ITEM-LOG',
      name: 'Logistics',
      description: 'Fleet, drivers, and trips',
    },
    {
      companyId: itemba.id,
      code: 'ITEM-AGR',
      name: 'Agriculture',
      description: 'Farms and crop production',
    },
    {
      companyId: itemba.id,
      code: 'ITEM-CON',
      name: 'Construction',
      description: 'Construction projects and sites',
    },
    {
      companyId: itemba.id,
      code: 'ITEM-FIN',
      name: 'Finance',
      description: 'Finance and accounting',
    },
    {
      companyId: itemba.id,
      code: 'ITEM-ADM',
      name: 'Administration',
      description: 'General administration',
    },
  ];

  for (const d of deptDefs) {
    await prisma.department.upsert({
      where: { companyId_departmentCode: { companyId: d.companyId, departmentCode: d.code } },
      update: {},
      create: {
        departmentCode: d.code,
        companyId: d.companyId,
        name: d.name,
        description: d.description,
        status: DepartmentStatus.ACTIVE,
      },
    });
  }

  // ── Positions ───────────────────────────────────────────────────────────────
  const posDefs: {
    companyId: string;
    code: string;
    title: string;
    type: PositionType;
    salary: number;
  }[] = [
    // Mwanjalisi Oil positions
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-SM',
      title: 'Station Manager',
      type: PositionType.MANAGEMENT,
      salary: 1200000,
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-SS',
      title: 'Station Supervisor',
      type: PositionType.STATION_SUPERVISOR,
      salary: 800000,
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-PA',
      title: 'Pump Attendant',
      type: PositionType.PUMP_ATTENDANT,
      salary: 400000,
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-CA',
      title: 'Cashier',
      type: PositionType.CASHIER,
      salary: 450000,
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-ACC',
      title: 'Accountant',
      type: PositionType.FINANCE,
      salary: 900000,
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-SEC',
      title: 'Security Guard',
      type: PositionType.SECURITY,
      salary: 350000,
    },
    {
      companyId: mwanjalisi.id,
      code: 'MWAN-CLN',
      title: 'Cleaner',
      type: PositionType.CLEANER,
      salary: 280000,
    },
    // Westsides positions
    {
      companyId: westsides.id,
      code: 'WEST-SM',
      title: 'Sales Manager',
      type: PositionType.MANAGEMENT,
      salary: 1100000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-SLS',
      title: 'Sales Officer',
      type: PositionType.SALES,
      salary: 550000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-CA',
      title: 'Cashier',
      type: PositionType.CASHIER,
      salary: 450000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-WH',
      title: 'Warehouse Staff',
      type: PositionType.INVENTORY,
      salary: 400000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-REC',
      title: 'Receptionist',
      type: PositionType.RECEPTIONIST,
      salary: 500000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-HK',
      title: 'Housekeeper',
      type: PositionType.HOUSEKEEPER,
      salary: 320000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-WT',
      title: 'Waiter',
      type: PositionType.WAITER,
      salary: 330000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-CK',
      title: 'Cook',
      type: PositionType.COOK,
      salary: 480000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-BT',
      title: 'Bartender',
      type: PositionType.BARTENDER,
      salary: 380000,
    },
    {
      companyId: westsides.id,
      code: 'WEST-ACC',
      title: 'Accountant',
      type: PositionType.FINANCE,
      salary: 900000,
    },
    // Itemba Enterprises positions
    {
      companyId: itemba.id,
      code: 'ITEM-DR',
      title: 'Driver',
      type: PositionType.DRIVER,
      salary: 550000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-MEC',
      title: 'Mechanic',
      type: PositionType.MECHANIC,
      salary: 600000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-FW',
      title: 'Farm Worker',
      type: PositionType.FARM_WORKER,
      salary: 280000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-FSV',
      title: 'Farm Supervisor',
      type: PositionType.FARM_SUPERVISOR,
      salary: 650000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-SW',
      title: 'Site Worker',
      type: PositionType.SITE_WORKER,
      salary: 350000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-SSV',
      title: 'Site Supervisor',
      type: PositionType.SITE_SUPERVISOR,
      salary: 750000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-PM',
      title: 'Project Manager',
      type: PositionType.PROJECT_MANAGER,
      salary: 1500000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-MO',
      title: 'Machine Operator',
      type: PositionType.MACHINE_OPERATOR,
      salary: 500000,
    },
    {
      companyId: itemba.id,
      code: 'ITEM-ACC',
      title: 'Accountant',
      type: PositionType.FINANCE,
      salary: 900000,
    },
  ];

  for (const p of posDefs) {
    await prisma.position.upsert({
      where: { companyId_positionCode: { companyId: p.companyId, positionCode: p.code } },
      update: {},
      create: {
        positionCode: p.code,
        companyId: p.companyId,
        title: p.title,
        positionType: p.type,
        defaultSalary: p.salary,
        currency: 'TZS',
        status: PositionStatus.ACTIVE,
      },
    });
  }

  // ── Work Shifts ────────────────────────────────────────────────────────────
  const shiftDefs = [
    {
      code: 'DAY-SHIFT',
      name: 'Day Shift',
      type: ShiftType.DAY,
      start: '06:00',
      end: '14:00',
      hours: 8,
    },
    {
      code: 'NIGHT-SHIFT',
      name: 'Night Shift',
      type: ShiftType.NIGHT,
      start: '22:00',
      end: '06:00',
      hours: 8,
    },
    {
      code: 'MORNING',
      name: 'Morning Shift',
      type: ShiftType.MORNING,
      start: '08:00',
      end: '16:00',
      hours: 8,
    },
    {
      code: 'EVENING',
      name: 'Evening Shift',
      type: ShiftType.EVENING,
      start: '14:00',
      end: '22:00',
      hours: 8,
    },
  ];

  for (const company of [mwanjalisi, westsides, itemba]) {
    for (const s of shiftDefs) {
      const code = `${company.code}-${s.code}`;
      const existing = await prisma.workShift.findFirst({
        where: { companyId: company.id, shiftCode: code },
      });
      if (!existing) {
        await prisma.workShift.create({
          data: {
            shiftCode: code,
            companyId: company.id,
            name: s.name,
            shiftType: s.type,
            startTime: s.start,
            endTime: s.end,
            breakMinutes: 30,
            expectedHours: s.hours,
            isActive: true,
          },
        });
      }
    }
  }

  // ── Leave Types ────────────────────────────────────────────────────────────
  const leaveTypeDefs = [
    { code: 'ANNUAL', name: 'Annual Leave', paid: true, days: 28, carryForward: true },
    { code: 'SICK', name: 'Sick Leave', paid: true, days: 14, carryForward: false },
    { code: 'MATERNITY', name: 'Maternity Leave', paid: true, days: 84, carryForward: false },
    { code: 'UNPAID', name: 'Unpaid Leave', paid: false, days: null, carryForward: false },
    { code: 'EMERGENCY', name: 'Emergency Leave', paid: true, days: 3, carryForward: false },
  ];

  for (const company of [mwanjalisi, westsides, itemba]) {
    for (const lt of leaveTypeDefs) {
      const existing = await prisma.leaveType.findFirst({
        where: { companyId: company.id, code: lt.code },
      });
      if (!existing) {
        await prisma.leaveType.create({
          data: {
            companyId: company.id,
            name: lt.name,
            code: lt.code,
            paid: lt.paid,
            annualAllowanceDays: lt.days,
            carryForwardAllowed: lt.carryForward,
            isActive: true,
          },
        });
      }
    }
  }

  // ── Allowance Types ────────────────────────────────────────────────────────
  const allowanceTypeDefs = [
    { code: 'TRANSPORT', name: 'Transport Allowance', taxable: false, amount: 50000 },
    { code: 'HOUSING', name: 'Housing Allowance', taxable: false, amount: 100000 },
    { code: 'MEAL', name: 'Meal Allowance', taxable: false, amount: 30000 },
    { code: 'NIGHT', name: 'Night Shift Allowance', taxable: true, amount: 20000 },
    { code: 'OVERTIME', name: 'Overtime Allowance', taxable: true, amount: null },
    { code: 'DRIVER_ALW', name: 'Driver Allowance', taxable: false, amount: 80000 },
    // Petroleum sector — performance commission per litre dispensed by pump attendants.
    // Seeded for every company so the calculator never mistakenly classifies the
    // line as non-taxable; only Mwanjalisi will populate it via the petroleum
    // commission workflow in practice.
    { code: 'PETROLEUM_COMMISSION', name: 'Petroleum commission', taxable: true, amount: null },
    // Sales-rep commission paid out via payroll. Created from APPROVED
    // SalesCommission rows by the payroll calculator.
    { code: 'SALES_COMMISSION', name: 'Sales Commission', taxable: true, amount: null },
    // One-shot performance bonus paid out via payroll. Created when a
    // PerformanceRecord with a bonusAmount is APPROVED.
    { code: 'PERFORMANCE_BONUS', name: 'Performance Bonus', taxable: true, amount: null },
  ];

  for (const company of [mwanjalisi, westsides, itemba]) {
    for (const at of allowanceTypeDefs) {
      const existing = await prisma.allowanceType.findFirst({
        where: { companyId: company.id, code: at.code },
      });
      if (!existing) {
        await prisma.allowanceType.create({
          data: {
            companyId: company.id,
            name: at.name,
            code: at.code,
            taxable: at.taxable,
            recurring: true,
            defaultAmount: at.amount,
            isActive: true,
          },
        });
      }
    }
  }

  // ── Deduction Types ────────────────────────────────────────────────────────
  const deductionTypeDefs = [
    { code: 'PAYE', name: 'PAYE Tax', statutory: true, percentage: null, amount: null },
    { code: 'NSSF', name: 'NSSF Contribution', statutory: true, percentage: 10, amount: null },
    { code: 'NHIF', name: 'NHIF Contribution', statutory: true, percentage: null, amount: 10000 },
    {
      code: 'ADVANCE',
      name: 'Salary Advance Deduction',
      statutory: false,
      percentage: null,
      amount: null,
    },
    { code: 'LOAN', name: 'Loan Repayment', statutory: false, percentage: null, amount: null },
    {
      code: 'DAMAGE',
      name: 'Damage / Shortage Deduction',
      statutory: false,
      percentage: null,
      amount: null,
    },
    // One-shot deduction created when a disciplinary action with a
    // fineAmount is applied. The disciplinary service tags each
    // EmployeeDeduction with this code so payroll picks it up like any
    // other non-statutory deduction.
    {
      code: 'DISCIPLINARY',
      name: 'Disciplinary Fine',
      statutory: false,
      percentage: null,
      amount: null,
    },
  ];

  for (const company of [mwanjalisi, westsides, itemba]) {
    for (const dt of deductionTypeDefs) {
      const existing = await prisma.deductionType.findFirst({
        where: { companyId: company.id, code: dt.code },
      });
      if (!existing) {
        await prisma.deductionType.create({
          data: {
            companyId: company.id,
            name: dt.name,
            code: dt.code,
            statutory: dt.statutory,
            recurring: dt.statutory,
            defaultAmount: dt.amount,
            defaultPercentage: dt.percentage,
            isActive: true,
          },
        });
      }
    }
  }

  // ── Payroll Periods ────────────────────────────────────────────────────────
  // Seed monthly periods for the current and previous quarter so operators can
  // create payroll runs immediately. PayrollRun has a required FK to
  // PayrollPeriod — without these rows, the calculator can't run at all.
  // Each period is OPEN; pay-day is the 28th to match Tanzania convention.
  const today = new Date();
  const periodsToSeed: Array<{ year: number; month: number }> = [];
  for (let i = 3; i >= -1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    periodsToSeed.push({ year: d.getFullYear(), month: d.getMonth() });
  }

  for (const company of [mwanjalisi, westsides, itemba]) {
    for (const p of periodsToSeed) {
      const monthStr = String(p.month + 1).padStart(2, '0');
      const code = `${p.year}-${monthStr}`;
      const startDate = new Date(p.year, p.month, 1);
      const endDate = new Date(p.year, p.month + 1, 0); // last day of month
      const paymentDate = new Date(p.year, p.month, 28);
      const monthName = startDate.toLocaleString('en-US', { month: 'long' });

      const existing = await prisma.payrollPeriod.findFirst({
        where: { companyId: company.id, payrollPeriodCode: code },
      });
      if (!existing) {
        await prisma.payrollPeriod.create({
          data: {
            companyId: company.id,
            payrollPeriodCode: code,
            name: `${monthName} ${p.year}`,
            startDate,
            endDate,
            paymentDate,
            status: 'OPEN',
            createdById: adminUser.id,
          },
        });
      }
    }
  }

  // ── Demo Employees ─────────────────────────────────────────────────────────
  const mwanPAPos = await prisma.position.findFirst({
    where: { companyId: mwanjalisi.id, positionCode: 'MWAN-PA' },
  });
  const mwanSSPos = await prisma.position.findFirst({
    where: { companyId: mwanjalisi.id, positionCode: 'MWAN-SS' },
  });
  const mwanOpsDept = await prisma.department.findFirst({
    where: { companyId: mwanjalisi.id, departmentCode: 'MWAN-OPS' },
  });

  const westRecPos = await prisma.position.findFirst({
    where: { companyId: westsides.id, positionCode: 'WEST-REC' },
  });
  const westHospDept = await prisma.department.findFirst({
    where: { companyId: westsides.id, departmentCode: 'WEST-HOSP' },
  });

  const itemDrPos = await prisma.position.findFirst({
    where: { companyId: itemba.id, positionCode: 'ITEM-DR' },
  });
  const itemLogDept = await prisma.department.findFirst({
    where: { companyId: itemba.id, departmentCode: 'ITEM-LOG' },
  });

  const employeeDefs = [
    {
      code: 'MWAN-EMP-001',
      companyId: mwanjalisi.id,
      firstName: 'Amina',
      lastName: 'Hamisi',
      fullName: 'Amina Hamisi',
      gender: Gender.FEMALE,
      positionId: mwanPAPos?.id,
      departmentId: mwanOpsDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 400000,
    },
    {
      code: 'MWAN-EMP-002',
      companyId: mwanjalisi.id,
      firstName: 'Juma',
      lastName: 'Bakari',
      fullName: 'Juma Bakari',
      gender: Gender.MALE,
      positionId: mwanSSPos?.id,
      departmentId: mwanOpsDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 800000,
    },
    {
      code: 'MWAN-EMP-003',
      companyId: mwanjalisi.id,
      firstName: 'Hassan',
      lastName: 'Omar',
      fullName: 'Hassan Omar',
      gender: Gender.MALE,
      positionId: mwanPAPos?.id,
      departmentId: mwanOpsDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 400000,
    },
    {
      code: 'WEST-EMP-001',
      companyId: westsides.id,
      firstName: 'Fatuma',
      lastName: 'Salim',
      fullName: 'Fatuma Salim',
      gender: Gender.FEMALE,
      positionId: westRecPos?.id,
      departmentId: westHospDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 500000,
    },
    {
      code: 'WEST-EMP-002',
      companyId: westsides.id,
      firstName: 'Maria',
      lastName: 'Nguyen',
      fullName: 'Maria Nguyen',
      gender: Gender.FEMALE,
      positionId: westRecPos?.id,
      departmentId: westHospDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 500000,
    },
    {
      code: 'ITEM-EMP-001',
      companyId: itemba.id,
      firstName: 'Rashid',
      lastName: 'Mwenda',
      fullName: 'Rashid Mwenda',
      gender: Gender.MALE,
      positionId: itemDrPos?.id,
      departmentId: itemLogDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 550000,
    },
    {
      code: 'ITEM-EMP-002',
      companyId: itemba.id,
      firstName: 'Athumani',
      lastName: 'Juma',
      fullName: 'Athumani Juma',
      gender: Gender.MALE,
      positionId: itemDrPos?.id,
      departmentId: itemLogDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 550000,
    },
    {
      code: 'ITEM-EMP-003',
      companyId: itemba.id,
      firstName: 'Rehema',
      lastName: 'Ally',
      fullName: 'Rehema Ally',
      gender: Gender.FEMALE,
      positionId: itemDrPos?.id,
      departmentId: itemLogDept?.id,
      employmentType: EmploymentType.FULL_TIME,
      baseSalary: 550000,
    },
  ];

  for (const emp of employeeDefs) {
    const existing = await prisma.employee.findFirst({
      where: { companyId: emp.companyId, employeeCode: emp.code },
    });
    if (!existing) {
      await prisma.employee.create({
        data: {
          employeeCode: emp.code,
          companyId: emp.companyId,
          firstName: emp.firstName,
          lastName: emp.lastName,
          fullName: emp.fullName,
          gender: emp.gender,
          positionId: emp.positionId,
          departmentId: emp.departmentId,
          employmentType: emp.employmentType,
          employmentStatus: EmploymentStatus.ACTIVE,
          hireDate: new Date('2023-01-01'),
          baseSalary: emp.baseSalary,
          salaryCurrency: 'TZS',
          paymentFrequency: HRPaymentFrequency.MONTHLY,
        },
      });
    }
  }

  console.log('      Milestone 9 seed complete.');
}

// ─────────────────────────────────────────────────────────────────────────────
// MILESTONE 10 — Tax, Compliance, Regulatory Reporting
// ─────────────────────────────────────────────────────────────────────────────

async function seedM10() {
  // Get companies for reference
  const mwanjalisi = await prisma.company.findUniqueOrThrow({ where: { code: 'MWANJALISI' } });
  const itemba = await prisma.company.findUniqueOrThrow({ where: { code: 'ITEMBA_ENT' } });
  const westsides = await prisma.company.findUniqueOrThrow({ where: { code: 'WESTSIDES' } });
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });

  // ── Tax Authorities ─────────────────────────────────────────────────────
  const authDefs = [
    {
      authorityCode: 'TRA-TZ',
      name: 'Tanzania Revenue Authority',
      country: 'Tanzania',
      region: 'National',
      authorityType: TaxAuthorityType.TAX,
      website: 'https://www.tra.go.tz',
      contactEmail: 'info@tra.go.tz',
      status: TaxAuthorityStatus.ACTIVE,
    },
    {
      authorityCode: 'BRELA-TZ',
      name: 'Business Registrations and Licensing Agency',
      country: 'Tanzania',
      region: 'National',
      authorityType: TaxAuthorityType.COMPANY_REGISTRY,
      website: 'https://www.brela.go.tz',
      contactEmail: 'info@brela.go.tz',
      status: TaxAuthorityStatus.ACTIVE,
    },
    {
      authorityCode: 'DCC-DAR',
      name: 'Dar es Salaam City Council',
      country: 'Tanzania',
      region: 'Dar es Salaam',
      authorityType: TaxAuthorityType.LOCAL_GOVERNMENT,
      status: TaxAuthorityStatus.ACTIVE,
    },
    {
      authorityCode: 'NSSF-TZ',
      name: 'National Social Security Fund',
      country: 'Tanzania',
      region: 'National',
      authorityType: TaxAuthorityType.SOCIAL_SECURITY,
      website: 'https://www.nssf.or.tz',
      contactEmail: 'info@nssf.or.tz',
      status: TaxAuthorityStatus.ACTIVE,
    },
    {
      authorityCode: 'NHIF-TZ',
      name: 'National Health Insurance Fund',
      country: 'Tanzania',
      region: 'National',
      authorityType: TaxAuthorityType.HEALTH_INSURANCE,
      website: 'https://www.nhif.or.tz',
      contactEmail: 'info@nhif.or.tz',
      status: TaxAuthorityStatus.ACTIVE,
    },
  ];
  const authorityMap: Record<string, string> = {};
  for (const a of authDefs) {
    const auth = await prisma.taxAuthority.upsert({
      where: { authorityCode: a.authorityCode },
      update: {},
      create: a,
    });
    authorityMap[a.authorityCode] = auth.id;
  }

  // ── Tax Types ────────────────────────────────────────────────────────────
  const taxTypeDefs = [
    {
      code: 'VAT-18',
      name: 'Value Added Tax (18%)',
      category: TaxCategory.VAT,
      isRecoverable: true,
      appliesToSales: true,
      appliesToPurchases: true,
    },
    {
      code: 'WHT-5',
      name: 'Withholding Tax (5%)',
      category: TaxCategory.WITHHOLDING_TAX,
      isWithholding: true,
      appliesToPurchases: true,
      appliesToExpenses: true,
    },
    {
      code: 'WHT-10',
      name: 'Withholding Tax (10%)',
      category: TaxCategory.WITHHOLDING_TAX,
      isWithholding: true,
      appliesToPurchases: true,
      appliesToExpenses: true,
    },
    {
      code: 'PAYE',
      name: 'Pay As You Earn',
      category: TaxCategory.PAYROLL_TAX,
      appliesToPayroll: true,
    },
    {
      code: 'SDL',
      name: 'Skills Development Levy',
      category: TaxCategory.SERVICE_LEVY,
      appliesToPayroll: true,
    },
    {
      code: 'NSSF',
      name: 'NSSF Contributions',
      category: TaxCategory.OTHER,
      appliesToPayroll: true,
    },
    {
      code: 'NHIF',
      name: 'NHIF Contributions',
      category: TaxCategory.OTHER,
      appliesToPayroll: true,
    },
    {
      code: 'EXCISE',
      name: 'Excise Duty',
      category: TaxCategory.EXCISE,
      appliesToSales: true,
      appliesToPurchases: true,
    },
  ];
  const taxTypeMap: Record<string, string> = {};
  for (const t of taxTypeDefs) {
    const tt = await prisma.taxType.upsert({
      where: { taxTypeCode: t.code },
      update: {},
      create: {
        taxTypeCode: t.code,
        name: t.name,
        taxCategory: t.category,
        isRecoverable: t.isRecoverable ?? false,
        isWithholding: t.isWithholding ?? false,
        appliesToSales: t.appliesToSales ?? false,
        appliesToPurchases: t.appliesToPurchases ?? false,
        appliesToPayroll: t.appliesToPayroll ?? false,
        appliesToExpenses: t.appliesToExpenses ?? false,
        status: TaxCodeStatus.ACTIVE,
      },
    });
    taxTypeMap[t.code] = tt.id;
  }

  // ── Tax Rates ──────────────────────────────────────────────────────────
  const rateDefs = [
    {
      taxTypeCode: 'VAT-18',
      rateName: 'Standard VAT Rate 18%',
      rate: 18.0,
      method: TaxRateCalculationMethod.PERCENTAGE,
    },
    {
      taxTypeCode: 'WHT-5',
      rateName: 'WHT 5% Services',
      rate: 5.0,
      method: TaxRateCalculationMethod.PERCENTAGE,
    },
    {
      taxTypeCode: 'WHT-10',
      rateName: 'WHT 10% Technical',
      rate: 10.0,
      method: TaxRateCalculationMethod.PERCENTAGE,
    },
    {
      taxTypeCode: 'SDL',
      rateName: 'SDL 3.5%',
      rate: 3.5,
      method: TaxRateCalculationMethod.PERCENTAGE,
    },
    {
      taxTypeCode: 'NSSF',
      rateName: 'NSSF 10% Employee',
      rate: 10.0,
      method: TaxRateCalculationMethod.PERCENTAGE,
    },
    {
      taxTypeCode: 'NHIF',
      rateName: 'NHIF 3% Employee',
      rate: 3.0,
      method: TaxRateCalculationMethod.PERCENTAGE,
    },
  ];
  for (const r of rateDefs) {
    const existing = await prisma.taxRate.findFirst({
      where: { taxTypeId: taxTypeMap[r.taxTypeCode], rateName: r.rateName, deletedAt: null },
    });
    if (!existing) {
      await prisma.taxRate.create({
        data: {
          taxTypeId: taxTypeMap[r.taxTypeCode],
          rateName: r.rateName,
          rate: r.rate,
          calculationMethod: r.method,
          effectiveFrom: new Date('2024-01-01'),
          status: TaxRateStatus.ACTIVE,
          createdById: admin.id,
          approvedById: admin.id,
          approvedAt: new Date('2024-01-01'),
        },
      });
    }
  }

  // ── Tax Codes ───────────────────────────────────────────────────────────
  const codeDefs = [
    {
      code: 'OUT-VAT-18',
      name: 'Output VAT 18%',
      taxTypeCode: 'VAT-18',
      appliesTo: TaxCodeAppliesTo.SALES,
      isDefault: true,
    },
    {
      code: 'IN-VAT-18',
      name: 'Input VAT 18%',
      taxTypeCode: 'VAT-18',
      appliesTo: TaxCodeAppliesTo.PURCHASES,
      isDefault: true,
    },
    {
      code: 'WHT-SVC',
      name: 'WHT 5% Services',
      taxTypeCode: 'WHT-5',
      appliesTo: TaxCodeAppliesTo.EXPENSES,
    },
    {
      code: 'WHT-TECH',
      name: 'WHT 10% Technical',
      taxTypeCode: 'WHT-10',
      appliesTo: TaxCodeAppliesTo.EXPENSES,
    },
  ];
  for (const c of codeDefs) {
    const existing = await prisma.taxCode.findFirst({
      where: { taxCode: c.code, companyId: null, deletedAt: null },
    });
    if (!existing) {
      await prisma.taxCode.create({
        data: {
          taxCode: c.code,
          name: c.name,
          taxTypeId: taxTypeMap[c.taxTypeCode],
          appliesTo: c.appliesTo,
          isDefault: c.isDefault ?? false,
          status: TaxCodeStatus.ACTIVE,
        },
      });
    }
  }

  // ── Company Tax Registrations ────────────────────────────────────────────
  const regDefs = [
    // Mwanjalisi
    {
      company: mwanjalisi,
      code: 'MWAN-TIN',
      type: TaxRegistrationType.TIN,
      number: '100-123-456',
      authCode: 'TRA-TZ',
    },
    {
      company: mwanjalisi,
      code: 'MWAN-VRN',
      type: TaxRegistrationType.VRN,
      number: 'TZ-100-123456-V',
      authCode: 'TRA-TZ',
    },
    {
      company: mwanjalisi,
      code: 'MWAN-PAYE',
      type: TaxRegistrationType.PAYE,
      number: 'PAYE-MWAN-001',
      authCode: 'TRA-TZ',
    },
    // Itemba Enterprises
    {
      company: itemba,
      code: 'ITEM-TIN',
      type: TaxRegistrationType.TIN,
      number: '100-234-567',
      authCode: 'TRA-TZ',
    },
    {
      company: itemba,
      code: 'ITEM-VRN',
      type: TaxRegistrationType.VRN,
      number: 'TZ-100-234567-V',
      authCode: 'TRA-TZ',
    },
    {
      company: itemba,
      code: 'ITEM-PAYE',
      type: TaxRegistrationType.PAYE,
      number: 'PAYE-ITEM-001',
      authCode: 'TRA-TZ',
    },
    // Westsides
    {
      company: westsides,
      code: 'WEST-TIN',
      type: TaxRegistrationType.TIN,
      number: '100-345-678',
      authCode: 'TRA-TZ',
    },
    {
      company: westsides,
      code: 'WEST-VRN',
      type: TaxRegistrationType.VRN,
      number: 'TZ-100-345678-V',
      authCode: 'TRA-TZ',
    },
    {
      company: westsides,
      code: 'WEST-PAYE',
      type: TaxRegistrationType.PAYE,
      number: 'PAYE-WEST-001',
      authCode: 'TRA-TZ',
    },
  ];
  for (const r of regDefs) {
    await prisma.companyTaxRegistration.upsert({
      where: { companyId_registrationCode: { companyId: r.company.id, registrationCode: r.code } },
      update: {},
      create: {
        registrationCode: r.code,
        companyId: r.company.id,
        authorityId: authorityMap[r.authCode],
        registrationType: r.type,
        registrationNumber: r.number,
        registeredName: r.company.name,
        status: TaxRegistrationStatus.ACTIVE,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
  }

  // ── Statutory Deduction Rules ────────────────────────────────────────────
  const statutoryDefs = [
    {
      code: 'NSSF-EMP',
      name: 'NSSF Employee Contribution 10%',
      taxCode: 'NSSF',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      empRate: 10.0,
      emplRate: 10.0,
    },
    {
      code: 'NHIF-EMP',
      name: 'NHIF Employee Contribution 3%',
      taxCode: 'NHIF',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      empRate: 3.0,
      emplRate: 3.0,
    },
    {
      code: 'SDL-EMPL',
      name: 'SDL Employer Levy 3.5%',
      taxCode: 'SDL',
      method: StatutoryDeductionCalcMethod.PERCENTAGE_OF_GROSS,
      empRate: null,
      emplRate: 3.5,
    },
  ];
  for (const s of statutoryDefs) {
    await prisma.statutoryDeductionRule.upsert({
      where: { ruleCode: s.code },
      update: {},
      create: {
        ruleCode: s.code,
        name: s.name,
        taxTypeId: taxTypeMap[s.taxCode],
        calculationMethod: s.method,
        employeeContributionRate: s.empRate,
        employerContributionRate: s.emplRate,
        effectiveFrom: new Date('2024-01-01'),
        status: StatutoryDeductionStatus.ACTIVE,
      },
    });
  }

  // ── Compliance Document Requirements ────────────────────────────────────
  const docReqDefs = [
    {
      code: 'CDR-001',
      type: ComplianceDocReqType.COMPANY,
      title: 'BRELA Certificate of Incorporation',
      required: true,
    },
    {
      code: 'CDR-002',
      type: ComplianceDocReqType.TAX,
      title: 'TRA TIN Certificate',
      required: true,
    },
    {
      code: 'CDR-003',
      type: ComplianceDocReqType.TAX,
      title: 'TRA VRN Certificate',
      required: true,
    },
    {
      code: 'CDR-004',
      type: ComplianceDocReqType.LICENSE,
      title: 'Business License (Annual)',
      required: true,
      expiryRequired: true,
      renewalRequired: true,
    },
    {
      code: 'CDR-005',
      type: ComplianceDocReqType.COMPANY,
      title: 'BRELA Annual Return',
      required: true,
      renewalRequired: true,
    },
    {
      code: 'CDR-006',
      type: ComplianceDocReqType.HR,
      title: 'NSSF Registration Certificate',
      required: true,
    },
    {
      code: 'CDR-007',
      type: ComplianceDocReqType.HR,
      title: 'NHIF Registration Certificate',
      required: true,
    },
    {
      code: 'CDR-008',
      type: ComplianceDocReqType.VEHICLE,
      title: 'Vehicle Registration Certificate',
      required: true,
      expiryRequired: true,
      renewalRequired: true,
    },
    {
      code: 'CDR-009',
      type: ComplianceDocReqType.LICENSE,
      title: 'Health Permit (Annual)',
      required: true,
      expiryRequired: true,
      renewalRequired: true,
    },
    {
      code: 'CDR-010',
      type: ComplianceDocReqType.LICENSE,
      title: 'Fire Safety Certificate',
      required: true,
      expiryRequired: true,
      renewalRequired: true,
    },
  ];
  for (const d of docReqDefs) {
    const existing = await prisma.complianceDocumentRequirement.findFirst({
      where: { requirementCode: d.code, companyId: null, deletedAt: null },
    });
    if (!existing) {
      await prisma.complianceDocumentRequirement.create({
        data: {
          requirementCode: d.code,
          requirementType: d.type,
          title: d.title,
          required: d.required,
          expiryRequired: d.expiryRequired ?? false,
          renewalRequired: d.renewalRequired ?? false,
          status: TaxCodeStatus.ACTIVE,
        },
      });
    }
  }

  // ── Compliance Obligations (sample) ──────────────────────────────────────
  const now = new Date();
  const obligDefs = [
    {
      company: mwanjalisi,
      code: 'OBL-MWAN-001',
      type: ComplianceObligationType.BRELA_ANNUAL_RETURN,
      title: 'BRELA Annual Return 2025',
      dueDate: new Date('2025-06-30'),
      priority: CompliancePriority.HIGH,
    },
    {
      company: mwanjalisi,
      code: 'OBL-MWAN-002',
      type: ComplianceObligationType.BUSINESS_LICENSE_RENEWAL,
      title: 'Business License Renewal 2025',
      dueDate: new Date('2025-12-31'),
      priority: CompliancePriority.CRITICAL,
    },
    {
      company: itemba,
      code: 'OBL-ITEM-001',
      type: ComplianceObligationType.BRELA_ANNUAL_RETURN,
      title: 'BRELA Annual Return 2025',
      dueDate: new Date('2025-06-30'),
      priority: CompliancePriority.HIGH,
    },
    {
      company: westsides,
      code: 'OBL-WEST-001',
      type: ComplianceObligationType.BRELA_ANNUAL_RETURN,
      title: 'BRELA Annual Return 2025',
      dueDate: new Date('2025-06-30'),
      priority: CompliancePriority.HIGH,
    },
    {
      company: westsides,
      code: 'OBL-WEST-002',
      type: ComplianceObligationType.BUSINESS_LICENSE_RENEWAL,
      title: 'Business License Renewal 2025',
      dueDate: new Date('2025-12-31'),
      priority: CompliancePriority.CRITICAL,
    },
  ];
  for (const o of obligDefs) {
    await prisma.complianceObligation.upsert({
      where: { companyId_obligationCode: { companyId: o.company.id, obligationCode: o.code } },
      update: {},
      create: {
        obligationCode: o.code,
        companyId: o.company.id,
        obligationType: o.type,
        title: o.title,
        dueDate: o.dueDate,
        recurrence: ComplianceObligationRecurrence.ANNUAL,
        priority: o.priority,
        status:
          o.dueDate < now
            ? ComplianceObligationStatus.OVERDUE
            : ComplianceObligationStatus.UPCOMING,
        responsibleUserId: admin.id,
      },
    });
  }

  // ── Audit Evidence Packs (sample) ────────────────────────────────────────
  const packDefs = [
    {
      company: mwanjalisi,
      packNum: 'AEP-MWAN-2024-001',
      title: 'Financial Audit Pack 2024',
      type: AuditEvidencePackType.FINANCIAL_AUDIT,
    },
    {
      company: westsides,
      packNum: 'AEP-WEST-2024-001',
      title: 'Tax Compliance Pack 2024',
      type: AuditEvidencePackType.TAX_AUDIT,
    },
    {
      company: itemba,
      packNum: 'AEP-ITEM-2024-001',
      title: 'Internal Audit Pack 2024',
      type: AuditEvidencePackType.INTERNAL_AUDIT,
    },
  ];
  for (const p of packDefs) {
    await prisma.auditEvidencePack.upsert({
      where: {
        companyId_evidencePackNumber: { companyId: p.company.id, evidencePackNumber: p.packNum },
      },
      update: {},
      create: {
        evidencePackNumber: p.packNum,
        companyId: p.company.id,
        title: p.title,
        packType: p.type,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-12-31'),
        status: AuditEvidencePackStatus.DRAFT,
        preparedById: admin.id,
      },
    });
  }

  console.log('      Milestone 10 seed complete.');
}

// ─────────────────────────────────────────────────────────────────────────────
// MILESTONE 11 — Approval Workflows, Notifications, Alerts, Internal Controls, Tasks
// ─────────────────────────────────────────────────────────────────────────────
async function seedM11() {
  console.log('Seeding M11: Approval Workflows, Notifications, Alerts, Internal Controls...');

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const superAdmin = await prisma.user.findFirst({ where: { email: adminEmail } });
  const mwanjalisi = await prisma.company.findFirst({ where: { code: 'MWANJALISI' } });
  const westsides = await prisma.company.findFirst({ where: { code: 'WESTSIDES' } });
  const itembaEnt = await prisma.company.findFirst({ where: { code: 'ITEMBA_ENT' } });

  if (!superAdmin) {
    console.log('No superAdmin found, skipping M11 seed');
    return;
  }

  // === PERMISSIONS ===
  const m11Permissions = [
    // Approvals Dashboard
    {
      code: 'approvals.dashboard.view',
      description: 'View approvals dashboard',
      module: 'approvals',
      action: 'dashboard.view',
      isGroupControl: false,
    },
    // Approval Workflows
    {
      code: 'approval_workflows.view',
      description: 'View approval workflows',
      module: 'approval_workflows',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'approval_workflows.manage',
      description: 'Manage approval workflows',
      module: 'approval_workflows',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'approval_steps.view',
      description: 'View approval steps',
      module: 'approval_steps',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'approval_steps.manage',
      description: 'Manage approval steps',
      module: 'approval_steps',
      action: 'manage',
      isGroupControl: false,
    },
    // Approval Requests
    {
      code: 'approval_requests.view',
      description: 'View approval requests',
      module: 'approval_requests',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'approval_requests.create',
      description: 'Create approval requests',
      module: 'approval_requests',
      action: 'create',
      isGroupControl: false,
    },
    {
      code: 'approval_requests.approve',
      description: 'Approve approval requests',
      module: 'approval_requests',
      action: 'approve',
      isGroupControl: false,
    },
    {
      code: 'approval_requests.reject',
      description: 'Reject approval requests',
      module: 'approval_requests',
      action: 'reject',
      isGroupControl: false,
    },
    {
      code: 'approval_requests.cancel',
      description: 'Cancel approval requests',
      module: 'approval_requests',
      action: 'cancel',
      isGroupControl: false,
    },
    {
      code: 'approval_requests.escalate',
      description: 'Escalate approval requests',
      module: 'approval_requests',
      action: 'escalate',
      isGroupControl: false,
    },
    // Delegations & Attachments
    {
      code: 'approval_delegations.view',
      description: 'View approval delegations',
      module: 'approval_delegations',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'approval_delegations.manage',
      description: 'Manage approval delegations',
      module: 'approval_delegations',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'approval_attachments.view',
      description: 'View approval attachments',
      module: 'approval_attachments',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'approval_attachments.manage',
      description: 'Manage approval attachments',
      module: 'approval_attachments',
      action: 'manage',
      isGroupControl: false,
    },
    // Notifications & Alerts
    {
      code: 'notifications.view',
      description: 'View notifications',
      module: 'notifications',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'notifications.manage',
      description: 'Manage notifications',
      module: 'notifications',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'notifications.send',
      description: 'Send notifications',
      module: 'notifications',
      action: 'send',
      isGroupControl: false,
    },
    {
      code: 'alert_rules.view',
      description: 'View alert rules',
      module: 'alert_rules',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'alert_rules.manage',
      description: 'Manage alert rules',
      module: 'alert_rules',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'alert_events.view',
      description: 'View alert events',
      module: 'alert_events',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'alert_events.acknowledge',
      description: 'Acknowledge alert events',
      module: 'alert_events',
      action: 'acknowledge',
      isGroupControl: false,
    },
    {
      code: 'alert_events.resolve',
      description: 'Resolve alert events',
      module: 'alert_events',
      action: 'resolve',
      isGroupControl: false,
    },
    {
      code: 'alert_events.dismiss',
      description: 'Dismiss alert events',
      module: 'alert_events',
      action: 'dismiss',
      isGroupControl: false,
    },
    // Tasks
    {
      code: 'tasks.view',
      description: 'View tasks',
      module: 'tasks',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'tasks.create',
      description: 'Create tasks',
      module: 'tasks',
      action: 'create',
      isGroupControl: false,
    },
    {
      code: 'tasks.update',
      description: 'Update tasks',
      module: 'tasks',
      action: 'update',
      isGroupControl: false,
    },
    {
      code: 'tasks.complete',
      description: 'Complete tasks',
      module: 'tasks',
      action: 'complete',
      isGroupControl: false,
    },
    {
      code: 'tasks.cancel',
      description: 'Cancel tasks',
      module: 'tasks',
      action: 'cancel',
      isGroupControl: false,
    },
    // Internal Controls
    {
      code: 'internal_controls.view',
      description: 'View internal controls',
      module: 'internal_controls',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'internal_controls.manage',
      description: 'Manage internal controls',
      module: 'internal_controls',
      action: 'manage',
      isGroupControl: true,
    },
    {
      code: 'internal_controls.override',
      description: 'Override internal controls',
      module: 'internal_controls',
      action: 'override',
      isGroupControl: true,
    },
    {
      code: 'sensitive_action.override',
      description: 'Override sensitive actions',
      module: 'sensitive_action',
      action: 'override',
      isGroupControl: true,
    },
    {
      code: 'maker_checker.override',
      description: 'Override maker-checker controls',
      module: 'maker_checker',
      action: 'override',
      isGroupControl: true,
    },
  ];

  for (const perm of m11Permissions) {
    await prisma.permission.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }
  console.log(`Seeded ${m11Permissions.length} M11 permissions`);

  // === APPROVAL WORKFLOWS ===
  const workflowsData = [
    {
      workflowCode: 'WF-EXPENSE-GLOBAL',
      name: 'Expense Approval Workflow',
      description: 'Requires approval for expenses above TZS 500,000',
      entityType: 'Expense',
      workflowScope: WorkflowScope.GLOBAL,
      triggerAction: WorkflowTriggerAction.SUBMIT,
      minAmount: 500000,
      currency: 'TZS',
      isActive: true,
      priority: 10,
      createdById: superAdmin.id,
    },
    {
      workflowCode: 'WF-PO-GLOBAL',
      name: 'Purchase Order Approval Workflow',
      description: 'Requires approval for all purchase orders',
      entityType: 'PurchaseOrder',
      workflowScope: WorkflowScope.GLOBAL,
      triggerAction: WorkflowTriggerAction.SUBMIT,
      isActive: true,
      priority: 10,
      createdById: superAdmin.id,
    },
    {
      workflowCode: 'WF-PAYROLL-GLOBAL',
      name: 'Payroll Run Approval Workflow',
      description: 'Requires Finance Controller and Director approval for payroll runs',
      entityType: 'PayrollRun',
      workflowScope: WorkflowScope.GLOBAL,
      triggerAction: WorkflowTriggerAction.POST,
      isActive: true,
      priority: 20,
      createdById: superAdmin.id,
    },
    {
      workflowCode: 'WF-TAX-GLOBAL',
      name: 'Tax Return Approval Workflow',
      description: 'Requires compliance officer and director approval for tax returns',
      entityType: 'TaxReturn',
      workflowScope: WorkflowScope.GLOBAL,
      triggerAction: WorkflowTriggerAction.SUBMIT,
      isActive: true,
      priority: 20,
      createdById: superAdmin.id,
    },
    {
      workflowCode: 'WF-EXPORT-GLOBAL',
      name: 'Data Export Approval Workflow',
      description: 'Sensitive data exports require Group Control approval',
      entityType: 'DataExport',
      workflowScope: WorkflowScope.GLOBAL,
      triggerAction: WorkflowTriggerAction.EXPORT,
      isActive: true,
      priority: 30,
      createdById: superAdmin.id,
    },
  ];

  for (const wf of workflowsData) {
    const existing = await prisma.approvalWorkflow.findFirst({
      where: { workflowCode: wf.workflowCode },
    });
    if (!existing) {
      await prisma.approvalWorkflow.create({ data: wf });
    }
  }
  console.log(`Seeded ${workflowsData.length} approval workflows`);

  // === ALERT RULES ===
  const alertRulesData = [
    {
      alertRuleCode: 'AR-BIZ-LICENSE-EXPIRY',
      name: 'Business License Expiry Alert',
      description: 'Alert 30 days before business license expiry',
      alertType: AlertType.LICENSE_EXPIRY,
      condition: { entity: 'BusinessLicense', field: 'expiryDate' },
      daysBefore: 30,
      priority: NotificationPriority.HIGH,
      recipientType: AlertRecipientType.ROLE,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-DOC-EXPIRY',
      name: 'Document Expiry Alert',
      description: 'Alert 14 days before document expiry',
      alertType: AlertType.DOCUMENT_EXPIRY,
      condition: { entity: 'Document', field: 'expiryDate' },
      daysBefore: 14,
      priority: NotificationPriority.NORMAL,
      recipientType: AlertRecipientType.MANAGER,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-CONTRACT-EXPIRY',
      name: 'Contract Expiry Alert',
      description: 'Alert 30 days before contract expiry',
      alertType: AlertType.CONTRACT_EXPIRY,
      condition: { entity: 'Contract', field: 'expiryDate' },
      daysBefore: 30,
      priority: NotificationPriority.HIGH,
      recipientType: AlertRecipientType.GROUP_CONTROL,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-COMPLIANCE-OVERDUE',
      name: 'Compliance Obligation Overdue',
      description: 'Alert when compliance obligation is overdue',
      alertType: AlertType.COMPLIANCE_DUE,
      condition: { entity: 'ComplianceObligation', field: 'dueDate', operator: 'past' },
      daysBefore: 7,
      priority: NotificationPriority.CRITICAL,
      recipientType: AlertRecipientType.ROLE,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-TAX-FILING-DUE',
      name: 'Tax Filing Due Alert',
      description: 'Alert 7 days before tax filing deadline',
      alertType: AlertType.TAX_FILING_DUE,
      condition: { entity: 'TaxObligation', field: 'dueDate' },
      daysBefore: 7,
      priority: NotificationPriority.CRITICAL,
      recipientType: AlertRecipientType.ROLE,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-LOW-STOCK',
      name: 'Low Stock Alert',
      description: 'Alert when inventory balance drops below minimum',
      alertType: AlertType.LOW_STOCK,
      condition: { entity: 'InventoryBalance', field: 'quantity', operator: 'below_min' },
      priority: NotificationPriority.HIGH,
      recipientType: AlertRecipientType.MANAGER,
      frequency: AlertFrequency.IMMEDIATE,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-FUEL-LOW-STOCK',
      name: 'Fuel Low Stock Alert',
      description: 'Alert when fuel tank drops below threshold',
      alertType: AlertType.FUEL_LOW_STOCK,
      condition: { entity: 'FuelTank', field: 'currentVolume', operator: 'below_threshold' },
      thresholdQuantity: 5000,
      priority: NotificationPriority.HIGH,
      recipientType: AlertRecipientType.MANAGER,
      frequency: AlertFrequency.IMMEDIATE,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-RENT-ARREARS',
      name: 'Rent Arrears Alert',
      description: 'Alert when tenant has overdue rent',
      alertType: AlertType.RENT_ARREARS,
      condition: { entity: 'LeaseAgreement', operator: 'overdue' },
      daysBefore: 0,
      priority: NotificationPriority.HIGH,
      recipientType: AlertRecipientType.MANAGER,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-PAYROLL-PENDING',
      name: 'Payroll Pending Alert',
      description: 'Alert when payroll run is pending approval',
      alertType: AlertType.PAYROLL_PENDING,
      condition: { entity: 'PayrollRun', field: 'status', value: 'PENDING_APPROVAL' },
      priority: NotificationPriority.HIGH,
      recipientType: AlertRecipientType.ROLE,
      frequency: AlertFrequency.IMMEDIATE,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      alertRuleCode: 'AR-LOAN-REPAYMENT',
      name: 'Loan Repayment Due Alert',
      description: 'Alert 7 days before loan repayment due date',
      alertType: AlertType.LOAN_REPAYMENT_DUE,
      condition: { entity: 'Loan', field: 'nextRepaymentDate' },
      daysBefore: 7,
      priority: NotificationPriority.CRITICAL,
      recipientType: AlertRecipientType.GROUP_CONTROL,
      frequency: AlertFrequency.DAILY,
      isActive: true,
      createdById: superAdmin.id,
    },
  ];

  for (const rule of alertRulesData) {
    await prisma.alertRule.upsert({
      where: { alertRuleCode: rule.alertRuleCode },
      update: {},
      create: rule,
    });
  }
  console.log(`Seeded ${alertRulesData.length} alert rules`);

  // === INTERNAL CONTROL RULES ===
  const controlRulesData = [
    {
      controlCode: 'IC-MAKER-CHECKER-GLOBAL',
      name: 'Global Maker-Checker Control',
      description: 'Sensitive records cannot be approved by the same user who created them',
      controlType: ControlType.MAKER_CHECKER,
      enforcementLevel: EnforcementLevel.BLOCKING,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      controlCode: 'IC-AMOUNT-LIMIT-EXPENSE',
      name: 'Expense Amount Limit Control',
      description: 'Expenses above TZS 5,000,000 require Director approval',
      controlType: ControlType.AMOUNT_LIMIT,
      entityType: 'Expense',
      condition: { maxAmount: 5000000, currency: 'TZS' },
      enforcementLevel: EnforcementLevel.APPROVAL_REQUIRED,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      controlCode: 'IC-BLOCK-NEGATIVE-STOCK',
      name: 'Block Negative Stock',
      description: 'Prevent stock issues that would result in negative inventory balance',
      controlType: ControlType.BLOCK_NEGATIVE_STOCK,
      entityType: 'StockMovement',
      enforcementLevel: EnforcementLevel.BLOCKING,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      controlCode: 'IC-BLOCK-OVERPAYMENT',
      name: 'Block Overpayment',
      description: 'Prevent payments that exceed the invoice/payable amount',
      controlType: ControlType.BLOCK_OVERPAYMENT,
      entityType: 'Payable',
      enforcementLevel: EnforcementLevel.WARNING,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      controlCode: 'IC-SENSITIVE-EXPORT',
      name: 'Sensitive Data Export Review',
      description: 'All data exports of sensitive records require Group Control approval',
      controlType: ControlType.SENSITIVE_EXPORT_REVIEW,
      entityType: 'DataExport',
      enforcementLevel: EnforcementLevel.APPROVAL_REQUIRED,
      isActive: true,
      createdById: superAdmin.id,
    },
    {
      controlCode: 'IC-REQUIRED-DOC-CONTRACT',
      name: 'Required Document for Contracts',
      description: 'Contracts above TZS 10,000,000 require signed document upload',
      controlType: ControlType.REQUIRED_DOCUMENT,
      entityType: 'Contract',
      condition: { minAmount: 10000000, currency: 'TZS' },
      enforcementLevel: EnforcementLevel.WARNING,
      isActive: true,
      createdById: superAdmin.id,
    },
  ];

  for (const ctrl of controlRulesData) {
    await prisma.internalControlRule.upsert({
      where: { controlCode: ctrl.controlCode },
      update: {},
      create: ctrl,
    });
  }
  console.log(`Seeded ${controlRulesData.length} internal control rules`);

  // === DEMO TASKS ===
  const tasksData = [
    {
      taskNumber: 'TASK-001',
      title: 'Review Q1 Compliance Obligations',
      description: 'Review and update all Q1 compliance obligation statuses for all companies',
      assignedToId: superAdmin.id,
      assignedById: superAdmin.id,
      taskType: TaskType.COMPLIANCE_TASK,
      priority: TaskPriority.HIGH,
      status: TaskStatus.TODO,
      dueDate: new Date(new Date().setDate(new Date().getDate() + 14)),
    },
    {
      taskNumber: 'TASK-002',
      title: 'Verify Business Licenses Before Expiry',
      description: 'Check all business license expiry dates and renew any expiring within 60 days',
      assignedToId: superAdmin.id,
      assignedById: superAdmin.id,
      taskType: TaskType.DOCUMENT_TASK,
      priority: TaskPriority.NORMAL,
      status: TaskStatus.TODO,
      dueDate: new Date(new Date().setDate(new Date().getDate() + 30)),
    },
  ];

  for (const task of tasksData) {
    const existing = await prisma.task.findFirst({ where: { taskNumber: task.taskNumber } });
    if (!existing) {
      await prisma.task.create({ data: task });
    }
  }
  console.log(`Seeded ${tasksData.length} demo tasks`);

  console.log('✅ M11 seed complete.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MILESTONE 12 — BI & Executive Intelligence
// ═══════════════════════════════════════════════════════════════════════════════
async function seedM12() {
  // ── A. Permissions ─────────────────────────────────────────────────────────
  const biPermissions = [
    {
      code: 'bi.dashboard.view',
      description: 'View BI dashboards',
      module: 'bi',
      action: 'dashboard.view',
      isGroupControl: false,
    },
    {
      code: 'bi.executive.view',
      description: 'View executive BI',
      module: 'bi',
      action: 'executive.view',
      isGroupControl: true,
    },
    {
      code: 'bi.group.view',
      description: 'View group-level BI',
      module: 'bi',
      action: 'group.view',
      isGroupControl: true,
    },
    {
      code: 'bi.company.view',
      description: 'View company-level BI',
      module: 'bi',
      action: 'company.view',
      isGroupControl: false,
    },
    {
      code: 'bi.widgets.manage',
      description: 'Manage BI widgets',
      module: 'bi',
      action: 'widgets.manage',
      isGroupControl: false,
    },
    {
      code: 'dashboard_definitions.view',
      description: 'View dashboard definitions',
      module: 'dashboard_definitions',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'dashboard_definitions.manage',
      description: 'Manage dashboard definitions',
      module: 'dashboard_definitions',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'dashboard_preferences.manage',
      description: 'Manage dashboard preferences',
      module: 'dashboard_preferences',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'kpis.view',
      description: 'View KPI indicators',
      module: 'kpis',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'kpis.manage',
      description: 'Manage KPI indicators',
      module: 'kpis',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'kpi_snapshots.view',
      description: 'View KPI snapshots',
      module: 'kpi_snapshots',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'kpi_snapshots.generate',
      description: 'Generate KPI snapshots',
      module: 'kpi_snapshots',
      action: 'generate',
      isGroupControl: false,
    },
    {
      code: 'advanced_reports.view',
      description: 'View advanced reports',
      module: 'advanced_reports',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'report_definitions.view',
      description: 'View report definitions',
      module: 'report_definitions',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'report_definitions.manage',
      description: 'Manage report definitions',
      module: 'report_definitions',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'saved_report_views.view',
      description: 'View saved report views',
      module: 'saved_report_views',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'saved_report_views.manage',
      description: 'Manage saved report views',
      module: 'saved_report_views',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'saved_report_views.share',
      description: 'Share saved report views',
      module: 'saved_report_views',
      action: 'share',
      isGroupControl: false,
    },
    {
      code: 'report_runs.view',
      description: 'View report runs',
      module: 'report_runs',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'report_runs.create',
      description: 'Create report runs',
      module: 'report_runs',
      action: 'create',
      isGroupControl: false,
    },
    {
      code: 'scheduled_reports.view',
      description: 'View scheduled reports',
      module: 'scheduled_reports',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'scheduled_reports.manage',
      description: 'Manage scheduled reports',
      module: 'scheduled_reports',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'scheduled_reports.run',
      description: 'Run scheduled reports',
      module: 'scheduled_reports',
      action: 'run',
      isGroupControl: false,
    },
    {
      code: 'executive_insights.view',
      description: 'View executive insights',
      module: 'executive_insights',
      action: 'view',
      isGroupControl: true,
    },
    {
      code: 'executive_insights.manage',
      description: 'Manage executive insights',
      module: 'executive_insights',
      action: 'manage',
      isGroupControl: true,
    },
    {
      code: 'executive_insights.acknowledge',
      description: 'Acknowledge executive insights',
      module: 'executive_insights',
      action: 'acknowledge',
      isGroupControl: false,
    },
    {
      code: 'executive_insights.resolve',
      description: 'Resolve executive insights',
      module: 'executive_insights',
      action: 'resolve',
      isGroupControl: false,
    },
    {
      code: 'data_quality.view',
      description: 'View data quality issues',
      module: 'data_quality',
      action: 'view',
      isGroupControl: false,
    },
    {
      code: 'data_quality.manage',
      description: 'Manage data quality issues',
      module: 'data_quality',
      action: 'manage',
      isGroupControl: false,
    },
    {
      code: 'data_quality.run_checks',
      description: 'Run data quality checks',
      module: 'data_quality',
      action: 'run_checks',
      isGroupControl: false,
    },
    {
      code: 'data_quality.resolve',
      description: 'Resolve data quality issues',
      module: 'data_quality',
      action: 'resolve',
      isGroupControl: false,
    },
    {
      code: 'sensitive_analytics.view',
      description: 'View sensitive analytics',
      module: 'sensitive_analytics',
      action: 'view',
      isGroupControl: true,
    },
    {
      code: 'sensitive_reports.export',
      description: 'Export sensitive reports',
      module: 'sensitive_reports',
      action: 'export',
      isGroupControl: true,
    },
    {
      code: 'group_consolidated_reports.view',
      description: 'View group consolidated reports',
      module: 'group_consolidated_reports',
      action: 'view',
      isGroupControl: true,
    },
    {
      code: 'company_comparison_reports.view',
      description: 'View company comparison reports',
      module: 'company_comparison_reports',
      action: 'view',
      isGroupControl: true,
    },
    {
      code: 'financial_bi.view',
      description: 'View financial BI',
      module: 'financial_bi',
      action: 'view',
      isGroupControl: true,
    },
    {
      code: 'payroll_bi.view',
      description: 'View payroll BI',
      module: 'payroll_bi',
      action: 'view',
      isGroupControl: true,
    },
    {
      code: 'compliance_bi.view',
      description: 'View compliance BI',
      module: 'compliance_bi',
      action: 'view',
      isGroupControl: false,
    },
  ];

  for (const perm of biPermissions) {
    await prisma.permission.upsert({ where: { code: perm.code }, update: {}, create: perm });
  }
  console.log(`  Seeded ${biPermissions.length} BI permissions`);

  // ── B. KPI Indicators ──────────────────────────────────────────────────────
  const kpis = [
    // Finance
    {
      kpiCode: 'TOTAL_REVENUE',
      name: 'Total Revenue',
      kpiCategory: 'FINANCE',
      calculationType: 'SUM',
      sourceEntity: 'JournalEntryLine',
      sourceField: 'credit',
      unit: 'TZS',
      currency: 'TZS',
    },
    {
      kpiCode: 'TOTAL_EXPENSES',
      name: 'Total Expenses',
      kpiCategory: 'FINANCE',
      calculationType: 'SUM',
      sourceEntity: 'Expense',
      sourceField: 'amount',
    },
    {
      kpiCode: 'NET_INCOME',
      name: 'Net Income',
      kpiCategory: 'FINANCE',
      calculationType: 'DIFFERENCE',
      sourceEntity: 'JournalEntryLine',
    },
    {
      kpiCode: 'CASH_BALANCE',
      name: 'Cash Balance',
      kpiCategory: 'FINANCE',
      calculationType: 'SUM',
      sourceEntity: 'CashAccount',
      sourceField: 'balance',
    },
    {
      kpiCode: 'RECEIVABLES_TOTAL',
      name: 'Total Receivables',
      kpiCategory: 'FINANCE',
      calculationType: 'SUM',
      sourceEntity: 'CustomerReceivable',
      isSensitive: false,
    },
    {
      kpiCode: 'PAYABLES_TOTAL',
      name: 'Total Payables',
      kpiCategory: 'FINANCE',
      calculationType: 'SUM',
      sourceEntity: 'SupplierPayable',
    },
    {
      kpiCode: 'DEBT_OUTSTANDING',
      name: 'Debt Outstanding',
      kpiCategory: 'FINANCE',
      calculationType: 'SUM',
      sourceEntity: 'Loan',
      isSensitive: true,
      requiredPermission: 'financial_bi.view',
    },
    // Sales
    {
      kpiCode: 'TOTAL_SALES_ORDERS',
      name: 'Total Sales Orders',
      kpiCategory: 'SALES',
      calculationType: 'COUNT',
      sourceEntity: 'SalesOrder',
    },
    {
      kpiCode: 'SALES_REVENUE',
      name: 'Sales Revenue',
      kpiCategory: 'SALES',
      calculationType: 'SUM',
      sourceEntity: 'SalesOrder',
      sourceField: 'totalAmount',
    },
    {
      kpiCode: 'ACTIVE_CUSTOMERS',
      name: 'Active Customers',
      kpiCategory: 'SALES',
      calculationType: 'COUNT',
      sourceEntity: 'Customer',
    },
    // HR
    {
      kpiCode: 'ACTIVE_EMPLOYEES',
      name: 'Active Employees',
      kpiCategory: 'HR',
      calculationType: 'COUNT',
      sourceEntity: 'Employee',
      requiredPermission: 'payroll_bi.view',
    },
    {
      kpiCode: 'PAYROLL_COST',
      name: 'Monthly Payroll Cost',
      kpiCategory: 'HR',
      calculationType: 'SUM',
      sourceEntity: 'PayrollEntry',
      sourceField: 'netPay',
      isSensitive: true,
      requiredPermission: 'payroll_bi.view',
    },
    // Compliance
    {
      kpiCode: 'OVERDUE_OBLIGATIONS',
      name: 'Overdue Compliance Obligations',
      kpiCategory: 'COMPLIANCE',
      calculationType: 'COUNT',
      sourceEntity: 'ComplianceObligation',
    },
    {
      kpiCode: 'COMPLIANCE_SCORE',
      name: 'Compliance Score (%)',
      kpiCategory: 'COMPLIANCE',
      calculationType: 'PERCENTAGE',
      sourceEntity: 'ComplianceObligation',
      unit: '%',
    },
    // Petroleum
    {
      kpiCode: 'FUEL_LITRES_SOLD',
      name: 'Fuel Litres Sold',
      kpiCategory: 'PETROLEUM',
      calculationType: 'SUM',
      sourceEntity: 'FuelSale',
      sourceField: 'litres',
      unit: 'L',
    },
    {
      kpiCode: 'FUEL_VARIANCE',
      name: 'Fuel Variance',
      kpiCategory: 'PETROLEUM',
      calculationType: 'DIFFERENCE',
      sourceEntity: 'FuelVarianceReport',
    },
    // Inventory
    {
      kpiCode: 'INVENTORY_VALUE',
      name: 'Total Inventory Value',
      kpiCategory: 'INVENTORY',
      calculationType: 'SUM',
      sourceEntity: 'InventoryBalance',
    },
    {
      kpiCode: 'LOW_STOCK_COUNT',
      name: 'Low Stock Items',
      kpiCategory: 'INVENTORY',
      calculationType: 'COUNT',
      sourceEntity: 'InventoryBalance',
    },
    // Approvals
    {
      kpiCode: 'PENDING_APPROVALS',
      name: 'Pending Approvals',
      kpiCategory: 'APPROVALS',
      calculationType: 'COUNT',
      sourceEntity: 'ApprovalRequest',
    },
    {
      kpiCode: 'OVERDUE_APPROVALS',
      name: 'Overdue Approvals',
      kpiCategory: 'APPROVALS',
      calculationType: 'COUNT',
      sourceEntity: 'ApprovalRequest',
    },
  ];

  for (const kpi of kpis) {
    await prisma.kPIIndicator.upsert({
      where: { kpiCode: kpi.kpiCode },
      update: {},
      create: kpi as any,
    });
  }
  console.log(`  Seeded ${kpis.length} KPI indicators`);

  // ── C. Report Definitions ──────────────────────────────────────────────────
  const reports = [
    {
      reportCode: 'RPT-EXEC-SUMMARY',
      name: 'Executive Summary',
      reportCategory: 'EXECUTIVE',
      datasetKey: 'group_financial_summary',
      isSystemReport: true,
      requiredPermission: 'bi.executive.view',
    },
    {
      reportCode: 'RPT-COMPANY-COMPARISON',
      name: 'Company Comparison',
      reportCategory: 'EXECUTIVE',
      datasetKey: 'company_comparison',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'company_comparison_reports.view',
    },
    {
      reportCode: 'RPT-CASH-POSITION',
      name: 'Cash Position Report',
      reportCategory: 'FINANCE',
      datasetKey: 'cash_position',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'financial_bi.view',
    },
    {
      reportCode: 'RPT-DEBT-EXPOSURE',
      name: 'Debt Exposure Report',
      reportCategory: 'FINANCE',
      datasetKey: 'debt_exposure',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'financial_bi.view',
    },
    {
      reportCode: 'RPT-RECEIVABLES-AGING',
      name: 'Receivables Aging',
      reportCategory: 'FINANCE',
      datasetKey: 'receivables_aging',
      isSystemReport: true,
    },
    {
      reportCode: 'RPT-PAYABLES-AGING',
      name: 'Payables Aging',
      reportCategory: 'FINANCE',
      datasetKey: 'payables_aging',
      isSystemReport: true,
    },
    {
      reportCode: 'RPT-INVENTORY-SUMMARY',
      name: 'Inventory Summary',
      reportCategory: 'INVENTORY',
      datasetKey: 'inventory_summary',
      isSystemReport: true,
    },
    {
      reportCode: 'RPT-DIVISION-PROFIT',
      name: 'Division Profitability',
      reportCategory: 'EXECUTIVE',
      datasetKey: 'division_profitability',
      isSystemReport: true,
    },
    {
      reportCode: 'RPT-HR-SUMMARY',
      name: 'HR Summary',
      reportCategory: 'HR',
      datasetKey: 'hr_summary',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'payroll_bi.view',
    },
    {
      reportCode: 'RPT-COMPLIANCE-DASH',
      name: 'Compliance Dashboard',
      reportCategory: 'COMPLIANCE',
      datasetKey: 'compliance_dashboard',
      isSystemReport: true,
      requiredPermission: 'compliance_bi.view',
    },
    {
      reportCode: 'RPT-ASSET-SUMMARY',
      name: 'Asset Summary',
      reportCategory: 'FINANCE',
      datasetKey: 'asset_summary',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'financial_bi.view',
    },
    {
      reportCode: 'RPT-BRANCH-PERF',
      name: 'Branch Performance',
      reportCategory: 'EXECUTIVE',
      datasetKey: 'branch_performance',
      isSystemReport: true,
    },
    {
      reportCode: 'RPT-FUEL-OPS',
      name: 'Fuel Operations Report',
      reportCategory: 'PETROLEUM',
      datasetKey: 'fuel_operations',
      isSystemReport: true,
    },
    {
      reportCode: 'RPT-AUDIT-TRAIL',
      name: 'Audit Trail Report',
      reportCategory: 'AUDIT',
      datasetKey: 'audit_trail',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'sensitive_analytics.view',
    },
    {
      reportCode: 'RPT-PAYROLL-SUMMARY',
      name: 'Payroll Summary',
      reportCategory: 'PAYROLL',
      datasetKey: 'hr_summary',
      isSystemReport: true,
      isSensitive: true,
      requiredPermission: 'payroll_bi.view',
    },
  ];

  for (const item of reports) {
    await prisma.reportDefinition.upsert({
      where: { reportCode: item.reportCode },
      update: {},
      create: { ...item, isActive: true } as any,
    });
  }
  console.log(`  Seeded ${reports.length} report definitions`);

  // ── D. Dashboard Definitions + Widgets ─────────────────────────────────────
  await prisma.dashboardDefinition.upsert({
    where: { dashboardCode: 'DASH-EXECUTIVE' },
    update: {},
    create: {
      dashboardCode: 'DASH-EXECUTIVE',
      name: 'Executive Dashboard',
      dashboardType: 'EXECUTIVE' as any,
      isSystemDashboard: true,
      isSensitive: true,
      requiredPermission: 'bi.executive.view',
      layout: { columns: 4, rows: 3, type: 'grid' },
    },
  });

  await prisma.dashboardDefinition.upsert({
    where: { dashboardCode: 'DASH-GROUP-OPS' },
    update: {},
    create: {
      dashboardCode: 'DASH-GROUP-OPS',
      name: 'Group Operations Dashboard',
      dashboardType: 'GROUP' as any,
      isSystemDashboard: true,
      requiredPermission: 'bi.group.view',
      layout: { columns: 3, rows: 2, type: 'grid' },
    },
  });

  await prisma.dashboardDefinition.upsert({
    where: { dashboardCode: 'DASH-COMPLIANCE' },
    update: {},
    create: {
      dashboardCode: 'DASH-COMPLIANCE',
      name: 'Compliance Dashboard',
      dashboardType: 'MODULE' as any,
      isSystemDashboard: true,
      requiredPermission: 'compliance_bi.view',
      layout: { columns: 2, rows: 2, type: 'grid' },
    },
  });

  console.log('  Seeded 3 dashboard definitions');

  const execDash = await prisma.dashboardDefinition.findUnique({
    where: { dashboardCode: 'DASH-EXECUTIVE' },
  });
  const revenueKpi = await prisma.kPIIndicator.findUnique({ where: { kpiCode: 'TOTAL_REVENUE' } });

  const widgets = [
    {
      widgetCode: 'W-TOTAL-REVENUE',
      title: 'Total Revenue',
      widgetType: 'KPI_CARD',
      dataSourceType: 'KPI',
      kpiIndicatorId: revenueKpi?.id,
      position: { col: 0, row: 0 },
    },
    {
      widgetCode: 'W-PENDING-APPROVALS',
      title: 'Pending Approvals',
      widgetType: 'KPI_CARD',
      dataSourceType: 'KPI',
      position: { col: 1, row: 0 },
    },
    {
      widgetCode: 'W-COMPLIANCE-SCORE',
      title: 'Compliance Score',
      widgetType: 'KPI_CARD',
      dataSourceType: 'KPI',
      position: { col: 2, row: 0 },
    },
    {
      widgetCode: 'W-COMPANY-COMPARISON',
      title: 'Company Comparison',
      widgetType: 'BAR_CHART',
      dataSourceType: 'REPORT',
      position: { col: 0, row: 1, colSpan: 2 },
    },
    {
      widgetCode: 'W-RECENT-INSIGHTS',
      title: 'Recent Insights',
      widgetType: 'TABLE',
      dataSourceType: 'CUSTOM',
      dataSourceKey: 'executive_insights',
      position: { col: 0, row: 2, colSpan: 2 },
    },
    {
      widgetCode: 'W-DATA-QUALITY',
      title: 'Data Quality Issues',
      widgetType: 'ALERT_LIST',
      dataSourceType: 'DATASET',
      dataSourceKey: 'data_quality_open',
      position: { col: 2, row: 1 },
    },
  ];

  for (const w of widgets) {
    await prisma.dashboardWidget.upsert({
      where: {
        dashboardDefinitionId_widgetCode: {
          dashboardDefinitionId: execDash!.id,
          widgetCode: w.widgetCode,
        },
      },
      update: {},
      create: { dashboardDefinitionId: execDash!.id, ...w } as any,
    });
  }
  console.log(`  Seeded ${widgets.length} dashboard widgets`);

  // ── E. Sample Data Quality Issues ─────────────────────────────────────────
  const demoIssues = [
    {
      issueNumber: 'DQ-DEMO-001',
      entityType: 'Company',
      issueType: 'MISSING_DOCUMENT',
      title: 'Company missing TIN document',
      severity: 'HIGH',
      status: 'OPEN',
      detectedAt: new Date(),
    },
    {
      issueNumber: 'DQ-DEMO-002',
      entityType: 'Inventory',
      issueType: 'NEGATIVE_BALANCE',
      title: 'Negative inventory balance detected',
      severity: 'CRITICAL',
      status: 'OPEN',
      detectedAt: new Date(),
    },
    {
      issueNumber: 'DQ-DEMO-003',
      entityType: 'JournalEntry',
      issueType: 'UNPOSTED_TRANSACTION',
      title: 'Unposted journal entries older than 7 days',
      severity: 'MEDIUM',
      status: 'OPEN',
      detectedAt: new Date(),
    },
  ];

  for (const issue of demoIssues) {
    await prisma.dataQualityIssue.upsert({
      where: { issueNumber: issue.issueNumber },
      update: {},
      create: issue as any,
    });
  }
  console.log(`  Seeded ${demoIssues.length} data quality issues`);

  // ── F. Sample Executive Insights ──────────────────────────────────────────
  const insights = [
    {
      insightNumber: 'INS-DEMO-001',
      insightDate: new Date(),
      insightType: 'PERFORMANCE',
      title: 'Group Revenue Tracking',
      summary:
        'Group revenue is being tracked. Dashboard is initialized with KPI indicators across all business units.',
      severity: 'NORMAL',
      status: 'OPEN',
      generatedBy: 'SYSTEM',
    },
    {
      insightNumber: 'INS-DEMO-002',
      insightDate: new Date(),
      insightType: 'COMPLIANCE',
      title: 'Compliance Monitoring Active',
      summary: 'Compliance dashboard is active. Review overdue obligations and expiring documents.',
      severity: 'HIGH',
      status: 'OPEN',
      generatedBy: 'SYSTEM',
    },
  ];

  for (const ins of insights) {
    await prisma.executiveInsight.upsert({
      where: { insightNumber: ins.insightNumber },
      update: {},
      create: ins as any,
    });
  }
  console.log(`  Seeded ${insights.length} executive insights`);

  console.log('✅ M12 seed complete.');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MILESTONE 13 — Integrations, API Gateway, Webhooks, Mobile & External Services
// ═══════════════════════════════════════════════════════════════════════════════
async function seedM13() {
  // ── A. Integration Providers ───────────────────────────────────────────────
  const providers = [
    {
      providerCode: 'MPESA_TZ',
      name: 'M-Pesa Tanzania',
      providerType: IntegrationProviderType.MOBILE_MONEY,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: true,
      supportsSandbox: true,
      baseUrl: 'https://openapi.m-pesa.com',
    },
    {
      providerCode: 'TIGOPESA',
      name: 'Tigo Pesa',
      providerType: IntegrationProviderType.MOBILE_MONEY,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: true,
      supportsSandbox: true,
      baseUrl: 'https://api.tigopesa.com',
    },
    {
      providerCode: 'AIRTEL_MONEY_TZ',
      name: 'Airtel Money Tanzania',
      providerType: IntegrationProviderType.MOBILE_MONEY,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: true,
      supportsSandbox: true,
      baseUrl: 'https://openapi.airtel.africa',
    },
    {
      providerCode: 'NMB_BANK',
      name: 'NMB Bank Tanzania',
      providerType: IntegrationProviderType.BANK,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: false,
      supportsSandbox: false,
    },
    {
      providerCode: 'CRDB_BANK',
      name: 'CRDB Bank',
      providerType: IntegrationProviderType.BANK,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: false,
      supportsSandbox: false,
    },
    {
      providerCode: 'TRA_EFILING',
      name: 'TRA eFiling System',
      providerType: IntegrationProviderType.TAX_AUTHORITY,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: false,
      supportsSandbox: true,
      baseUrl: 'https://efiling.tra.go.tz',
    },
    {
      providerCode: 'SMTP_EMAIL',
      name: 'SMTP Email',
      providerType: IntegrationProviderType.EMAIL,
      status: IntegrationProviderStatus.ACTIVE,
      supportsWebhooks: false,
      supportsSandbox: false,
    },
    {
      providerCode: 'TWILIO_SMS',
      name: 'Twilio SMS',
      providerType: IntegrationProviderType.SMS,
      status: IntegrationProviderStatus.TESTING,
      supportsWebhooks: true,
      supportsSandbox: true,
      baseUrl: 'https://api.twilio.com',
    },
    {
      providerCode: 'WHATSAPP_CLOUD',
      name: 'WhatsApp Business Cloud API',
      providerType: IntegrationProviderType.WHATSAPP,
      status: IntegrationProviderStatus.TESTING,
      supportsWebhooks: true,
      supportsSandbox: true,
      baseUrl: 'https://graph.facebook.com/v18.0',
    },
  ];

  for (const provider of providers) {
    await prisma.integrationProvider.upsert({
      where: { providerCode: provider.providerCode },
      update: { name: provider.name, status: provider.status, baseUrl: provider.baseUrl },
      create: provider,
    });
  }
  console.log(`  Seeded ${providers.length} integration providers`);

  // ── B. Message Templates ───────────────────────────────────────────────────
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@itemba.local';
  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!adminUser) {
    console.log('  Skipping message templates — admin user not found');
    console.log('✅ M13 seed complete.');
    return;
  }

  const templates = [
    {
      templateCode: 'PAYMENT_RECEIPT_SMS',
      name: 'Payment Receipt SMS',
      channel: ExternalMessageChannel.SMS,
      templateType: MessageTemplateType.PAYMENT_RECEIPT,
      body: 'Dear {{payerName}}, your payment of {{currency}} {{amount}} has been received. Ref: {{reference}}. Thank you.',
    },
    {
      templateCode: 'APPROVAL_NOTIFICATION_EMAIL',
      name: 'Approval Notification Email',
      channel: ExternalMessageChannel.EMAIL,
      templateType: MessageTemplateType.APPROVAL_NOTIFICATION,
      subject: 'Action Required: {{approvalTitle}}',
      body: 'Dear {{userName}}, you have a pending approval request: {{approvalTitle}}. Please log in to ITEMBA-R to review.',
    },
    {
      templateCode: 'DOCUMENT_EXPIRY_SMS',
      name: 'Document Expiry Reminder SMS',
      channel: ExternalMessageChannel.SMS,
      templateType: MessageTemplateType.DOCUMENT_EXPIRY,
      body: 'ITEMBA-R Alert: {{documentName}} expires on {{expiryDate}}. Please renew to avoid compliance issues.',
    },
    {
      templateCode: 'PAYSLIP_NOTIFICATION_SMS',
      name: 'Payslip Ready SMS',
      channel: ExternalMessageChannel.SMS,
      templateType: MessageTemplateType.PAYSLIP_NOTIFICATION,
      body: 'Dear {{employeeName}}, your payslip for {{payPeriod}} is ready. Log in to ITEMBA-R to view.',
    },
  ];

  for (const tpl of templates) {
    await prisma.messageTemplate.upsert({
      where: { templateCode: tpl.templateCode },
      update: {},
      create: { ...tpl, createdById: adminUser.id },
    });
  }
  console.log(`  Seeded ${templates.length} message templates`);

  console.log('✅ M13 seed complete.');
}
