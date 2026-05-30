import { Injectable } from '@nestjs/common';
import {
  EnterpriseCatalogEntry,
  REPORTS_CATALOG,
  ReportScope,
  ReportSector,
  enrichCatalogEntry,
} from './catalog';
import {
  DataQualityIssueStatus,
  InsightStatus,
  ReportRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';

interface CatalogQuery {
  sector?: string;
  scope?: string;
  search?: string;
}

@Injectable()
export class ReportsCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  list(query: CatalogQuery = {}) {
    const catalog = this.catalog();
    const sector = query.sector?.toUpperCase() as ReportSector | undefined;
    const scope = query.scope?.toUpperCase() as ReportScope | undefined;
    const search = query.search?.trim().toLowerCase();

    let entries: EnterpriseCatalogEntry[] = catalog;
    if (sector) entries = entries.filter((e) => e.sector === sector);
    if (scope) entries = entries.filter((e) => e.scopes.includes(scope));
    if (search) {
      entries = entries.filter((e) => {
        const haystack = [
          e.id,
          e.sector,
          e.category,
          e.name,
          e.description,
          e.permission,
          e.reportType,
          e.lifecycleStatus,
          e.owner,
          e.dataFreshness,
          e.securityClassification,
          ...e.tags,
          ...e.businessQuestions,
          ...e.drillPaths,
          ...e.relatedCapabilities,
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });
    }

    const sectors = Array.from(new Set(catalog.map((e) => e.sector))).sort();
    const sectorCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const lifecycleCounts: Record<string, number> = {};
    const securityCounts: Record<string, number> = {};
    for (const e of catalog) {
      sectorCounts[e.sector] = (sectorCounts[e.sector] ?? 0) + 1;
      typeCounts[e.reportType] = (typeCounts[e.reportType] ?? 0) + 1;
      lifecycleCounts[e.lifecycleStatus] = (lifecycleCounts[e.lifecycleStatus] ?? 0) + 1;
      securityCounts[e.securityClassification] = (securityCounts[e.securityClassification] ?? 0) + 1;
    }

    return {
      total: catalog.length,
      filtered: entries.length,
      sectors,
      sectorCounts,
      typeCounts,
      lifecycleCounts,
      securityCounts,
      generatedAt: new Date().toISOString(),
      entries,
    };
  }

  async commandCenter(user: AuthUser) {
    const catalog = this.catalog();
    const companyWhere = await this.companyScope.companyWhereFor(user);
    const [
      activeDefinitions,
      activeSchedules,
      failedRuns,
      requestedRuns,
      dashboards,
      openDataQuality,
      openInsights,
      statementRuns,
    ] = await Promise.all([
      this.prisma.reportDefinition.count({ where: { deletedAt: null, isActive: true } }),
      this.prisma.scheduledReport.count({ where: { deletedAt: null, isActive: true, ...companyWhere } }),
      this.prisma.reportRun.count({
        where: { status: ReportRunStatus.FAILED, ...companyWhere },
      }),
      this.prisma.reportRun.count({
        where: { status: { in: [ReportRunStatus.REQUESTED, ReportRunStatus.RUNNING] }, ...companyWhere },
      }),
      this.prisma.dashboardDefinition.count({ where: { deletedAt: null } }),
      this.prisma.dataQualityIssue.count({
        where: {
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          ...companyWhere,
        },
      }),
      this.prisma.executiveInsight.count({
        where: { deletedAt: null, status: InsightStatus.OPEN, ...companyWhere },
      }),
      this.prisma.financialStatementRun.count({ where: { ...companyWhere } }),
    ]);

    const generatedAt = new Date().toISOString();
    const lifecycleCounts = this.countBy(catalog, (entry) => entry.lifecycleStatus);
    const typeCounts = this.countBy(catalog, (entry) => entry.reportType);
    const securityCounts = this.countBy(catalog, (entry) => entry.securityClassification);
    const certifiedCount = (lifecycleCounts.CERTIFIED ?? 0) + (lifecycleCounts.OFFICIAL ?? 0);
    const sensitiveCount = (securityCounts.SENSITIVE ?? 0) + (securityCounts.RESTRICTED ?? 0);
    const liveCount = catalog.filter((entry) => entry.dataFreshness.toLowerCase().includes('live')).length;

    return {
      generatedAt,
      summary: {
        catalogReports: catalog.length,
        activeDefinitions,
        activeSchedules,
        failedRuns,
        requestedRuns,
        dashboards,
        openDataQuality,
        openInsights,
        statementRuns,
        certifiedCount,
        sensitiveCount,
        liveCount,
      },
      kpiTiles: [
        {
          key: 'catalogReports',
          label: 'Registered Reports',
          value: catalog.length,
          hint: 'Master catalog coverage across every sector',
          status: 'ok',
        },
        {
          key: 'certifiedCount',
          label: 'Certified / Official',
          value: certifiedCount,
          hint: 'Governed sources of truth',
          status: 'ok',
        },
        {
          key: 'activeSchedules',
          label: 'Active Schedules',
          value: activeSchedules,
          hint: 'Automated subscriptions and deliveries',
          status: activeSchedules > 0 ? 'ok' : 'watch',
        },
        {
          key: 'openDataQuality',
          label: 'Data Quality Issues',
          value: openDataQuality,
          hint: 'Open or acknowledged report trust issues',
          status: openDataQuality > 0 ? 'watch' : 'ok',
        },
        {
          key: 'failedRuns',
          label: 'Failed Runs',
          value: failedRuns,
          hint: 'Report executions requiring admin attention',
          status: failedRuns > 0 ? 'critical' : 'ok',
        },
        {
          key: 'openInsights',
          label: 'Open Insights',
          value: openInsights,
          hint: 'Anomaly or opportunity observations',
          status: openInsights > 0 ? 'watch' : 'ok',
        },
      ],
      dataFreshness: [
        { source: 'ERP transactions', mode: 'Live query', lastUpdated: generatedAt, status: 'READY' },
        { source: 'BI definitions', mode: 'Governed metadata', lastUpdated: generatedAt, status: activeDefinitions > 0 ? 'READY' : 'NEEDS_SETUP' },
        { source: 'Financial statement archive', mode: 'Generated snapshots', lastUpdated: generatedAt, status: statementRuns > 0 ? 'READY' : 'NEEDS_SETUP' },
        { source: 'Data quality checks', mode: 'Exception feed', lastUpdated: generatedAt, status: openDataQuality > 0 ? 'ATTENTION' : 'READY' },
      ],
      alerts: [
        {
          title: 'Data quality readiness',
          severity: openDataQuality > 0 ? 'HIGH' : 'LOW',
          message:
            openDataQuality > 0
              ? `${openDataQuality} open data-quality issue(s) can affect report trust.`
              : 'No open data-quality blockers detected in the current scope.',
          href: '/bi/data-quality',
        },
        {
          title: 'Scheduled report delivery',
          severity: failedRuns > 0 ? 'HIGH' : 'LOW',
          message:
            failedRuns > 0
              ? `${failedRuns} report run(s) failed and should be reviewed.`
              : 'No failed report runs detected in the current scope.',
          href: '/bi/report-runs',
        },
        {
          title: 'Executive insights',
          severity: openInsights > 0 ? 'MEDIUM' : 'LOW',
          message:
            openInsights > 0
              ? `${openInsights} open insight(s) require acknowledgement or resolution.`
              : 'No open executive insights detected in the current scope.',
          href: '/bi/insights',
        },
      ],
      capabilityAreas: this.capabilityAreas(),
      metricCatalog: this.metricCatalog(),
      reportPacks: this.reportPacks(),
      governance: this.governanceSnapshot(catalog),
      admin: {
        typeCounts,
        lifecycleCounts,
        securityCounts,
        activeDefinitions,
        activeSchedules,
        failedRuns,
        requestedRuns,
        dashboards,
        statementRuns,
      },
    };
  }

  dataCatalog() {
    return {
      generatedAt: new Date().toISOString(),
      metrics: this.metricCatalog(),
      datasets: [
        {
          key: 'general_ledger',
          name: 'General Ledger',
          owner: 'Group Finance',
          refreshMode: 'Live',
          sensitivity: 'SENSITIVE',
          validDimensions: ['Company', 'Account', 'Period', 'Branch', 'Division'],
          relatedReports: ['finance.trial-balance', 'finance.profit-and-loss', 'finance.balance-sheet'],
        },
        {
          key: 'sales_and_margin',
          name: 'Sales and Margin Analytics',
          owner: 'Commercial Operations',
          refreshMode: 'Live',
          sensitivity: 'CONFIDENTIAL',
          validDimensions: ['Customer', 'Product', 'Company', 'Branch', 'Channel', 'Period'],
          relatedReports: ['group.sales', 'operations.sales-summary', 'westsides.sales-by-product'],
        },
        {
          key: 'inventory_movements',
          name: 'Inventory Movements',
          owner: 'Operations Control',
          refreshMode: 'Live',
          sensitivity: 'INTERNAL',
          validDimensions: ['Product', 'Warehouse', 'Location', 'Company', 'Period'],
          relatedReports: ['operations.stock-valuation', 'operations.inventory-movements'],
        },
        {
          key: 'compliance_controls',
          name: 'Compliance Controls',
          owner: 'Risk and Compliance',
          refreshMode: 'Live with audit history',
          sensitivity: 'RESTRICTED',
          validDimensions: ['Company', 'Obligation', 'Tax Type', 'Document Status', 'Period'],
          relatedReports: ['compliance.obligations', 'compliance.tax-transactions', 'group.audit-trail'],
        },
      ],
      dimensions: [
        'Company',
        'Division',
        'Branch',
        'Account',
        'Product',
        'Customer',
        'Supplier',
        'Project',
        'Employee',
        'Currency',
        'Period',
        'Status',
      ],
    };
  }

  reportPacks() {
    return [
      {
        key: 'monthly-management-pack',
        name: 'Monthly Management Pack',
        owner: 'Group Finance',
        status: 'TEMPLATE_READY',
        cadence: 'Monthly',
        href: '/accounting-engine/financial-statements',
        sections: [
          'Executive summary',
          'Profit and Loss',
          'Balance Sheet',
          'Cash Flow',
          'Budget variance',
          'Working capital',
          'Operational exceptions',
          'Management commentary',
        ],
        prerequisites: [
          'Accounting period exists',
          'Sub-ledgers reviewed',
          'Inventory valuation reviewed',
          'Data-quality issues acknowledged',
        ],
      },
      {
        key: 'audit-evidence-pack',
        name: 'Audit Evidence Pack',
        owner: 'Risk and Compliance',
        status: 'TEMPLATE_READY',
        cadence: 'On demand',
        href: '/compliance/evidence-packs',
        sections: ['Audit trail', 'Financial statement snapshots', 'Source documents', 'Approvals', 'Export log'],
        prerequisites: ['Report parameters locked', 'Evidence documents attached', 'Reviewer assigned'],
      },
      {
        key: 'board-pack',
        name: 'Board Pack',
        owner: 'Executive Office',
        status: 'DESIGN_READY',
        cadence: 'Monthly / quarterly',
        href: '/bi/executive',
        sections: ['Executive KPI summary', 'Financial highlights', 'Cash and working capital', 'Risks', 'Opportunities', 'Forecast'],
        prerequisites: ['Management pack reviewed', 'Commentary completed', 'CFO approval'],
      },
      {
        key: 'tax-pack',
        name: 'Tax and Statutory Pack',
        owner: 'Tax and Compliance',
        status: 'DESIGN_READY',
        cadence: 'Monthly / statutory',
        href: '/compliance/reports',
        sections: ['VAT / WHT schedules', 'Tax transaction summary', 'Document status', 'Obligation status', 'Filing readiness'],
        prerequisites: ['Tax mappings complete', 'Open obligations reviewed', 'Compliance evidence attached'],
      },
    ];
  }

  governance() {
    return this.governanceSnapshot(this.catalog());
  }

  admin() {
    const catalog = this.catalog();
    return {
      generatedAt: new Date().toISOString(),
      typeCounts: this.countBy(catalog, (entry) => entry.reportType),
      lifecycleCounts: this.countBy(catalog, (entry) => entry.lifecycleStatus),
      securityCounts: this.countBy(catalog, (entry) => entry.securityClassification),
      ownerCounts: this.countBy(catalog, (entry) => entry.owner),
      recommendations: [
        'Assign named owners to every custom report definition before certification.',
        'Promote high-use validated reports to certified status after finance or data-owner review.',
        'Review sensitive and restricted reports for export controls before external distribution.',
        'Track failed scheduled reports as operational incidents.',
      ],
    };
  }

  viewerMetadata(reportId: string) {
    const entry = this.catalog().find((candidate) => candidate.id === reportId);
    if (!entry) return null;
    return {
      entry,
      viewer: {
        basis: entry.reportType === 'FINANCIAL_STATEMENT' ? 'Accrual by default, cash basis where endpoint supports it' : 'Operational basis',
        snapshotMode:
          entry.reportType === 'FINANCIAL_STATEMENT' || entry.reportType === 'COMPLIANCE' || entry.reportType === 'AUDIT'
            ? 'Snapshot capable'
            : 'Live view',
        lineage: entry.drillPaths,
        explainPrompts: entry.businessQuestions,
        recommendedActions: entry.relatedCapabilities,
      },
    };
  }

  private catalog(): EnterpriseCatalogEntry[] {
    return REPORTS_CATALOG.map(enrichCatalogEntry);
  }

  private countBy<T extends string>(
    entries: EnterpriseCatalogEntry[],
    pick: (entry: EnterpriseCatalogEntry) => T,
  ): Record<T, number> {
    return entries.reduce(
      (acc, entry) => {
        const key = pick(entry);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<T, number>,
    );
  }

  private capabilityAreas() {
    return {
      reports: [],
      dashboards: [
        { title: 'Executive BI Dashboard', desc: 'Group-level KPIs and executive intelligence.', href: '/bi/executive', badge: 'Live' },
        { title: 'BI Dashboards', desc: 'Configured dashboard definitions and widgets.', href: '/bi/dashboards', badge: 'Governed' },
        { title: 'Operations Reports', desc: 'Stock, sales, and purchase operational analytics.', href: '/operations/reports', badge: 'Ops' },
        { title: 'Finance Reports', desc: 'Financial statements, AR/AP, group and consolidated views.', href: '/finance/reports', badge: 'Finance' },
      ],
      kpis: [
        { title: 'KPI Library', desc: 'Owned KPI definitions, thresholds, targets, and status.', href: '/bi/kpis', badge: 'Metrics' },
        { title: 'KPI Snapshots', desc: 'Time-series KPI snapshots for trends and evidence.', href: '/bi/kpi-snapshots', badge: 'History' },
        { title: 'Executive Insights', desc: 'Anomaly and opportunity insights with lifecycle actions.', href: '/bi/insights', badge: 'Insights' },
      ],
      builder: [
        { title: 'Guided Report Builder', desc: 'Run governed custom reports with filters and saved views.', href: '/bi/report-builder', badge: 'Build' },
        { title: 'Report Definitions', desc: 'Manage user-authored report definitions and lifecycle.', href: '/bi/reports', badge: 'Definitions' },
        { title: 'Saved Views', desc: 'Private and shared report views with persisted parameters.', href: '/bi/saved-views', badge: 'Views' },
        { title: 'Report Runs', desc: 'Execution history, outputs, and failed run investigation.', href: '/bi/report-runs', badge: 'Runs' },
      ],
      packs: [
        { title: 'Financial Statements Archive', desc: 'Generated statements for close evidence and historical review.', href: '/accounting-engine/financial-statements', badge: 'Snapshot' },
        { title: 'Compliance Evidence Packs', desc: 'Audit and statutory evidence bundles with approval status.', href: '/compliance/evidence-packs', badge: 'Evidence' },
        { title: 'Finance Reports', desc: 'Generate the statement schedules used inside management packs.', href: '/finance/reports', badge: 'Schedules' },
      ],
      subscriptions: [
        { title: 'Scheduled Reports', desc: 'Automated report delivery, manual trigger, and last-run tracking.', href: '/bi/scheduled-reports', badge: 'Schedule' },
        { title: 'Analytics Runs', desc: 'Snapshot and analytics execution history.', href: '/bi/analytics-runs', badge: 'Runs' },
        { title: 'Report Runs', desc: 'Ad-hoc execution log and export history.', href: '/bi/report-runs', badge: 'Audit' },
      ],
      catalog: [
        { title: 'Report Definitions', desc: 'Certified and custom report objects in the reporting layer.', href: '/bi/reports', badge: 'Reports' },
        { title: 'Saved Views', desc: 'Persisted filter sets and default views by user or team.', href: '/bi/saved-views', badge: 'Views' },
        { title: 'Data Quality', desc: 'Data integrity findings that can affect report trust.', href: '/bi/data-quality', badge: 'Quality' },
      ],
      governance: [
        { title: 'Data Quality', desc: 'Open quality issues, broken mappings, and data readiness warnings.', href: '/bi/data-quality', badge: 'Quality' },
        { title: 'Audit Trail Report', desc: 'Group activity and reportable user action history.', href: '/reports/run?reportId=group.audit-trail', badge: 'Audit' },
        { title: 'Compliance Reports', desc: 'Obligations, tax movements, and document status summaries.', href: '/compliance/reports', badge: 'Controls' },
        { title: 'Evidence Packs', desc: 'Formal compliance and audit evidence bundles.', href: '/compliance/evidence-packs', badge: 'Evidence' },
      ],
      admin: [
        { title: 'BI Definitions', desc: 'Manage governed definitions that feed reporting and analytics.', href: '/bi/reports', badge: 'Models' },
        { title: 'Scheduled Reports', desc: 'Monitor scheduled report ownership and delivery failures.', href: '/bi/scheduled-reports', badge: 'Jobs' },
        { title: 'Report Runs', desc: 'Review slow, failed, exported, or high-volume report runs.', href: '/bi/report-runs', badge: 'Usage' },
        { title: 'Data Quality', desc: 'Track reporting readiness and quality exceptions.', href: '/bi/data-quality', badge: 'DQ' },
      ],
    };
  }

  private metricCatalog() {
    return [
      {
        metric: 'Net Sales',
        definition: 'Confirmed revenue less cancellations and approved deductions.',
        owner: 'Group Finance',
        formula: 'Confirmed sales orders and posted sales documents, net of reversals.',
        certificationStatus: 'CERTIFIED',
        trendDirection: 'Higher is favorable',
        dimensions: ['Customer', 'Product', 'Company', 'Branch', 'Period'],
        href: '/reports/run?reportId=group.sales',
      },
      {
        metric: 'Gross Margin',
        definition: 'Net sales less cost of goods sold, with drill-down to orders and ledger lines where posted.',
        owner: 'Group Finance',
        formula: 'Net Sales - Cost of Goods Sold',
        certificationStatus: 'CERTIFIED',
        trendDirection: 'Higher is favorable',
        dimensions: ['Product', 'Customer', 'Division', 'Period'],
        href: '/finance/reports',
      },
      {
        metric: 'Inventory Value',
        definition: 'Quantity on hand multiplied by average cost for the selected stock location.',
        owner: 'Operations Control',
        formula: 'Quantity on Hand * Average Cost',
        certificationStatus: 'VALIDATED',
        trendDirection: 'Context dependent',
        dimensions: ['Product', 'Branch', 'Location', 'Company'],
        href: '/reports/run?reportId=operations.stock-valuation',
      },
      {
        metric: 'Receivables Aging',
        definition: 'Open customer balances bucketed by overdue days.',
        owner: 'Group Finance',
        formula: 'Report Date - Invoice Due Date',
        certificationStatus: 'CERTIFIED',
        trendDirection: 'Lower overdue exposure is favorable',
        dimensions: ['Customer', 'Company', 'Period', 'Currency'],
        href: '/reports/run?reportId=finance.receivables-aging',
      },
      {
        metric: 'Payables Aging',
        definition: 'Open supplier balances bucketed by overdue days.',
        owner: 'Group Finance',
        formula: 'Report Date - Supplier Invoice Due Date',
        certificationStatus: 'CERTIFIED',
        trendDirection: 'Managed maturity is favorable',
        dimensions: ['Supplier', 'Company', 'Period', 'Currency'],
        href: '/reports/run?reportId=finance.payables-aging',
      },
    ];
  }

  private governanceSnapshot(catalog: EnterpriseCatalogEntry[]) {
    const missingOwners = catalog.filter((entry) => !entry.owner).length;
    const certified = catalog.filter(
      (entry) => entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL',
    ).length;
    const restricted = catalog.filter(
      (entry) => entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED',
    ).length;
    return {
      generatedAt: new Date().toISOString(),
      certified,
      validated: catalog.filter((entry) => entry.lifecycleStatus === 'VALIDATED').length,
      drafts: catalog.filter((entry) => entry.lifecycleStatus === 'DRAFT').length,
      missingOwners,
      restricted,
      rules: [
        'Official reports must have owner, lifecycle status, security classification, and output rules.',
        'Sensitive and restricted reports must be export-audited and delivered through secure links where possible.',
        'Financial statement reports should be snapshot-capable and traceable to journal evidence.',
        'Self-service reports should remain validated until business definition review is complete.',
      ],
    };
  }
}
