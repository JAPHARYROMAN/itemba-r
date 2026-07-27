/**
 * Master Reports Catalog (Sprint R1).
 *
 * Static registry of every report surfaced through the master Reports hub.
 * Each entry is a thin pointer to an existing backend endpoint + frontend
 * route — the catalog itself does NOT execute reports, it just tells the UI
 * what's available, what scopes the report supports, and where to render it.
 *
 * As new reports land (R2 group rollups, R3 division-scope retrofits, R4
 * cross-sector reports), they're appended here so the master hub picks them
 * up automatically. The shape is intentionally small — anything richer
 * belongs in the actual report endpoint, not the catalog.
 */

export type ReportSector =
  | 'FINANCE'
  | 'HR'
  | 'OPERATIONS'
  | 'PETROLEUM'
  | 'WESTSIDES'
  | 'COMPLIANCE'
  | 'ITEMBA'
  | 'AGRICULTURE'
  | 'CONSTRUCTION'
  | 'LOGISTICS'
  | 'RECORDS_BOOK'
  | 'BI';

export type ReportScope = 'GROUP' | 'COMPANY' | 'DIVISION';

export type ReportType =
  | 'FINANCIAL_STATEMENT'
  | 'OPERATIONAL'
  | 'ANALYTICAL'
  | 'COMPLIANCE'
  | 'AUDIT'
  | 'DASHBOARD'
  | 'SELF_SERVICE';

export type ReportLifecycleStatus = 'DRAFT' | 'VALIDATED' | 'CERTIFIED' | 'OFFICIAL' | 'ARCHIVED';

export type SecurityClassification = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'SENSITIVE';

export interface CatalogEntry {
  id: string;
  sector: ReportSector;
  category: string;
  name: string;
  description: string;
  scopes: ReportScope[];
  permission: string;
  apiPath: string;
  frontendPath: string;
}

export interface EnterpriseCatalogEntry extends CatalogEntry {
  reportType: ReportType;
  lifecycleStatus: ReportLifecycleStatus;
  owner: string;
  dataFreshness: string;
  securityClassification: SecurityClassification;
  outputFormats: string[];
  tags: string[];
  businessQuestions: string[];
  drillPaths: string[];
  relatedCapabilities: string[];
}

const SECTOR_OWNERS: Record<ReportSector, string> = {
  FINANCE: 'Group Finance',
  HR: 'People Operations',
  OPERATIONS: 'Operations Control',
  PETROLEUM: 'Petroleum Operations',
  WESTSIDES: 'Westsides Commercial',
  COMPLIANCE: 'Risk and Compliance',
  ITEMBA: 'Group Executive Office',
  AGRICULTURE: 'Agriculture Operations',
  CONSTRUCTION: 'Construction Operations',
  LOGISTICS: 'Logistics Operations',
  RECORDS_BOOK: 'Records Book Control',
  BI: 'Data and Analytics',
};

function inferReportType(entry: CatalogEntry): ReportType {
  const text = `${entry.id} ${entry.category} ${entry.name}`.toLowerCase();
  if (entry.sector === 'BI') return 'SELF_SERVICE';
  if (text.includes('dashboard') || text.includes('cockpit')) return 'DASHBOARD';
  if (text.includes('audit')) return 'AUDIT';
  if (entry.sector === 'COMPLIANCE' || text.includes('tax') || text.includes('obligation'))
    return 'COMPLIANCE';
  if (
    entry.sector === 'FINANCE' ||
    text.includes('trial-balance') ||
    text.includes('profit') ||
    text.includes('balance sheet') ||
    text.includes('cash flow') ||
    text.includes('aging') ||
    text.includes('intercompany')
  ) {
    return 'FINANCIAL_STATEMENT';
  }
  if (text.includes('summary') || text.includes('performance') || text.includes('profitability'))
    return 'ANALYTICAL';
  return 'OPERATIONAL';
}

