import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { object } from './workspace.validation';

type Rule = { permission: string; model?: string; key?: string; update?: string };
const rule = (permission: string, model?: string, key = 'recordId', update?: string): Rule => ({
  permission,
  model,
  key,
  update,
});
/** Explicit version-one form contracts. Unknown form kinds never become a generic storage API. */
const forms: Record<string, Record<string, Rule>> = {
  'invoice-desk': {
    invoice: rule('invoice_desk.manage'),
    supplier: rule('invoice_desk.manage'),
    edit: rule('invoice_desk.manage', 'invoiceDeskInvoice', 'invoiceId'),
    void: rule('invoice_desk.manage', 'invoiceDeskInvoice', 'invoiceId'),
    payment: rule('invoice_desk.payments', 'invoiceDeskInvoice', 'invoiceId'),
    reverse: rule('invoice_desk.payments', 'invoiceDeskInvoice', 'invoiceId'),
  },
  'cash-desk': {
    account: rule('cash_desk.manage'),
    movement: rule('cash_desk.record'),
    reverse: rule('cash_desk.reverse', 'cashDeskMovement', 'movementId'),
  },
  'sales-desk': {
    customer: rule('sales_desk.manage'),
    sale: rule('sales_desk.manage'),
    payment: rule('sales_desk.payments', 'salesDeskSale', 'saleId'),
    void: rule('sales_desk.manage', 'salesDeskSale', 'saleId'),
  },
  inventory: {
    adjustment: rule('inventory.adjustments.create'),
    damage: rule('stock_damage.create'),
    batch: rule('product_batches.manage'),
    product: rule('products.create', 'product', 'recordId', 'products.update'),
    unit: rule('units.manage', 'unitOfMeasure'),
    conversion: rule('units.manage', 'unitConversion'),
    category: rule('product_categories.manage', 'productCategory'),
    family: rule('product_categories.manage', 'productFamily'),
    'adjustment-action': rule('', 'stockAdjustment'),
    'damage-action': rule('', 'stockDamage'),
  },
  payroll: {
    employee: rule('employees.create'),
    'employee-edit': rule('employees.update', 'employee', 'recordId'),
    termination: rule('employees.termination.request', 'employee', 'employeeId'),
    'mobile-money': rule('employees.update', 'employee', 'employeeId'),
    department: rule('departments.manage', 'department'),
    position: rule('positions.manage', 'position'),
    assignment: rule('employees.assignments.manage', 'employeeAssignment'),
    contract: rule('employment_contracts.create'),
    'contract-action': rule('', 'employmentContract'),
    attendance: rule('attendance.create', 'attendanceRecord', 'recordId', 'attendance.update'),
    'leave-type': rule('leave_types.manage', 'leaveType'),
    'leave-balance': rule('leave_balances.manage', 'leaveBalance'),
    'leave-request': rule('leave_requests.create'),
    'leave-action': rule('', 'leaveRequest'),
    'allowance-type': rule('allowances.manage', 'allowanceType'),
    'deduction-type': rule('deductions.manage', 'deductionType'),
    allowance: rule('allowances.manage', 'employeeAllowance'),
    deduction: rule('deductions.manage', 'employeeDeduction'),
    'payroll-period': rule('payroll.manage'),
    'payroll-run': rule('payroll.manage'),
    'payroll-action': rule('', 'payrollRun'),
    'salary-advance': rule('salary_advances.create'),
    'advance-action': rule('', 'salaryAdvance'),
    'salary-payment-reversal': rule('salary_payments.reverse', 'salaryPayment'),
  },
  reports: {
    schedule: rule(
      'scheduled_reports.create',
      'scheduledReport',
      'recordId',
      'scheduled_reports.update',
    ),
    'reconciliation-create': rule('bank_reconciliations.create'),
    'reconciliation-line': rule('bank_reconciliations.update', 'bankReconciliation'),
    'reconciliation-action': rule('', 'bankReconciliation'),
    'invoice-posting': rule('journal_entries.post'),
    'cash-posting': rule('journal_entries.post', 'cashDeskMovement'),
    'account-connection': rule('cash_accounts.manage', 'cashDeskAccount'),
    'payment-link': rule('invoice_desk.payments', 'invoiceDeskPayment'),
    'control-create': rule(''),
    'control-action': rule(''),
  },
  documents: { letter: rule('documents.manage') },
};
const actions: Record<string, Record<string, string>> = {
  'payroll-action': {
    calculate: 'payroll.calculate',
    submit: 'payroll.submit',
    approve: 'payroll.approve',
    'approve-hr': 'payroll.approve.hr',
    'approve-finance': 'payroll.approve.finance',
    pay: 'payroll.pay',
    cancel: 'payroll.cancel',
    'reverse-payment': 'payroll.pay',
  },
  'contract-action': {
    approve: 'employment_contracts.approve',
    terminate: 'employment_contracts.terminate',
  },
  'leave-action': {
    submit: 'leave_requests.create',
    approve: 'leave_requests.approve',
    'approve-hr': 'leave_requests.approve.hr',
    reject: 'leave_requests.reject',
    cancel: 'leave_requests.create',
  },
  'advance-action': { approve: 'salary_advances.approve', pay: 'salary_advances.pay' },
  'adjustment-action': {
    submit: 'inventory.adjustments.create',
    approve: 'inventory.adjustments.approve',
    post: 'inventory.adjustments.post',
    reject: 'inventory.adjustments.approve',
    revert: 'inventory.adjustments.approve',
    delete: 'inventory.adjustments.create',
  },
  'damage-action': {
    submit: 'stock_damage.create',
    approve: 'stock_damage.approve',
    reject: 'stock_damage.approve',
    post: 'stock_damage.post',
  },
  'reconciliation-action': {
    'run-matching': 'bank_reconciliations.update',
    close: 'bank_reconciliations.close',
    match: 'bank_reconciliations.update',
    unmatch: 'bank_reconciliations.update',
    complete: 'bank_reconciliations.complete',
    reconcile: 'bank_reconciliations.reconcile',
    approve: 'bank_reconciliations.approve',
    reopen: 'bank_reconciliations.reopen',
  },
};
const controls: Record<string, [string, string]> = {
  'posting-runs': ['posting_runs', 'postingRun'],
  'period-close': ['period_close', 'accountingPeriodClose'],
  'accounting-locks': ['accounting_locks', 'accountingLock'],
  'audit-adjustments': ['audit_adjustments', 'auditAdjustment'],
  depreciation: ['depreciation', 'depreciationSchedule'],
};
export interface DraftContent {
  title: string;
  summary?: string;
  context: Record<string, string>;
  values: Record<string, unknown>;
  requestId: string | null;
  needsReview: boolean;
  submission?: 'uncertain' | null;
}
@Injectable()
export class WorkspaceDraftPolicy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly organization: OrganizationScopeService,
  ) {}
  private async record(model: string, id: string) {
    const delegate = (
      this.prisma as unknown as Record<
        string,
        { findFirst(args: { where: { id: string } }): Promise<Record<string, unknown> | null> }
      >
    )[model];
    if (!delegate) throw new BadRequestException('Unsupported draft reference');
    const row = await delegate.findFirst({ where: { id } });
    if (!row || row.deletedAt)
      throw new NotFoundException('The draft source is no longer available');
    return row;
  }
  async authorize(user: AuthUser, appId: string, formType: string, content: DraftContent) {
    const context = object(content.context),
      values = object(content.values);
    const kind = String(context.kind ?? '');
    if (formType !== `${appId}:${kind}:v1`)
      throw new BadRequestException('Unsupported draft schema');
    const spec = forms[appId]?.[kind];
    if (!spec) throw new BadRequestException('This form does not support automatic recovery');
    let permission = context[spec.key ?? 'recordId'] && spec.update ? spec.update : spec.permission;
    let model = spec.model;
    if (actions[kind]) permission = actions[kind][context.action];
    if (kind.startsWith('control-')) {
      const control = controls[context.control];
      if (!control) throw new BadRequestException('Unknown accounting control');
      model = control[1];
      const action = kind === 'control-create' ? 'create' : context.action;
      const allowed = [
        'create',
        'post',
        'reverse',
        'close',
        'reopen',
        'release',
        'submit',
        'approve',
        'generate',
        'entries',
        'post-entry',
      ];
      if (!allowed.includes(action)) throw new BadRequestException('Unknown accounting action');
      permission = `${control[0]}.${action === 'post-entry' ? 'post_entry' : ['generate', 'submit', 'entries'].includes(action) ? 'create' : action}`;
    }
    if (!permission || !user.permissions.includes(permission))
      throw new ForbiddenException('Your current role cannot edit this draft');
    const additional = appId.endsWith('-desk') ? [`${appId.replaceAll('-', '_')}.view`] : [];
    if (kind === 'invoice-posting' || kind === 'cash-posting')
      additional.push('journal_entries.create', 'journal_entries.view');
    if (appId === 'sales-desk' && kind === 'payment')
      additional.push('cash_desk.view', 'cash_desk.record');
    if (additional.some((p) => !user.permissions.includes(p)))
      throw new ForbiddenException('Your current role cannot access this draft');
    if (kind === 'invoice-posting')
      model = context.sourceKind === 'sales' ? 'salesDeskSale' : 'invoiceDeskInvoice';
    const recordId = context[spec.key ?? 'recordId'];
    const source = model && recordId ? await this.record(model, recordId) : {};
    const fields =
      values.fields && typeof values.fields === 'object' ? object(values.fields) : values;
    const employeeId = source.employeeId || fields.employeeId || context.employeeId;
    const employee = employeeId ? await this.record('employee', String(employeeId)) : {};
    const scope = {
      companyId:
        String(
          source.companyId ||
            employee.companyId ||
            fields.companyId ||
            context.companyId ||
            user.companyId ||
            '',
        ) || null,
      divisionId:
        String(
          source.divisionId || employee.divisionId || fields.divisionId || context.divisionId || '',
        ) || null,
      branchId:
        String(source.branchId || employee.branchId || fields.branchId || context.branchId || '') ||
        null,
    };
    if (scope.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: scope.branchId, deletedAt: null },
        include: { division: true },
      });
      if (
        !branch ||
        (scope.companyId && branch.division.companyId !== scope.companyId) ||
        (scope.divisionId && branch.divisionId !== scope.divisionId)
      )
        throw new ForbiddenException('Draft branch does not match its organisation');
      scope.companyId = branch.division.companyId;
      scope.divisionId = branch.divisionId;
    }
    if (scope.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: scope.divisionId, deletedAt: null },
      });
      if (!division || (scope.companyId && division.companyId !== scope.companyId))
        throw new ForbiddenException('Draft division does not match its company');
      scope.companyId = division.companyId;
    }
    await this.companies.assertCanAccessCompany(user, scope.companyId, AccessLevel.WRITE);
    await this.organization.assertCanAccessScope(
      user,
      scope.divisionId,
      scope.branchId,
      AccessLevel.WRITE,
    );
    return scope;
  }
}