function inferLifecycleStatus(entry: CatalogEntry, reportType: ReportType): ReportLifecycleStatus {
  if (reportType === 'AUDIT' || reportType === 'COMPLIANCE') return 'OFFICIAL';
  if (reportType === 'SELF_SERVICE') return 'VALIDATED';
  if (reportType === 'FINANCIAL_STATEMENT' || reportType === 'DASHBOARD') return 'CERTIFIED';
  return 'VALIDATED';
}

function inferSecurity(entry: CatalogEntry, reportType: ReportType): SecurityClassification {
  if (reportType === 'AUDIT' || reportType === 'COMPLIANCE') return 'RESTRICTED';
  if (entry.sector === 'HR' || entry.sector === 'FINANCE') return 'SENSITIVE';
  if (entry.sector === 'BI' || entry.sector === 'RECORDS_BOOK') return 'CONFIDENTIAL';
  return 'INTERNAL';
}

function inferFreshness(entry: CatalogEntry, reportType: ReportType): string {
  if (reportType === 'SELF_SERVICE') return 'Saved definition and execution history';
  if (reportType === 'FINANCIAL_STATEMENT') return 'Live ledger, snapshot capable';
  if (reportType === 'COMPLIANCE' || reportType === 'AUDIT')
    return 'Live controls with audit history';
  if (reportType === 'DASHBOARD') return 'Live operational cockpit';
  return 'Live operational transactions';
}

function inferOutputs(reportType: ReportType): string[] {
  if (reportType === 'DASHBOARD') return ['HTML', 'PDF', 'JSON'];
  if (reportType === 'SELF_SERVICE') return ['HTML', 'CSV', 'XLSX', 'JSON'];
  if (reportType === 'AUDIT' || reportType === 'COMPLIANCE')
    return ['HTML', 'PDF', 'CSV', 'Evidence Pack'];
  return ['HTML', 'PDF', 'CSV', 'XLSX'];
}

function inferTags(entry: CatalogEntry, reportType: ReportType): string[] {
  const base = [
    entry.sector.toLowerCase(),
    entry.category.toLowerCase(),
    reportType.toLowerCase().replace(/_/g, '-'),
    ...entry.scopes.map((scope) => scope.toLowerCase()),
  ];
  const words = entry.name
    .toLowerCase()
    .replace(/&/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  return Array.from(new Set([...base, ...words]));
}

function inferBusinessQuestions(entry: CatalogEntry, reportType: ReportType): string[] {
  if (reportType === 'FINANCIAL_STATEMENT') {
    return [
      'What happened financially?',
      'Which account or entity explains the variance?',
      'Can this number be traced to ledger evidence?',
    ];
  }
  if (reportType === 'AUDIT' || reportType === 'COMPLIANCE') {
    return [
      'What must be reported formally?',
      'Which controls or obligations need attention?',
      'Who changed or approved the record?',
    ];
  }
  if (reportType === 'DASHBOARD') {
    return [
      'What is happening now?',
      'Which exceptions require action?',
      'Which KPI should be investigated first?',
    ];
  }
  if (reportType === 'SELF_SERVICE') {
    return [
      'Which governed dataset can answer this question?',
      'Can users save, schedule, or share this view?',
      'Which reports were run or exported?',
    ];
  }
  return [
    'What is happening operationally?',
    'Where are bottlenecks or exceptions?',
    'Which source transactions explain the result?',
  ];
}

function inferDrillPaths(entry: CatalogEntry, reportType: ReportType): string[] {
  if (reportType === 'FINANCIAL_STATEMENT')
    return ['Statement line', 'Account', 'Journal entry', 'Source document'];
  if (entry.sector === 'OPERATIONS')
    return ['Summary', 'Branch or location', 'Product or order', 'Source transaction'];
  if (entry.sector === 'WESTSIDES')
    return ['Summary', 'Customer or product', 'Invoice or order', 'Payment or delivery'];
  if (entry.sector === 'PETROLEUM')
    return ['Summary', 'Station or shift', 'Tank or sale', 'Reconciliation record'];
  if (entry.sector === 'RECORDS_BOOK')
    return ['Summary', 'Date or grouping', 'Manual source record'];
  if (reportType === 'AUDIT' || reportType === 'COMPLIANCE')
    return ['Finding', 'Entity', 'User action', 'Evidence'];
  return ['Summary', 'Dimension', 'Record', 'Audit trail'];
}

function inferRelatedCapabilities(reportType: ReportType): string[] {
  if (reportType === 'SELF_SERVICE') return ['Builder', 'Saved Views', 'Report Runs', 'Scheduling'];
  if (reportType === 'FINANCIAL_STATEMENT')
    return ['Financial Statements Archive', 'Report Packs', 'Lineage', 'Export'];
  if (reportType === 'AUDIT' || reportType === 'COMPLIANCE')
    return ['Evidence Packs', 'Audit Trail', 'Approvals', 'Retention'];
  if (reportType === 'DASHBOARD') return ['KPIs', 'Alerts', 'Executive Insights', 'Subscriptions'];
  return ['Operational Drill-through', 'Exceptions', 'Export', 'Workflow'];
}

export function enrichCatalogEntry(entry: CatalogEntry): EnterpriseCatalogEntry {
  const reportType = inferReportType(entry);
  return {
    ...entry,
    reportType,
    lifecycleStatus: inferLifecycleStatus(entry, reportType),
    owner: SECTOR_OWNERS[entry.sector],
    dataFreshness: inferFreshness(entry, reportType),
    securityClassification: inferSecurity(entry, reportType),
    outputFormats: inferOutputs(reportType),
    tags: inferTags(entry, reportType),
    businessQuestions: inferBusinessQuestions(entry, reportType),
    drillPaths: inferDrillPaths(entry, reportType),
    relatedCapabilities: inferRelatedCapabilities(reportType),
  };
}

export const REPORTS_CATALOG: CatalogEntry[] = [
  // ── FINANCE ──────────────────────────────────────────────────────────────
  {
    id: 'finance.company-summary',
    sector: 'FINANCE',
    category: 'Statements',
    name: 'Company Summary',
    description: 'High-level financial KPIs for one company.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/company-summary/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group-summary',
    sector: 'FINANCE',
    category: 'Statements',
    name: 'Group Summary',
    description: 'Top-line numbers rolled up across every company.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group-summary',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.trial-balance',
    sector: 'FINANCE',
    category: 'Statements',
    name: 'Trial Balance',
    description: 'All accounts with debit/credit totals for a period.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/trial-balance/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.profit-and-loss',
    sector: 'FINANCE',
    category: 'Statements',
    name: 'Profit & Loss',
    description: 'Income vs expenses for a date range.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/profit-and-loss/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.balance-sheet',
    sector: 'FINANCE',
    category: 'Statements',
    name: 'Balance Sheet',
    description: 'Assets, liabilities, equity as of a date.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/balance-sheet/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.cash-flow',
    sector: 'FINANCE',
    category: 'Statements',
    name: 'Cash Flow Statement',
    description: 'Cash movements for a period.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/cash-flow/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.receivables-aging',
    sector: 'FINANCE',
    category: 'AR / AP',
    name: 'Receivables Aging',
    description: 'Open AR bucketed by days overdue.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/receivables-aging/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.payables-aging',
    sector: 'FINANCE',
    category: 'AR / AP',
    name: 'Payables Aging',
    description: 'Open AP bucketed by days overdue.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/payables-aging/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.customer-aging',
    sector: 'FINANCE',
    category: 'AR / AP',
    name: 'Customer Credit Aging',
    description: 'Open AR per customer, bucketed by days overdue with oldest age.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/customer-aging/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.supplier-aging',
    sector: 'FINANCE',
    category: 'AR / AP',
    name: 'Supplier Aging',
    description: 'Open AP per supplier, bucketed by days overdue.',
    scopes: ['COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/supplier-aging/{companyId}',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.intercompany',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Intercompany Balances',
    description: 'Net positions between every pair of group companies.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/intercompany-balances',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group.trial-balance',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Group Trial Balance',
    description: "Sums every company's posted lines by accountCode (pre-consolidation).",
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group/trial-balance',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group.profit-and-loss',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Group Profit & Loss',
    description: 'Income, COGS, expenses summed across companies for a period.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group/profit-and-loss',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group.balance-sheet',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Group Balance Sheet',
    description: 'Assets, liabilities, equity summed across companies as-of a date.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group/balance-sheet',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group.receivables-aging',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Group Receivables Aging',
    description: 'Open AR bucketed by days overdue, summed across companies.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group/receivables-aging',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group.payables-aging',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Group Payables Aging',
    description: 'Open AP bucketed by days overdue, summed across companies.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group/payables-aging',
    frontendPath: '/finance/reports',
  },
  {
    id: 'finance.group.cash-position',
    sector: 'FINANCE',
    category: 'Group',
    name: 'Group Cash Position',
    description: 'Current balance of every cash/bank account, grouped by company.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/financial-reports/group/cash-position',
    frontendPath: '/finance/reports',
  },

  // ── GROUP CROSS-SECTOR (R4) ──────────────────────────────────────────────
  {
    id: 'group.sales',
    sector: 'FINANCE',
    category: 'Group Cross-sector',
    name: 'Group Sales',
    description: 'Confirmed sales across all companies, with company + division breakdown.',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/group-reports/sales',
    frontendPath: '/reports',
  },
  {
    id: 'group.activity-feed',
    sector: 'FINANCE',
    category: 'Group Cross-sector',
    name: 'Group Activity Feed',
    description: 'Recent material events across every sector (audit-sourced).',
    scopes: ['GROUP'],
    permission: 'finance.reports.view',
    apiPath: '/group-reports/activity-feed',
    frontendPath: '/reports',
  },
  {
    id: 'group.audit-trail',
    sector: 'COMPLIANCE',
    category: 'Audit',
    name: 'Group Audit Trail',
    description: 'Filterable audit log with paginated rows + entity/action histograms.',
    scopes: ['GROUP', 'COMPANY'],
    permission: 'finance.reports.view',
    apiPath: '/group-reports/audit-trail',
    frontendPath: '/reports',
  },

  // ── HR ───────────────────────────────────────────────────────────────────
  {
    id: 'hr.employees',
    sector: 'HR',
    category: 'People',
    name: 'Employees',
    description: 'Active employees with department + role breakdowns.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'hr.reports.view',
    apiPath: '/hr/reports/employees',
    frontendPath: '/hr/reports',
  },
  {
    id: 'hr.attendance',
    sector: 'HR',
    category: 'People',
    name: 'Attendance',
    description: 'Attendance summary by employee + date range.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'hr.reports.view',
    apiPath: '/hr/reports/attendance',
    frontendPath: '/hr/reports',
  },
  {
    id: 'hr.payroll',
    sector: 'HR',
    category: 'Payroll',
    name: 'Payroll Summary',
    description: 'Gross, statutory, net per run. PayrollRun is company-scoped — no division split.',
    scopes: ['COMPANY'],
    permission: 'hr.reports.view',
    apiPath: '/hr/reports/payroll',
    frontendPath: '/hr/reports',
  },
  {
    id: 'hr.leave',
    sector: 'HR',
    category: 'People',
    name: 'Leave Balances',
    description: 'Accrued + taken + balance per employee.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'hr.reports.view',
    apiPath: '/hr/reports/leave',
    frontendPath: '/hr/reports',
  },
  {
    id: 'hr.statutory',
    sector: 'HR',
    category: 'Payroll',
    name: 'Statutory Filings',
    description: 'PAYE / NSSF / WCF / SDL / NHIF / HESLB by month.',
    scopes: ['COMPANY'],
    permission: 'hr.reports.view',
    apiPath: '/hr/reports/payroll',
    frontendPath: '/hr/reports/statutory',
  },
  {
    id: 'hr.wcf-exposure',
    sector: 'HR',
    category: 'Payroll',
    name: 'WCF Exposure',
    description: 'Workers comp exposure projection.',
    scopes: ['COMPANY'],
    permission: 'hr.reports.view',
    apiPath: '/hr/reports/payroll',
    frontendPath: '/hr/reports/wcf-exposure',
  },

  // ── OPERATIONS ───────────────────────────────────────────────────────────
  {
    id: 'ops.stock-valuation',
    sector: 'OPERATIONS',
    category: 'Inventory',
    name: 'Stock Valuation',
    description: 'Inventory at cost per location.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/stock-valuation',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.low-stock',
    sector: 'OPERATIONS',
    category: 'Inventory',
    name: 'Reorder / Low Stock',
    description: 'Products at or below reorder/minimum level, with shortage quantity.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/low-stock',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.stock-ageing',
    sector: 'OPERATIONS',
    category: 'Inventory',
    name: 'Stock Ageing / Slow-Moving',
    description: 'Days since last movement per product, with capital at risk in slow stock.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/stock-ageing',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.branch-profitability',
    sector: 'OPERATIONS',
    category: 'Sales',
    name: 'Branch Profitability',
    description: 'Revenue, COGS, gross profit and margin% per branch from confirmed sales.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/branch-profitability',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.sales-summary',
    sector: 'OPERATIONS',
    category: 'Sales',
    name: 'Sales Summary',
    description: 'Sales aggregates for a date range.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/sales-summary',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.customer-product-sales',
    sector: 'OPERATIONS',
    category: 'Customers',
    name: 'Customer Product Sales',
    description: 'What each customer bought, grouped by customer and product.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/customer-product-sales',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.purchase-summary',
    sector: 'OPERATIONS',
    category: 'Procurement',
    name: 'Purchase Summary',
    description: 'Purchases aggregates for a date range.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/purchase-summary',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.supplier-product-purchases',
    sector: 'OPERATIONS',
    category: 'Procurement',
    name: 'Supplier Product Purchases',
    description: 'What was bought from each supplier, grouped by supplier and product.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/supplier-product-purchases',
    frontendPath: '/operations/reports/suppliers',
  },
  {
    id: 'ops.supplier-360',
    sector: 'OPERATIONS',
    category: 'Suppliers',
    name: 'Supplier 360',
    description: 'Supplier profile, purchases, invoice references, products and payable exposure.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/supplier-360',
    frontendPath: '/operations/reports/suppliers',
  },
  {
    id: 'ops.supplier-purchases-invoices',
    sector: 'OPERATIONS',
    category: 'Suppliers',
    name: 'Supplier Purchases and Invoices',
    description: 'Purchase history with supplier invoice coverage, values and settlement status.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/supplier-360?section=PURCHASES',
    frontendPath: '/operations/reports/suppliers?section=PURCHASES',
  },
  {
    id: 'ops.inventory-movements',
    sector: 'OPERATIONS',
    category: 'Inventory',
    name: 'Inventory Movements',
    description: 'Paginated movement log.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'operations.reports.view',
    apiPath: '/operations-reports/inventory-movements',
    frontendPath: '/operations/reports',
  },
  {
    id: 'ops.product-profitability',
    sector: 'OPERATIONS',
    category: 'Profit',
    name: 'Product Profitability',
    description: 'Revenue, COGS, gross profit, and margin by product.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'profit.view',
    apiPath: '/profit/product-summary',
    frontendPath: '/operations/profit',
  },
  {
    id: 'ops.sales-margin',
    sector: 'OPERATIONS',
    category: 'Profit',
    name: 'Sales Margin',
    description: 'Confirmed sales margin using frozen line-level cost snapshots.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'profit.view',
    apiPath: '/profit/product-summary',
    frontendPath: '/operations/profit',
  },
  {
    id: 'ops.cost-gaps',
    sector: 'OPERATIONS',
    category: 'Profit',
    name: 'Cost Gaps',
    description: 'Products and branch balances blocked from selling until costs are fixed.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'profit.view',
    apiPath: '/profit/cost-gaps',
    frontendPath: '/operations/profit',
  },
  {
    id: 'ops.below-cost-attempt-audit',
    sector: 'OPERATIONS',
    category: 'Profit',
    name: 'Below-Cost Attempt Audit',
    description: 'Audit trail and validation surface for attempted below-cost sales.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'profit.audit',
    apiPath: '/profit/below-cost-attempts',
    frontendPath: '/operations/profit',
  },

  // ── RECORDS BOOK ─────────────────────────────────────────────────────────
  {
    id: 'record-book.daily-sales',
    sector: 'RECORDS_BOOK',
    category: 'Sales',
    name: 'Daily Sales Report',
    description: 'Manual day-end sales totals with their receipt-method split.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/daily-sales',
    frontendPath: '/record-book/reports?report=daily-sales',
  },
  {
    id: 'record-book.receipt-methods',
    sector: 'RECORDS_BOOK',
    category: 'Sales',
    name: 'Sales by Receipt Method',
    description: 'Manual sales grouped by cash, mobile money, bank, card, and other receipts.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/receipt-methods',
    frontendPath: '/record-book/reports?report=receipt-methods',
  },
  {
    id: 'record-book.expenses-by-category',
    sector: 'RECORDS_BOOK',
    category: 'Money Out',
    name: 'Expenses by Category',
    description: 'Manual money-out totals grouped by Records Book category.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/expenses-by-category',
    frontendPath: '/record-book/reports?report=expenses-by-category',
  },
  {
    id: 'record-book.expenses-by-payee',
    sector: 'RECORDS_BOOK',
    category: 'Money Out',
    name: 'Expenses by Payee',
    description: 'Manual money-out totals grouped by the person or organization paid.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/expenses-by-payee',
    frontendPath: '/record-book/reports?report=expenses-by-payee',
  },
  {
    id: 'record-book.net-movement',
    sector: 'RECORDS_BOOK',
    category: 'Movement',
    name: 'Daily Net Movement',
    description: 'Manual daily sales less manual money out.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/net-movement',
    frontendPath: '/record-book/reports?report=net-movement',
  },
  {
    id: 'record-book.branch-comparison',
    sector: 'RECORDS_BOOK',
    category: 'Movement',
    name: 'Records Book Branch Comparison',
    description: 'Manual recorded sales, expenses, and net movement compared by branch.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/branch-comparison',
    frontendPath: '/record-book/reports?report=branch-comparison',
  },
  {
    id: 'record-book.monthly-trend',
    sector: 'RECORDS_BOOK',
    category: 'Trend',
    name: 'Monthly Sales and Expense Trend',
    description: 'Monthly movement of manual recorded sales, expenses, and net position.',
    scopes: ['COMPANY', 'DIVISION'],
    permission: 'record_book.view',
    apiPath: '/record-book/reports/monthly-trend',
    frontendPath: '/record-book/reports?report=monthly-trend',
  },

  // ── PETROLEUM ────────────────────────────────────────────────────────────
  // ── WESTSIDES ────────────────────────────────────────────────────────────
  {
    id: 'westsides.daily-close',
    sector: 'WESTSIDES',
    category: 'Daily',
    name: 'Daily Close (Z-Report)',
    description: 'Single-day reconciliation aggregate.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/daily-close',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.daily-sales',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Daily Sales Summary',
    description: 'Daily sales aggregation.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/daily-sales-summary',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.monthly-sales',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Monthly Sales Summary',
    description: 'Monthly sales aggregation.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/monthly-sales-summary',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.sales-by-channel',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Sales by Channel',
    description: 'POS / wholesale / online split.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/sales-by-channel',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.sales-by-product',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Sales by Product',
    description: 'Revenue per SKU.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/sales-by-product',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.customer-product-sales',
    sector: 'WESTSIDES',
    category: 'Customers',
    name: 'Customer Product Sales',
    description: 'What each customer bought, grouped by customer and product.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/customer-product-sales',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.sales-by-cashier',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Sales by Cashier',
    description: 'Revenue per salesperson.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/sales-by-cashier',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.fast-moving',
    sector: 'WESTSIDES',
    category: 'Inventory',
    name: 'Fast-Moving Items',
    description: 'Top-20 fastest-moving SKUs.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/fast-moving-items',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.slow-moving',
    sector: 'WESTSIDES',
    category: 'Inventory',
    name: 'Slow-Moving Items',
    description: 'Items without sales in 30 days.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/slow-moving-items',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.product-profitability',
    sector: 'WESTSIDES',
    category: 'Inventory',
    name: 'Product Profitability',
    description: 'Revenue vs cost per product.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/product-profitability',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.batch-status',
    sector: 'WESTSIDES',
    category: 'Inventory',
    name: 'Batch Status',
    description: 'Batches with quantity + expiry.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/batch-status',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.stock-damage',
    sector: 'WESTSIDES',
    category: 'Inventory',
    name: 'Stock Damage',
    description: 'Damage records by type.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/stock-damage-report',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.package-balance',
    sector: 'WESTSIDES',
    category: 'Customers',
    name: 'Customer Package Balances',
    description: 'Returnable package balances per customer.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/package-balance-report',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.quotation-conversion',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Quotation Conversion',
    description: 'Quote → order conversion rates.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/quotation-conversion',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.delivery-performance',
    sector: 'WESTSIDES',
    category: 'Sales',
    name: 'Delivery Performance',
    description: 'Delivery notes by status.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/delivery-performance',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.price-list',
    sector: 'WESTSIDES',
    category: 'Catalog',
    name: 'Price Lists',
    description: 'Active price lists with item counts.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/price-list-report',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.supplier-product-purchases',
    sector: 'WESTSIDES',
    category: 'Suppliers',
    name: 'Supplier Product Purchases',
    description: 'What was bought from each supplier, grouped by supplier and product.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/supplier-product-purchases',
    frontendPath: '/westsides/reports',
  },
  {
    id: 'westsides.credit-customers',
    sector: 'WESTSIDES',
    category: 'Customers',
    name: 'Credit Customers',
    description: 'Customers with open AR balances.',
    scopes: ['COMPANY'],
    permission: 'westsides.reports.view',
    apiPath: '/westsides/reports/credit-customers-report',
    frontendPath: '/westsides/reports',
  },

  // ── COMPLIANCE ───────────────────────────────────────────────────────────
  {
    id: 'compliance.obligations',
    sector: 'COMPLIANCE',
    category: 'Obligations',
    name: 'Obligations Summary',
    description: 'Statutory + contractual obligations status.',
    scopes: ['COMPANY'],
    permission: 'compliance.reports.view',
    apiPath: '/compliance/reports/obligations-summary',
    frontendPath: '/compliance/reports',
  },
  {
    id: 'compliance.tax-transactions',
    sector: 'COMPLIANCE',
    category: 'Tax',
    name: 'Tax Transactions',
    description: 'VAT / WHT / income tax movements.',
    scopes: ['COMPANY'],
    permission: 'compliance.reports.view',
    apiPath: '/compliance/reports/tax-transactions-summary',
    frontendPath: '/compliance/reports',
  },
  {
    id: 'compliance.documents',
    sector: 'COMPLIANCE',
    category: 'Documents',
    name: 'Document Status',
    description: 'Licenses + certifications by status.',
    scopes: ['COMPANY'],
    permission: 'compliance.reports.view',
    apiPath: '/compliance/reports/document-status-summary',
    frontendPath: '/compliance/reports',
  },

  // ── ITEMBA — capstone cockpit + per sub-division ─────────────────────────
  // ── CONSTRUCTION (Itemba sub-division) ──────────────────────────────────
  // ── BI / advanced ────────────────────────────────────────────────────────
];
