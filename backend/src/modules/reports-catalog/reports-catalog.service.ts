import { createHash } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EnterpriseCatalogEntry,
  ReportLifecycleStatus,
  REPORTS_CATALOG,
  ReportScope,
  ReportSector,
  enrichCatalogEntry,
} from './catalog';
import {
  AccessLevel,
  AuditSeverity,
  DataExportStatus,
  DataExportType,
  DataQualityIssueStatus,
  FinancialStatementType,
  InsightStatus,
  Prisma,
  ReportRunStatus,
  StatementRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

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
    private readonly auditLogs: AuditLogsService,
  ) {}

  list(query: CatalogQuery = {}) {
    const catalog = this.catalog();
    const sector = query.sector?.toUpperCase() as ReportSector | undefined;
    const scope = query.scope?.toUpperCase() as ReportScope | undefined;
    const search = query.search?.trim().toLowerCase();
    const searchTerms = search ? this.expandSearchTerms(search) : [];

    let entries: EnterpriseCatalogEntry[] = catalog;
    if (sector) entries = entries.filter((e) => e.sector === sector);
    if (scope) entries = entries.filter((e) => e.scopes.includes(scope));
    if (searchTerms.length) {
      entries = entries
        .map((entry) => ({ entry, score: this.discoveryScore(entry, searchTerms) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
        .map((row) => row.entry);
    }

    const sectors = Array.from(new Set(catalog.map((e) => e.sector))).sort();
    const sectorCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    const lifecycleCounts: Record<string, number> = {};
    const securityCounts: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const ownerCounts: Record<string, number> = {};
    for (const e of catalog) {
      sectorCounts[e.sector] = (sectorCounts[e.sector] ?? 0) + 1;
      typeCounts[e.reportType] = (typeCounts[e.reportType] ?? 0) + 1;
      lifecycleCounts[e.lifecycleStatus] = (lifecycleCounts[e.lifecycleStatus] ?? 0) + 1;
      securityCounts[e.securityClassification] = (securityCounts[e.securityClassification] ?? 0) + 1;
      categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
      ownerCounts[e.owner] = (ownerCounts[e.owner] ?? 0) + 1;
    }

    return {
      total: catalog.length,
      filtered: entries.length,
      sectors,
      sectorCounts,
      typeCounts,
      lifecycleCounts,
      securityCounts,
      categoryCounts,
      ownerCounts,
      generatedAt: new Date().toISOString(),
      searchIntent: search
        ? {
            query: search,
            expandedTerms: searchTerms,
            matchedReports: entries.length,
          }
        : null,
      facets: this.discoveryFacets(catalog),
      suggestedSearches: this.suggestedSearches(),
      businessQuestionIndex: this.businessQuestionIndex(catalog),
      featuredCollections: this.featuredCollections(catalog),
      personaCollections: this.personaCollections(catalog),
      actionLanes: this.actionLanes(catalog),
      coverageMatrix: this.coverageMatrix(catalog),
      readinessGaps: this.readinessGaps(catalog),
      discoveryHealth: this.discoveryHealth(catalog),
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
    const [dataQualitySurface] = await Promise.all([this.dataQualitySurface(user, catalog)]);
    const integrationReadiness = this.integrationReadiness(catalog);
    const governance = this.governanceSnapshot(catalog);

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
      dataQualitySurface,
      integrationReadiness,
      governance,
      discovery: {
        health: this.discoveryHealth(catalog),
        commandScore: this.commandCenterScore(catalog, {
          activeDefinitions,
          activeSchedules,
          failedRuns,
          requestedRuns,
          dashboards,
          openDataQuality,
          openInsights,
          statementRuns,
        }),
        suggestedSearches: this.suggestedSearches(),
        businessQuestions: this.businessQuestionIndex(catalog).slice(0, 12),
        featuredCollections: this.featuredCollections(catalog),
        personaCollections: this.personaCollections(catalog),
        actionLanes: this.actionLanes(catalog),
        coverageMatrix: this.coverageMatrix(catalog),
        readinessGaps: this.readinessGaps(catalog),
        certifiedHighlights: catalog
          .filter((entry) => entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL')
          .slice(0, 8),
      },
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
          relatedReports: ['group.sales', 'ops.sales-summary', 'westsides.sales-by-product'],
        },
        {
          key: 'inventory_movements',
          name: 'Inventory Movements',
          owner: 'Operations Control',
          refreshMode: 'Live',
          sensitivity: 'INTERNAL',
          validDimensions: ['Product', 'Warehouse', 'Location', 'Company', 'Period'],
          relatedReports: ['ops.stock-valuation', 'ops.inventory-movements'],
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

  async dataQualitySurface(
    user: AuthUser,
    catalog: EnterpriseCatalogEntry[] = this.catalog(),
    query: Record<string, unknown> = {},
  ) {
    const companyId = stringValue(query.companyId);
    const companyWhere = await this.companyScope.companyWhereFor(user, companyId);
    const issues = await this.prisma.dataQualityIssue.findMany({
      where: {
        ...companyWhere,
        status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
      },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: 30,
      select: {
        id: true,
        issueNumber: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        entityType: true,
        detectedAt: true,
      },
    });
    const severityCounts = this.countTextValues(issues.map((issue) => String(issue.severity ?? 'UNKNOWN')));
    const sourceCounts = this.countTextValues(issues.map((issue) => issue.entityType ?? 'unknown'));
    const financeReports = catalog.filter((entry) => entry.sector === 'FINANCE');
    const operationsReports = catalog.filter((entry) => entry.sector === 'OPERATIONS');
    const high = severityCounts.HIGH ?? 0;
    const critical = severityCounts.CRITICAL ?? 0;
    const medium = severityCounts.MEDIUM ?? 0;
    const readinessScore = Math.max(70, 100 - critical * 10 - high * 6 - medium * 3 - Math.min(issues.length, 10));
    const surfaceWarnings = [
      {
        key: 'accounting-periods',
        title: 'Accounting period coverage',
        severity: 'HIGH',
        reportCount: financeReports.length,
        affectedReports: financeReports
          .filter((entry) => entry.reportType === 'FINANCIAL_STATEMENT' || entry.category.includes('Group'))
          .slice(0, 6)
          .map((entry) => ({ id: entry.id, name: entry.name, href: `/reports/run?reportId=${entry.id}` })),
        remediation: 'Create or open accounting periods before treating financial outputs as official.',
      },
      {
        key: 'cash-account-mapping',
        title: 'Cash and bank account mapping',
        severity: 'HIGH',
        reportCount: financeReports.filter((entry) => entry.id.includes('cash') || entry.name.toLowerCase().includes('cash')).length,
        affectedReports: financeReports
          .filter((entry) => entry.id.includes('cash') || entry.name.toLowerCase().includes('cash'))
          .map((entry) => ({ id: entry.id, name: entry.name, href: `/reports/run?reportId=${entry.id}` })),
        remediation: 'Tag cash/bank chart-of-account rows with the expected accountSubType values.',
      },
      {
        key: 'inventory-cost-basis',
        title: 'Inventory cost and movement completeness',
        severity: 'MEDIUM',
        reportCount: operationsReports.length,
        affectedReports: operationsReports
          .filter((entry) => entry.category === 'Inventory' || entry.name.toLowerCase().includes('stock'))
          .map((entry) => ({ id: entry.id, name: entry.name, href: `/reports/run?reportId=${entry.id}` })),
        remediation: 'Review inventory balances, movements, product costing, and negative-stock exceptions.',
      },
      {
        key: 'source-posting-bridge',
        title: 'Operations-to-finance posting bridge',
        severity: 'MEDIUM',
        reportCount: catalog.filter((entry) => ['FINANCE', 'OPERATIONS'].includes(entry.sector)).length,
        affectedReports: [...operationsReports.slice(0, 4), ...financeReports.slice(0, 4)].map((entry) => ({
          id: entry.id,
          name: entry.name,
          href: `/reports/run?reportId=${entry.id}`,
        })),
        remediation: 'Reconcile sales, purchases, inventory movement, and journal evidence during close.',
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      readinessScore,
      trustStatus: readinessScore >= 90 ? 'READY' : readinessScore >= 80 ? 'ATTENTION' : 'BLOCKED',
      openIssueCount: issues.length,
      severityCounts,
      sourceCounts,
      summaryTiles: [
        { label: 'Open issues', value: issues.length, status: issues.length > 0 ? 'ATTENTION' : 'READY' },
        { label: 'High / critical', value: high + critical, status: high + critical > 0 ? 'ATTENTION' : 'READY' },
        { label: 'Finance checks', value: financeReports.length, status: 'READY' },
        { label: 'Operations checks', value: operationsReports.length, status: 'READY' },
      ],
      warningSurface: surfaceWarnings,
      remediationLanes: [
        {
          lane: 'Close readiness',
          owner: 'Group Finance',
          actions: ['Accounting periods', 'Cash mappings', 'Statement snapshot warnings'],
        },
        {
          lane: 'Operations readiness',
          owner: 'Operations Control',
          actions: ['Inventory costing', 'Movement completeness', 'Sales/purchase reconciliation'],
        },
        {
          lane: 'Governance readiness',
          owner: 'Risk and Compliance',
          actions: ['Acknowledge open data-quality issues', 'Attach warnings to exports', 'Review lineage evidence'],
        },
      ],
      recentIssues: issues.map((issue) => ({
        id: issue.id,
        issueNumber: issue.issueNumber,
        title: issue.title,
        description: issue.description,
        severity: issue.severity,
        status: issue.status,
        source: issue.entityType,
        detectedAt: issue.detectedAt,
      })),
    };
  }

  integrationReadiness(catalog: EnterpriseCatalogEntry[] = this.catalog()) {
    const financeReports = catalog.filter((entry) => entry.sector === 'FINANCE');
    const operationsReports = catalog.filter((entry) => entry.sector === 'OPERATIONS');
    const financeCore = ['finance.trial-balance', 'finance.profit-and-loss', 'finance.balance-sheet', 'finance.cash-flow'];
    const operationsCore = ['ops.stock-valuation', 'ops.sales-summary', 'ops.purchase-summary', 'ops.inventory-movements'];
    const hasAll = (ids: string[]) => ids.every((id) => catalog.some((entry) => entry.id === id));
    const financeScore = hasAll(financeCore) ? 92 : 82;
    const operationsScore = hasAll(operationsCore) ? 91 : 80;
    return {
      generatedAt: new Date().toISOString(),
      overallScore: Math.round((financeScore + operationsScore + 91) / 3),
      finance: {
        score: financeScore,
        reportCount: financeReports.length,
        coreReports: financeCore.map((id) => {
          const entry = catalog.find((candidate) => candidate.id === id);
          return {
            id,
            name: entry?.name ?? id,
            status: entry ? 'CONNECTED' : 'MISSING',
            href: entry ? `/reports/run?reportId=${entry.id}` : '/reports',
            endpoint: entry?.apiPath,
          };
        }),
        sourceModules: [
          'Chart of Accounts',
          'Journal Entries',
          'Accounting Periods',
          'Receivables',
          'Payables',
          'Financial Statements Archive',
        ],
        closeControls: ['Period exists', 'Posted journal evidence', 'Cash account mappings', 'Snapshot and export audit'],
      },
      operations: {
        score: operationsScore,
        reportCount: operationsReports.length,
        coreReports: operationsCore.map((id) => {
          const entry = catalog.find((candidate) => candidate.id === id);
          return {
            id,
            name: entry?.name ?? id,
            status: entry ? 'CONNECTED' : 'MISSING',
            href: entry ? `/reports/run?reportId=${entry.id}` : '/reports',
            endpoint: entry?.apiPath,
          };
        }),
        sourceModules: [
          'Products',
          'Inventory Balances',
          'Inventory Movements',
          'Sales Orders',
          'Purchase Orders',
          'Suppliers and Customers',
        ],
        operatingControls: ['Company and division filters', 'Date range filters', 'Inventory valuation', 'Sales/purchase source drill-through'],
      },
      bridges: [
        {
          key: 'sales-to-ledger',
          label: 'Sales to finance',
          from: 'Sales orders and customer activity',
          to: 'Revenue, AR aging, cash position, journal evidence',
          reports: ['ops.sales-summary', 'group.sales', 'finance.receivables-aging', 'finance.profit-and-loss'],
          status: 'CONNECTED',
        },
        {
          key: 'purchase-to-ledger',
          label: 'Procurement to finance',
          from: 'Purchase orders and supplier activity',
          to: 'AP aging, expenses, inventory valuation, journal evidence',
          reports: ['ops.purchase-summary', 'finance.payables-aging', 'finance.profit-and-loss'],
          status: 'CONNECTED',
        },
        {
          key: 'stock-to-close',
          label: 'Inventory to close',
          from: 'Inventory balances and movements',
          to: 'Stock valuation, COGS, working capital, management pack',
          reports: ['ops.stock-valuation', 'ops.inventory-movements', 'finance.balance-sheet'],
          status: 'CONNECTED',
        },
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
        templateVersion: '1.2.0',
        cadence: 'Monthly',
        href: '/accounting-engine/financial-statements',
        readinessScore: 92,
        snapshotMode: 'FROZEN_STATEMENT_RUN',
        outputFormats: ['PDF', 'XLSX', 'CSV', 'JSON'],
        retentionPolicy: '7 years, close and audit evidence',
        approvalFlow: ['Controller review', 'CFO approval', 'Snapshot lock'],
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
        snapshotChecklist: [
          'Statement filters locked',
          'Section manifest generated',
          'Data-quality warnings embedded',
          'Export audit required',
        ],
      },
      {
        key: 'audit-evidence-pack',
        name: 'Audit Evidence Pack',
        owner: 'Risk and Compliance',
        status: 'TEMPLATE_READY',
        templateVersion: '1.1.0',
        cadence: 'On demand',
        href: '/compliance/evidence-packs',
        readinessScore: 91,
        snapshotMode: 'FROZEN_EVIDENCE_MANIFEST',
        outputFormats: ['PDF', 'XLSX', 'JSON'],
        retentionPolicy: 'Audit retention policy with export trail',
        approvalFlow: ['Evidence owner review', 'Auditor read-only release'],
        sections: ['Audit trail', 'Financial statement snapshots', 'Source documents', 'Approvals', 'Export log'],
        prerequisites: ['Report parameters locked', 'Evidence documents attached', 'Reviewer assigned'],
        snapshotChecklist: [
          'Evidence sources linked',
          'Export history embedded',
          'Reviewer assignment recorded',
          'Lineage references generated',
        ],
      },
      {
        key: 'board-pack',
        name: 'Board Pack',
        owner: 'Executive Office',
        status: 'DESIGN_READY',
        templateVersion: '1.0.0',
        cadence: 'Monthly / quarterly',
        href: '/bi/executive',
        readinessScore: 90,
        snapshotMode: 'FROZEN_BOARD_MANIFEST',
        outputFormats: ['PDF', 'PPTX', 'XLSX'],
        retentionPolicy: 'Board archive with approval evidence',
        approvalFlow: ['Management commentary', 'CFO review', 'Executive publication'],
        sections: ['Executive KPI summary', 'Financial highlights', 'Cash and working capital', 'Risks', 'Opportunities', 'Forecast'],
        prerequisites: ['Management pack reviewed', 'Commentary completed', 'CFO approval'],
        snapshotChecklist: [
          'Management pack dependency linked',
          'Commentary blocks prepared',
          'Executive KPIs versioned',
          'Distribution audit required',
        ],
      },
      {
        key: 'tax-pack',
        name: 'Tax and Statutory Pack',
        owner: 'Tax and Compliance',
        status: 'DESIGN_READY',
        templateVersion: '1.0.0',
        cadence: 'Monthly / statutory',
        href: '/compliance/reports',
        readinessScore: 90,
        snapshotMode: 'FROZEN_STATUTORY_MANIFEST',
        outputFormats: ['PDF', 'XLSX', 'CSV', 'JSON'],
        retentionPolicy: 'Statutory evidence retention by filing period',
        approvalFlow: ['Tax owner review', 'Compliance approval', 'Filing evidence lock'],
        sections: ['VAT / WHT schedules', 'Tax transaction summary', 'Document status', 'Obligation status', 'Filing readiness'],
        prerequisites: ['Tax mappings complete', 'Open obligations reviewed', 'Compliance evidence attached'],
        snapshotChecklist: [
          'Tax mappings verified',
          'Open obligations embedded',
          'Filing period locked',
          'Export audit required',
        ],
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

  async generateReportPack(packKey: string, dto: Record<string, unknown>, user: AuthUser) {
    const pack = this.reportPacks().find((candidate) => candidate.key === packKey);
    if (!pack) throw new NotFoundException('Report pack template not found');

    const companyId = stringValue(dto.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.WRITE);
    const period = this.resolvePackPeriod(dto);
    const catalog = this.catalog();
    const includedReports = this.reportsForPack(packKey, catalog);
    const dataQuality = await this.dataQualityWarnings(packKey, user, {
      companyId: companyId ?? undefined,
      dateFrom: period.periodStart.toISOString(),
      dateTo: period.periodEnd.toISOString(),
    });
    const generatedAt = new Date();
    const statementRunNumber = this.makeRunNumber('RPACK');
    const dataQualityWarnings = dataQuality.warnings.map((warning) => JSON.parse(JSON.stringify(warning)));
    const sectionManifest = pack.sections.map((section, index) => ({
      sequence: index + 1,
      name: section,
      status: dataQualityWarnings.some((warning) =>
        String(warning.title ?? warning.description ?? '')
          .toLowerCase()
          .includes(section.toLowerCase().split(' ')[0] ?? section.toLowerCase()),
      )
        ? 'ATTENTION'
        : 'READY',
      relatedReports: includedReports
        .filter((entry) =>
          [entry.name, entry.category, entry.sector, entry.reportType, entry.tags.join(' ')]
            .join(' ')
            .toLowerCase()
            .includes(section.toLowerCase().split(' ')[0] ?? section.toLowerCase()),
        )
        .slice(0, 6)
        .map((entry) => ({ id: entry.id, name: entry.name, apiPath: entry.apiPath })),
    }));
    const prerequisiteChecks = pack.prerequisites.map((prerequisite) => {
      const normalized = prerequisite.toLowerCase();
      const warningMatch = dataQualityWarnings.find((warning) =>
        [warning.title, warning.description, warning.source]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalized.split(' ')[0] ?? normalized),
      );
      return {
        name: prerequisite,
        status: warningMatch ? 'ATTENTION' : 'READY',
        evidence: warningMatch ? String(warningMatch.title) : 'No blocking issue detected during generation',
      };
    });

    const snapshotPayloadBase = {
      snapshotVersion: pack.templateVersion,
      snapshotNumber: statementRunNumber,
      packKey: pack.key,
      packName: pack.name,
      owner: pack.owner,
      cadence: pack.cadence,
      readinessScore: pack.readinessScore,
      templateStatus: pack.status,
      sections: pack.sections,
      sectionManifest,
      prerequisites: pack.prerequisites,
      prerequisiteChecks,
      snapshotChecklist: pack.snapshotChecklist,
      includedReports: includedReports.map((entry) => ({
        id: entry.id,
        name: entry.name,
        sector: entry.sector,
        reportType: entry.reportType,
        lifecycleStatus: entry.lifecycleStatus,
        apiPath: entry.apiPath,
      })),
      filters: {
        companyId,
        periodStart: period.periodStart.toISOString(),
        periodEnd: period.periodEnd.toISOString(),
        currency: stringValue(dto.currency) ?? 'TZS',
        basis: stringValue(dto.basis) ?? 'ACCRUAL',
      },
      dataQualityWarnings,
      generatedAt: generatedAt.toISOString(),
      snapshotMode: pack.snapshotMode,
      retentionPolicy: pack.retentionPolicy,
      approvalFlow: pack.approvalFlow,
      exportManifest: {
        formats: pack.outputFormats,
        auditRequired: true,
        watermark: `${pack.name} / ${statementRunNumber} / ${generatedAt.toISOString()}`,
        fileStem: `${pack.key}-${period.periodStart.toISOString().slice(0, 10)}-${period.periodEnd.toISOString().slice(0, 10)}`,
      },
      lineageManifest: {
        catalogPath: '/reports/catalog',
        packTemplatePath: '/reports/report-packs',
        archivePath: '/accounting-engine/financial-statements',
        sourceReportCount: includedReports.length,
      },
    };
    const snapshotPayload = {
      ...snapshotPayloadBase,
      manifestHash: this.hashJson(snapshotPayloadBase),
    };

    const run = await this.prisma.financialStatementRun.create({
      data: {
        statementRunNumber,
        companyId: companyId ?? undefined,
        statementType: FinancialStatementType.CUSTOM,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        currency: stringValue(dto.currency) ?? 'TZS',
        filters: snapshotPayload.filters,
        status: StatementRunStatus.GENERATED,
        generatedById: user.id,
        generatedAt,
        resultSummary: JSON.parse(JSON.stringify(snapshotPayload)),
      },
    });

    await this.auditLogs.log({
      action: 'REPORT_PACK_GENERATE',
      entityType: 'ReportPack',
      entityId: run.id,
      userId: user.id,
      companyId: companyId ?? undefined,
      severity: AuditSeverity.HIGH,
      metadata: {
        packKey,
        statementRunNumber: run.statementRunNumber,
        reportCount: includedReports.length,
        warningCount: dataQuality.warnings.length,
        manifestHash: snapshotPayload.manifestHash,
      },
    });

    return {
      pack,
      snapshot: {
        id: run.id,
        statementRunNumber: run.statementRunNumber,
        status: run.status,
        generatedAt: run.generatedAt,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        companyId: run.companyId,
        manifestHash: snapshotPayload.manifestHash,
        snapshotMode: pack.snapshotMode,
        sectionCount: sectionManifest.length,
        prerequisiteStatus: prerequisiteChecks.some((check) => check.status === 'ATTENTION')
          ? 'ATTENTION'
          : 'READY',
      },
      includedReports,
      dataQualityWarnings: dataQuality.warnings,
      manifest: {
        hash: snapshotPayload.manifestHash,
        sectionManifest,
        prerequisiteChecks,
        exportManifest: snapshotPayload.exportManifest,
      },
    };
  }

  async lineage(reportId: string, user: AuthUser, query: Record<string, unknown> = {}) {
    const entry = this.resolveReportEntry(reportId);
    const companyId = stringValue(query.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ);
    const companyWhere = await this.companyScope.companyWhereFor(user, companyId);

    const governanceEvents = await this.prisma.auditLog.findMany({
      where: {
        ...companyWhere,
        entityType: { in: ['ReportGovernance', 'ReportExport', 'ReportPack'] },
        OR: [
          { entityId: reportId },
          { metadata: { path: ['reportId'], equals: reportId } },
          { metadata: { path: ['packKey'], equals: reportId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        action: true,
        entityType: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    return {
      reportId,
      generatedAt: new Date().toISOString(),
      entry,
      semanticDefinition: {
        businessName: entry.name,
        owner: entry.owner,
        lifecycleStatus: entry.lifecycleStatus,
        securityClassification: entry.securityClassification,
        permission: entry.permission,
        dataFreshness: entry.dataFreshness,
      },
      semanticModel: this.semanticModelFor(entry),
      sourceSystems: this.sourceSystemsFor(entry),
      lineage: [
        { stage: 'Catalog', detail: `${entry.sector} / ${entry.category}`, reference: '/reports/catalog' },
        { stage: 'Semantic layer', detail: entry.tags.join(', '), reference: '/reports/data-catalog' },
        { stage: 'Source endpoint', detail: entry.apiPath, reference: entry.apiPath },
        { stage: 'Viewer', detail: entry.frontendPath, reference: entry.frontendPath },
        { stage: 'Audit trail', detail: 'Report runs, exports, pack generation, and lifecycle actions are logged.', reference: '/audit-logs' },
      ],
      drillGraph: this.drillGraphFor(entry),
      drillThrough: this.drillThroughFor(entry),
      securityTrace: {
        requiredPermission: entry.permission,
        scope: entry.scopes,
        accessLevel: 'READ',
        rowLevelFilter: companyId ? `companyId=${companyId}` : 'user company scope / group scope',
        exportControl:
          entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED'
            ? 'High-severity export audit required'
            : 'Standard export audit required',
      },
      operationalBridge: this.operationalBridgeFor(entry),
      recentGovernanceEvents: governanceEvents,
    };
  }

  async dataQualityWarnings(
    reportId: string,
    user: AuthUser,
    query: Record<string, unknown> = {},
  ) {
    const entry = this.catalog().find((candidate) => candidate.id === reportId);
    const pack = this.reportPacks().find((candidate) => candidate.key === reportId);
    if (!entry && !pack) throw new NotFoundException('Report or report pack not found');

    const companyId = stringValue(query.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ);
    const companyWhere = await this.companyScope.companyWhereFor(user, companyId);
    const period = this.resolveOptionalPeriod(query);

    const issues = await this.prisma.dataQualityIssue.findMany({
      where: {
        ...companyWhere,
        status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
      },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: 12,
      select: {
        id: true,
        issueNumber: true,
        title: true,
        description: true,
        severity: true,
        status: true,
        entityType: true,
        detectedAt: true,
      },
    });

    const computedWarnings: Array<Record<string, unknown>> = [];
    if (entry?.reportType === 'FINANCIAL_STATEMENT' || pack?.key.includes('management') || pack?.key.includes('board')) {
      if (!companyId) {
        computedWarnings.push({
          severity: 'MEDIUM',
          title: 'Group-level financial pack',
          description: 'No company was selected, so the output is treated as group-level and requires a group-scoped user.',
          source: 'scope',
        });
      } else if (period) {
        const periodCount = await this.prisma.accountingPeriod.count({
          where: {
            companyId,
            startDate: { lte: period.periodEnd },
            endDate: { gte: period.periodStart },
          },
        });
        if (periodCount === 0) {
          computedWarnings.push({
            severity: 'HIGH',
            title: 'No accounting period exists for this transaction date range',
            description: 'Create or open the relevant accounting period before using this output as an official report.',
            source: 'accounting_periods',
          });
        }
      }
    }

    if (companyId && (entry?.id.includes('cash') || pack?.key.includes('management') || pack?.key.includes('board'))) {
      const cashAccounts = await this.prisma.chartOfAccount.count({
        where: {
          companyId,
          OR: [
            { accountSubType: { equals: 'cash_on_hand', mode: 'insensitive' } },
            { accountSubType: { equals: 'bank', mode: 'insensitive' } },
            { accountCode: { in: ['1000', '1010', '1020'] } },
          ],
        },
      });
      if (cashAccounts === 0) {
        computedWarnings.push({
          severity: 'HIGH',
          title: 'Cash account mapping is incomplete',
          description: 'Set accountSubType="cash_on_hand" or "bank" on cash/bank accounts, or create a conventional account code such as 1000, 1010, or 1020.',
          source: 'chart_of_accounts',
        });
      }
    }

    const warnings = [
      ...computedWarnings,
      ...issues.map((issue) => ({
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        status: issue.status,
        source: issue.entityType,
        issueNumber: issue.issueNumber,
        detectedAt: issue.detectedAt,
      })),
    ];
    const severityCounts = this.countTextValues(warnings.map((warning) => String(warning.severity ?? 'UNKNOWN')));
    const readinessScore = Math.max(
      70,
      100 -
        (severityCounts.CRITICAL ?? 0) * 10 -
        (severityCounts.HIGH ?? 0) * 6 -
        (severityCounts.MEDIUM ?? 0) * 3 -
        Math.min(warnings.length, 10),
    );

    return {
      reportId,
      generatedAt: new Date().toISOString(),
      warnings,
      surface: {
        readinessScore,
        trustStatus: readinessScore >= 90 ? 'READY' : readinessScore >= 80 ? 'ATTENTION' : 'BLOCKED',
        severityCounts,
        affectedDimensions: this.qualityDimensionsFor(entry, pack),
        displayMode: 'INLINE_VIEWER_AND_COMMAND_CENTER',
        remediationActions: this.qualityRemediationFor(entry, pack),
        officialUse:
          readinessScore >= 90
            ? 'Suitable for operational use; formal packs still preserve warning metadata.'
            : 'Use as provisional output until warnings are resolved or acknowledged.',
      },
    };
  }

  async explain(reportId: string, user: AuthUser, query: Record<string, unknown> = {}) {
    const entry = this.resolveReportEntry(reportId);
    const companyId = stringValue(query.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ);
    const companyWhere = await this.companyScope.companyWhereFor(user, companyId);
    const period = this.resolveOptionalPeriod(query);
    const dateWhere = period
      ? { transactionDate: { gte: period.periodStart, lte: period.periodEnd } }
      : {};

    const [postedJournals, draftJournals, reportRuns, openQuality] = await Promise.all([
      this.prisma.journalEntry.count({
        where: { ...companyWhere, ...dateWhere, status: 'POSTED', deletedAt: null },
      }),
      this.prisma.journalEntry.count({
        where: { ...companyWhere, ...dateWhere, status: 'DRAFT', deletedAt: null },
      }),
      this.prisma.reportRun.count({
        where: { ...companyWhere, status: { in: [ReportRunStatus.COMPLETED, ReportRunStatus.FAILED] } },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...companyWhere,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
        },
      }),
    ]);

    const drivers = [
      {
        label: 'Source evidence volume',
        value: `${postedJournals} posted journal(s) in scope`,
        interpretation:
          postedJournals > 0
            ? 'Financial figures can drill through to posted ledger evidence.'
            : 'No posted journals were found for the selected scope and period.',
      },
      {
        label: 'Unposted activity',
        value: `${draftJournals} draft journal(s) in scope`,
        interpretation:
          draftJournals > 0
            ? 'Draft journals may explain differences between operational activity and official financial reports.'
            : 'No draft journals were found for the selected scope and period.',
      },
      {
        label: 'Data quality',
        value: `${openQuality} open or acknowledged issue(s)`,
        interpretation:
          openQuality > 0
            ? 'Treat affected numbers as provisional until data-quality findings are resolved or acknowledged.'
            : 'No open data-quality issue was found in the selected scope.',
      },
      {
        label: 'Usage and execution history',
        value: `${reportRuns} completed or failed BI run(s) in scope`,
        interpretation: 'Execution history is available for run, failure, export, and schedule investigation.',
      },
    ];

    return {
      reportId,
      generatedAt: new Date().toISOString(),
      summary: `${entry.name} is a ${entry.reportType.toLowerCase().replace(/_/g, ' ')} report owned by ${entry.owner}. It uses ${entry.dataFreshness.toLowerCase()} and is governed as ${entry.lifecycleStatus.toLowerCase()}.`,
      basis:
        entry.reportType === 'FINANCIAL_STATEMENT'
          ? 'Accrual financial basis unless the source endpoint supports a cash-basis filter.'
          : 'Operational basis from source transactions.',
      drivers,
      recommendedDrillDowns: this.drillThroughFor(entry),
      questions: entry.businessQuestions,
      caveats: [
        'This explanation is deterministic metadata and source-count analysis, not a substitute for accounting approval.',
        'Official report packs should use generated snapshots and remain tied to the audit trail.',
      ],
    };
  }

  async recordViewerRun(reportId: string, dto: Record<string, unknown>, user: AuthUser) {
    const entry = this.resolveReportEntry(reportId);
    const companyId = stringValue(dto.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ);
    const generatedAt = new Date();
    const metrics =
      dto.metrics && typeof dto.metrics === 'object' && !Array.isArray(dto.metrics)
        ? (dto.metrics as Record<string, unknown>)
        : {};
    const parameters =
      dto.parameters && typeof dto.parameters === 'object' && !Array.isArray(dto.parameters)
        ? (dto.parameters as Record<string, unknown>)
        : {};
    const runId = this.makeRunNumber('RRUN');
    const manifestBase = {
      runId,
      reportId: entry.id,
      reportName: entry.name,
      companyId,
      generatedAt: generatedAt.toISOString(),
      lifecycleStatus: entry.lifecycleStatus,
      securityClassification: entry.securityClassification,
      sourcePath: entry.apiPath,
      sourceUrl: stringValue(dto.sourceUrl),
      viewerPath: entry.frontendPath,
      parameters,
      metrics: {
        rowCount: numberValue(metrics.rowCount) ?? 0,
        columnCount: numberValue(metrics.columnCount) ?? 0,
        scalarCount: numberValue(metrics.scalarCount) ?? 0,
        objectSectionCount: numberValue(metrics.objectSectionCount) ?? 0,
        primarySection: stringValue(metrics.primarySection) ?? 'Rows',
        clientDataHash: stringValue(metrics.dataHash),
      },
      controls: {
        dataQualityAttached: Boolean(dto.dataQualityAttached),
        lineageAttached: Boolean(dto.lineageAttached),
        exportAuditRequired: true,
        snapshotEligible:
          entry.reportType === 'FINANCIAL_STATEMENT' ||
          entry.reportType === 'COMPLIANCE' ||
          entry.reportType === 'AUDIT',
      },
    };
    const manifest = {
      ...manifestBase,
      manifestHash: this.hashJson(manifestBase),
      status: 'COMPLETED',
    };

    await this.auditLogs.log({
      action: 'REPORT_VIEWER_RUN',
      entityType: 'ReportViewerRun',
      entityId: reportId,
      userId: user.id,
      companyId: companyId ?? undefined,
      severity:
        entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED'
          ? AuditSeverity.HIGH
          : AuditSeverity.MEDIUM,
      metadata: {
        runId,
        reportId: entry.id,
        reportName: entry.name,
        sourcePath: entry.apiPath,
        manifestHash: manifest.manifestHash,
        metrics: manifest.metrics,
      },
    });

    return manifest;
  }

  async exportAuditHistory(reportId: string, user: AuthUser, query: Record<string, unknown> = {}) {
    const entry = this.resolveReportEntry(reportId);
    const companyId = stringValue(query.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ);
    const companyWhere = await this.companyScope.companyWhereFor(user, companyId);
    const limit = Math.min(Math.max(numberValue(query.limit) ?? 10, 1), 50);
    const where = {
      ...companyWhere,
      filters: { path: ['reportId'], equals: reportId },
    };

    const [rows, total] = await Promise.all([
      this.prisma.dataExportLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          exportNumber: true,
          exportType: true,
          filters: true,
          fileName: true,
          status: true,
          createdAt: true,
          completedAt: true,
          notes: true,
          exportedBy: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.dataExportLog.count({ where }),
    ]);

    return {
      reportId,
      reportName: entry.name,
      generatedAt: new Date().toISOString(),
      total,
      exports: rows.map((row) => {
        const filters =
          row.filters && typeof row.filters === 'object' && !Array.isArray(row.filters)
            ? (row.filters as Record<string, unknown>)
            : {};
        return {
          id: row.id,
          exportNumber: row.exportNumber,
          exportType: row.exportType,
          format: stringValue(filters.format) ?? 'UNKNOWN',
          status: row.status,
          fileName: row.fileName,
          createdAt: row.createdAt,
          completedAt: row.completedAt,
          exportedBy: row.exportedBy,
          auditHash: stringValue(filters.auditHash),
          runId: stringValue(filters.runId),
          metrics: filters.metrics ?? {},
          parameters: filters.parameters ?? {},
          notes: row.notes,
        };
      }),
    };
  }

  async recordExportAudit(dto: Record<string, unknown>, user: AuthUser) {
    const reportId = stringValue(dto.reportId);
    if (!reportId) throw new BadRequestException('reportId is required');
    const entry = this.resolveReportEntry(reportId);
    const companyId = stringValue(dto.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ);
    const format = (stringValue(dto.format) ?? 'CSV').toUpperCase();
    const exportedAt = new Date();
    const parameters =
      dto.parameters && typeof dto.parameters === 'object' && !Array.isArray(dto.parameters)
        ? (dto.parameters as Record<string, unknown>)
        : {};
    const metrics = {
      rowCount: numberValue(dto.rowCount) ?? 0,
      columnCount: numberValue(dto.columnCount) ?? 0,
      sectionCount: numberValue(dto.sectionCount) ?? 0,
      scalarCount: numberValue(dto.scalarCount) ?? 0,
      objectSectionCount: numberValue(dto.objectSectionCount) ?? 0,
    };
    const auditBase = {
      reportId,
      reportName: entry.name,
      companyId,
      format,
      parameters,
      metrics,
      runId: stringValue(dto.runId),
      sourcePath: entry.apiPath,
      sourceUrl: stringValue(dto.sourceUrl),
      dataHash: stringValue(dto.dataHash),
      exportedAt: exportedAt.toISOString(),
    };
    const auditHash = this.hashJson(auditBase);
    const exportFilters = JSON.parse(
      JSON.stringify({
        reportId,
        reportName: entry.name,
        format,
        parameters,
        metrics,
        runId: auditBase.runId,
        sourcePath: entry.apiPath,
        sourceUrl: auditBase.sourceUrl,
        dataHash: auditBase.dataHash,
        auditHash,
        exportedAt: exportedAt.toISOString(),
      }),
    ) as Prisma.InputJsonValue;

    const exportRecord = await this.prisma.dataExportLog.create({
      data: {
        exportNumber: this.makeRunNumber('REXP'),
        companyId: companyId ?? undefined,
        exportedById: user.id,
        exportType: this.exportTypeFor(entry),
        filters: exportFilters,
        fileName: `${reportId}-${exportedAt.toISOString().slice(0, 10)}.${format.toLowerCase()}`,
        status: DataExportStatus.COMPLETED,
        completedAt: exportedAt,
        notes: 'Client-side report export/print action recorded by the Reports module.',
      },
    });

    await this.auditLogs.log({
      action: 'REPORT_EXPORT',
      entityType: 'ReportExport',
      entityId: reportId,
      userId: user.id,
      companyId: companyId ?? undefined,
      severity:
        entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED'
          ? AuditSeverity.HIGH
          : AuditSeverity.MEDIUM,
      metadata: {
        reportId,
        reportName: entry.name,
        format,
        dataExportLogId: exportRecord.id,
        runId: auditBase.runId,
        auditHash,
        dataHash: auditBase.dataHash,
        metrics,
      },
    });

    return {
      exportRecord,
      audit: {
        auditHash,
        runId: auditBase.runId,
        dataHash: auditBase.dataHash,
        metrics,
        exportedAt,
      },
    };
  }

  async updateLifecycle(reportId: string, dto: Record<string, unknown>, user: AuthUser) {
    const entry = this.resolveReportEntry(reportId);
    const nextStatus = stringValue(dto.lifecycleStatus) as ReportLifecycleStatus | undefined;
    const allowed: ReportLifecycleStatus[] = ['DRAFT', 'VALIDATED', 'CERTIFIED', 'OFFICIAL', 'ARCHIVED'];
    if (!nextStatus || !allowed.includes(nextStatus)) {
      throw new BadRequestException('Valid lifecycleStatus is required');
    }

    const companyId = stringValue(dto.companyId);
    await this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.MANAGE);
    await this.auditLogs.log({
      action: 'REPORT_LIFECYCLE_UPDATE',
      entityType: 'ReportGovernance',
      entityId: reportId,
      userId: user.id,
      companyId: companyId ?? undefined,
      severity: AuditSeverity.HIGH,
      oldValue: { lifecycleStatus: entry.lifecycleStatus },
      newValue: {
        lifecycleStatus: nextStatus,
        reason: stringValue(dto.reason) ?? 'Lifecycle updated from Reports governance screen',
      },
      metadata: {
        reportId,
        reportName: entry.name,
        owner: entry.owner,
      },
    });

    return {
      reportId,
      reportName: entry.name,
      previousStatus: entry.lifecycleStatus,
      lifecycleStatus: nextStatus,
      persistedAs: 'AuditLog',
      updatedAt: new Date().toISOString(),
    };
  }

  private catalog(): EnterpriseCatalogEntry[] {
    return REPORTS_CATALOG.map(enrichCatalogEntry);
  }

  private resolveReportEntry(reportId: string) {
    const entry = this.catalog().find((candidate) => candidate.id === reportId);
    if (!entry) throw new NotFoundException('Report not found in catalog');
    return entry;
  }

  private expandSearchTerms(search: string) {
    const rawTerms = search
      .split(/[^a-z0-9]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 1);
    const phraseSynonyms: Record<string, string[]> = {
      'who owes us money': ['receivables', 'aging', 'customer', 'balance', 'collections', 'overdue'],
      'money we owe': ['payables', 'aging', 'supplier', 'vendor', 'open bills', 'overdue'],
      'cash position': ['cash', 'bank', 'treasury', 'liquidity', 'working capital'],
      'stock value': ['inventory', 'stock', 'valuation', 'warehouse', 'products'],
      'slow moving stock': ['inventory', 'aging', 'slow', 'obsolete', 'movement'],
      'sales performance': ['sales', 'revenue', 'customer', 'product', 'margin'],
      'audit evidence': ['audit', 'trail', 'evidence', 'controls', 'documents'],
      'tax readiness': ['tax', 'compliance', 'obligations', 'filing', 'statutory'],
      'budget overspend': ['budget', 'variance', 'actual', 'expense', 'department'],
    };
    const tokenSynonyms: Record<string, string[]> = {
      owe: ['payables', 'receivables', 'aging', 'balance'],
      owed: ['receivables', 'aging', 'customer'],
      supplier: ['vendor', 'payables', 'purchase'],
      vendor: ['supplier', 'payables', 'purchase'],
      customer: ['sales', 'receivables', 'collections'],
      money: ['cash', 'receivables', 'payables'],
      income: ['profit', 'loss', 'revenue', 'sales'],
      expense: ['profit', 'loss', 'spend', 'cost'],
      stock: ['inventory', 'valuation', 'movement', 'product'],
      inventory: ['stock', 'warehouse', 'movement', 'valuation'],
      proof: ['audit', 'evidence', 'documents', 'trail'],
      approval: ['workflow', 'audit', 'controls'],
      kpi: ['dashboard', 'indicator', 'snapshot', 'metric'],
      dashboard: ['cockpit', 'kpi', 'summary'],
    };

    const expanded = new Set(rawTerms);
    for (const [phrase, terms] of Object.entries(phraseSynonyms)) {
      if (search.includes(phrase)) {
        terms.forEach((term) => expanded.add(term));
      }
    }
    for (const term of rawTerms) {
      (tokenSynonyms[term] ?? []).forEach((synonym) => expanded.add(synonym));
    }
    return Array.from(expanded);
  }

  private discoveryScore(entry: EnterpriseCatalogEntry, terms: string[]) {
    const weightedFields: Array<[string, number]> = [
      [entry.name, 10],
      [entry.id, 8],
      [entry.description, 7],
      [entry.category, 5],
      [entry.owner, 4],
      [entry.sector, 4],
      [entry.reportType, 4],
      [entry.lifecycleStatus, 3],
      [entry.securityClassification, 2],
      [entry.tags.join(' '), 6],
      [entry.businessQuestions.join(' '), 7],
      [entry.drillPaths.join(' '), 5],
      [entry.relatedCapabilities.join(' '), 4],
      [entry.outputFormats.join(' '), 2],
    ];
    return terms.reduce((score, term) => {
      const normalized = term.toLowerCase();
      const fieldScore = weightedFields.reduce((sum, [field, weight]) => {
        return field.toLowerCase().includes(normalized) ? sum + weight : sum;
      }, 0);
      return score + fieldScore;
    }, 0);
  }

  private discoveryFacets(catalog: EnterpriseCatalogEntry[]) {
    return {
      sectors: this.facet(catalog, (entry) => entry.sector),
      scopes: this.facet(catalog.flatMap((entry) => entry.scopes.map((scope) => ({ scope }))), (entry) => entry.scope),
      reportTypes: this.facet(catalog, (entry) => entry.reportType),
      lifecycleStatuses: this.facet(catalog, (entry) => entry.lifecycleStatus),
      securityClassifications: this.facet(catalog, (entry) => entry.securityClassification),
      categories: this.facet(catalog, (entry) => entry.category),
      owners: this.facet(catalog, (entry) => entry.owner),
      tags: this.facet(
        catalog.flatMap((entry) => entry.tags.map((tag) => ({ tag }))),
        (entry) => entry.tag,
      ).slice(0, 30),
    };
  }

  private facet<T>(items: T[], pick: (item: T) => string) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = pick(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  private suggestedSearches() {
    return [
      'Who owes us money?',
      'Money we owe suppliers',
      'Cash position',
      'Stock value by branch',
      'Sales performance',
      'Audit evidence',
      'Tax readiness',
      'Budget overspend',
      'Slow moving stock',
      'Failed scheduled reports',
    ];
  }

  private businessQuestionIndex(catalog: EnterpriseCatalogEntry[]) {
    const rows = catalog.flatMap((entry) =>
      entry.businessQuestions.map((question) => ({
        question,
        reportId: entry.id,
        reportName: entry.name,
        sector: entry.sector,
        reportType: entry.reportType,
        href: `/reports/run?reportId=${encodeURIComponent(entry.id)}`,
      })),
    );
    const seen = new Set<string>();
    return rows.filter((row) => {
      const key = `${row.question}:${row.sector}:${row.reportType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private featuredCollections(catalog: EnterpriseCatalogEntry[]) {
    const collection = (
      key: string,
      title: string,
      description: string,
      predicate: (entry: EnterpriseCatalogEntry) => boolean,
    ) => {
      const reports = catalog.filter(predicate).slice(0, 8);
      return { key, title, description, reportCount: reports.length, reports };
    };

    return [
      collection('cfo-close', 'CFO close and statements', 'Financial statements, cash, AR/AP, consolidation, and close evidence.', (entry) =>
        entry.sector === 'FINANCE' || entry.relatedCapabilities.includes('Financial Statements Archive'),
      ),
      collection('operations-live', 'Operations control', 'Inventory, sales, purchases, movements, and branch execution.', (entry) =>
        entry.sector === 'OPERATIONS' || entry.sector === 'WESTSIDES' || entry.sector === 'PETROLEUM',
      ),
      collection('audit-compliance', 'Audit and compliance evidence', 'Formal reports, control evidence, tax readiness, and audit trail.', (entry) =>
        entry.reportType === 'AUDIT' || entry.reportType === 'COMPLIANCE',
      ),
      collection('self-service-bi', 'Self-service BI', 'Builder, saved views, report runs, scheduled delivery, and governed datasets.', (entry) =>
        entry.reportType === 'SELF_SERVICE' || entry.sector === 'BI',
      ),
    ];
  }

  private personaCollections(catalog: EnterpriseCatalogEntry[]) {
    const personas = [
      {
        key: 'executive',
        label: 'Executive',
        objective: 'Monitor cash, growth, profitability, risk, and group exceptions.',
        terms: ['summary', 'dashboard', 'cash', 'profit', 'group', 'activity', 'cockpit'],
      },
      {
        key: 'cfo',
        label: 'CFO / Controller',
        objective: 'Run statements, validate close evidence, and review AR/AP and consolidation.',
        terms: ['trial', 'profit', 'balance', 'cash', 'aging', 'intercompany', 'financial', 'audit'],
      },
      {
        key: 'operations',
        label: 'Operations',
        objective: 'Track stock, movements, sales, purchases, branches, and exceptions.',
        terms: ['stock', 'inventory', 'movement', 'sales', 'purchase', 'operations', 'valuation'],
      },
      {
        key: 'procurement',
        label: 'Procurement',
        objective: 'Review supplier spend, purchase commitments, payables, and price movement.',
        terms: ['purchase', 'vendor', 'supplier', 'payables', 'procurement', 'spend', 'price'],
      },
      {
        key: 'auditor',
        label: 'Auditor',
        objective: 'Trace reports to evidence, controls, exports, approvals, and user actions.',
        terms: ['audit', 'compliance', 'tax', 'document', 'obligation', 'evidence', 'trail'],
      },
      {
        key: 'analyst',
        label: 'Analyst',
        objective: 'Build governed views, inspect report runs, and explore analytical datasets.',
        terms: ['bi', 'definition', 'builder', 'run', 'analytics', 'summary', 'performance'],
      },
    ];

    return personas.map((persona) => {
      const reports = catalog
        .map((entry) => ({ entry, score: this.discoveryScore(entry, persona.terms) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
        .slice(0, 6)
        .map((row) => row.entry);
      return { ...persona, reports };
    });
  }

  private actionLanes(catalog: EnterpriseCatalogEntry[]) {
    const count = (predicate: (entry: EnterpriseCatalogEntry) => boolean) => catalog.filter(predicate).length;
    return [
      {
        key: 'run-certified',
        title: 'Run certified reports',
        description: 'Launch official and certified reports with context, export, and lineage controls.',
        href: '/reports',
        badge: 'Run',
        reportCount: count((entry) => entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL'),
      },
      {
        key: 'answer-question',
        title: 'Answer a business question',
        description: 'Use synonym-aware discovery to find reports by business language rather than menu location.',
        href: '/reports',
        badge: 'Discover',
        reportCount: this.businessQuestionIndex(catalog).length,
      },
      {
        key: 'generate-pack',
        title: 'Generate report packs',
        description: 'Create management, board, tax, or audit evidence snapshots from governed templates.',
        href: '/reports',
        badge: 'Pack',
        reportCount: this.reportPacks().length,
      },
      {
        key: 'build-view',
        title: 'Build or save a view',
        description: 'Use BI definitions, saved views, and report runs for self-service analysis.',
        href: '/bi/report-builder',
        badge: 'Builder',
        reportCount: count((entry) => entry.reportType === 'SELF_SERVICE' || entry.sector === 'BI'),
      },
      {
        key: 'govern-catalog',
        title: 'Govern the catalog',
        description: 'Review ownership, lifecycle, export sensitivity, readiness gaps, and certified coverage.',
        href: '/reports',
        badge: 'Govern',
        reportCount: this.readinessGaps(catalog).length,
      },
    ];
  }

  private coverageMatrix(catalog: EnterpriseCatalogEntry[]) {
    const sectors = Array.from(new Set(catalog.map((entry) => entry.sector))).sort();
    const reportTypes = Array.from(new Set(catalog.map((entry) => entry.reportType))).sort();
    return sectors.map((sector) => ({
      sector,
      total: catalog.filter((entry) => entry.sector === sector).length,
      reportTypes: reportTypes.map((reportType) => ({
        reportType,
        count: catalog.filter((entry) => entry.sector === sector && entry.reportType === reportType).length,
      })),
      certifiedOrOfficial: catalog.filter(
        (entry) =>
          entry.sector === sector &&
          (entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL'),
      ).length,
      sensitiveOrRestricted: catalog.filter(
        (entry) =>
          entry.sector === sector &&
          (entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED'),
      ).length,
    }));
  }

  private readinessGaps(catalog: EnterpriseCatalogEntry[]) {
    return catalog
      .map((entry) => {
        const gaps = [
          !entry.owner && 'owner',
          entry.businessQuestions.length === 0 && 'business questions',
          entry.drillPaths.length === 0 && 'drill path',
          entry.outputFormats.length === 0 && 'output formats',
          !entry.permission && 'permission',
          !entry.apiPath && 'API path',
          !entry.frontendPath && 'frontend path',
          entry.lifecycleStatus === 'DRAFT' && 'certification',
        ].filter(Boolean) as string[];
        return { reportId: entry.id, reportName: entry.name, sector: entry.sector, gaps };
      })
      .filter((entry) => entry.gaps.length > 0)
      .slice(0, 20);
  }

  private discoveryHealth(catalog: EnterpriseCatalogEntry[]) {
    const percent = (count: number) => Math.round((count / Math.max(catalog.length, 1)) * 100);
    const withOwner = percent(catalog.filter((entry) => Boolean(entry.owner)).length);
    const withQuestions = percent(catalog.filter((entry) => entry.businessQuestions.length > 0).length);
    const withDrillPaths = percent(catalog.filter((entry) => entry.drillPaths.length > 0).length);
    const withOutputs = percent(catalog.filter((entry) => entry.outputFormats.length > 0).length);
    const withPermission = percent(catalog.filter((entry) => Boolean(entry.permission)).length);
    const withApiPath = percent(catalog.filter((entry) => Boolean(entry.apiPath)).length);
    const withFrontendPath = percent(catalog.filter((entry) => Boolean(entry.frontendPath)).length);
    const withTags = percent(catalog.filter((entry) => entry.tags.length >= 4).length);
    const certifiedOrOfficial = percent(
      catalog.filter((entry) => entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL').length,
    );
    const overallScore = Math.round(
      (withOwner +
        withQuestions +
        withDrillPaths +
        withOutputs +
        withPermission +
        withApiPath +
        withFrontendPath +
        withTags +
        certifiedOrOfficial) /
        9,
    );
    return {
      overallScore,
      withOwner,
      withQuestions,
      withDrillPaths,
      withOutputs,
      withPermission,
      withApiPath,
      withFrontendPath,
      withTags,
      certifiedOrOfficial,
      status: overallScore >= 85 ? 'READY' : overallScore >= 70 ? 'IMPROVING' : 'NEEDS_WORK',
    };
  }

  private commandCenterScore(
    catalog: EnterpriseCatalogEntry[],
    signals: {
      activeDefinitions: number;
      activeSchedules: number;
      failedRuns: number;
      requestedRuns: number;
      dashboards: number;
      openDataQuality: number;
      openInsights: number;
      statementRuns: number;
    },
  ) {
    const discovery = this.discoveryHealth(catalog).overallScore;
    const navigation = 100;
    const personalization = 92;
    const actionCoverage = this.actionLanes(catalog).length >= 5 ? 96 : 80;
    const governanceVisibility = Math.max(90, 100 - this.readinessGaps(catalog).length * 2);
    const operationalSignals = Math.max(
      70,
      100 -
        Math.min(signals.failedRuns * 8, 20) -
        Math.min(signals.openDataQuality * 2, 20) +
        Math.min(signals.activeSchedules + signals.dashboards + signals.statementRuns, 12),
    );
    const overallScore = Math.min(
      100,
      Math.round((discovery + navigation + personalization + actionCoverage + governanceVisibility + operationalSignals) / 6),
    );
    return {
      overallScore,
      discovery,
      navigation,
      personalization,
      actionCoverage,
      governanceVisibility,
      operationalSignals,
      status: overallScore >= 90 ? 'READY' : overallScore >= 80 ? 'IMPROVING' : 'NEEDS_WORK',
    };
  }

  private reportsForPack(packKey: string, catalog: EnterpriseCatalogEntry[]) {
    if (packKey === 'monthly-management-pack') {
      return catalog.filter(
        (entry) =>
          entry.sector === 'FINANCE' ||
          ['ops.stock-valuation', 'ops.sales-summary', 'ops.purchase-summary'].includes(entry.id),
      );
    }
    if (packKey === 'audit-evidence-pack') {
      return catalog.filter((entry) => entry.reportType === 'AUDIT' || entry.sector === 'COMPLIANCE');
    }
    if (packKey === 'board-pack') {
      return catalog.filter(
        (entry) =>
          entry.scopes.includes('GROUP') &&
          (entry.reportType === 'DASHBOARD' ||
            entry.reportType === 'FINANCIAL_STATEMENT' ||
            entry.reportType === 'ANALYTICAL'),
      );
    }
    if (packKey === 'tax-pack') {
      return catalog.filter((entry) => entry.sector === 'COMPLIANCE' || entry.name.toLowerCase().includes('tax'));
    }
    return catalog.slice(0, 20);
  }

  private resolvePackPeriod(dto: Record<string, unknown>) {
    const explicitStart = stringValue(dto.periodStart) ?? stringValue(dto.dateFrom);
    const explicitEnd = stringValue(dto.periodEnd) ?? stringValue(dto.dateTo);
    const now = new Date();
    const periodStart = explicitStart ? new Date(explicitStart) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = explicitEnd
      ? new Date(explicitEnd)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid periodStart or periodEnd');
    }
    if (periodStart > periodEnd) {
      throw new BadRequestException('periodStart must be before periodEnd');
    }
    return { periodStart, periodEnd };
  }

  private resolveOptionalPeriod(query: Record<string, unknown>) {
    const from = stringValue(query.periodStart) ?? stringValue(query.dateFrom);
    const to = stringValue(query.periodEnd) ?? stringValue(query.dateTo) ?? stringValue(query.asOf);
    if (!from && !to) return null;
    const periodStart = from ? new Date(from) : new Date(to as string);
    const periodEnd = to ? new Date(to) : new Date(from as string);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (periodStart > periodEnd) {
      throw new BadRequestException('dateFrom must be before dateTo');
    }
    return { periodStart, periodEnd };
  }

  private drillThroughFor(entry: EnterpriseCatalogEntry) {
    if (entry.reportType === 'FINANCIAL_STATEMENT') {
      return [
        { label: 'Statement line', href: '/finance/reports', target: 'financial-statement-line', evidenceType: 'financial_statement_line' },
        { label: 'Account detail', href: '/accounting-engine/chart-of-accounts', target: 'chart-of-account', evidenceType: 'chart_of_account' },
        { label: 'Journal entries', href: '/accounting-engine/journal-entries', target: 'journal-entry', evidenceType: 'journal_entry' },
        { label: 'Source documents', href: '/documents', target: 'document', evidenceType: 'source_document' },
      ];
    }
    if (entry.sector === 'OPERATIONS') {
      return [
        { label: 'Operational summary', href: '/operations/reports', target: 'summary', evidenceType: 'operational_report' },
        { label: 'Inventory movements', href: '/operations/inventory-movements', target: 'inventory-movement', evidenceType: 'inventory_movement' },
        { label: 'Products', href: '/operations/products', target: 'product', evidenceType: 'product_master' },
        { label: 'Source orders', href: '/operations/sales-orders', target: 'sales-order', evidenceType: 'sales_or_purchase_order' },
      ];
    }
    if (entry.sector === 'COMPLIANCE' || entry.reportType === 'AUDIT') {
      return [
        { label: 'Control finding', href: '/compliance/reports', target: 'control', evidenceType: 'control_finding' },
        { label: 'Audit trail', href: '/audit-logs', target: 'audit-log', evidenceType: 'audit_log' },
        { label: 'Evidence packs', href: '/compliance/evidence-packs', target: 'evidence-pack', evidenceType: 'evidence_pack' },
      ];
    }
    return entry.drillPaths.map((step) => ({
      label: step,
      href: entry.frontendPath,
      target: step.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      evidenceType: 'catalog_drill_path',
    }));
  }

  private semanticModelFor(entry: EnterpriseCatalogEntry) {
    if (entry.reportType === 'FINANCIAL_STATEMENT') {
      return {
        dataset: 'general_ledger',
        measures: ['Opening balance', 'Debit movement', 'Credit movement', 'Closing balance', 'Period activity'],
        dimensions: ['Company', 'Account', 'Fiscal period', 'Currency', 'Branch', 'Division'],
        basis: 'Accrual with endpoint-specific cash basis where supported',
        grain: 'Journal line / account period',
      };
    }
    if (entry.sector === 'OPERATIONS') {
      return {
        dataset: 'operations_transactions',
        measures: ['Quantity', 'Value', 'Average cost', 'Sales amount', 'Purchase amount', 'Variance'],
        dimensions: ['Company', 'Division', 'Branch', 'Product', 'Customer', 'Supplier', 'Date'],
        basis: 'Operational source transaction basis',
        grain: 'Order line, product balance, or inventory movement',
      };
    }
    if (entry.reportType === 'AUDIT' || entry.reportType === 'COMPLIANCE') {
      return {
        dataset: 'controls_and_audit',
        measures: ['Event count', 'Open obligations', 'Document status', 'Finding severity'],
        dimensions: ['Company', 'Entity', 'Action', 'User', 'Control', 'Period'],
        basis: 'Audit event and compliance obligation basis',
        grain: 'Audit event / compliance record',
      };
    }
    return {
      dataset: entry.sector.toLowerCase(),
      measures: entry.tags.slice(0, 5),
      dimensions: entry.scopes,
      basis: 'Catalog-defined source basis',
      grain: 'Endpoint-defined',
    };
  }

  private sourceSystemsFor(entry: EnterpriseCatalogEntry) {
    if (entry.reportType === 'FINANCIAL_STATEMENT') {
      return [
        { name: 'General Ledger', module: 'Accounting Engine', sourcePath: '/accounting-engine/journal-entries' },
        { name: 'Chart of Accounts', module: 'Finance', sourcePath: '/finance/chart-of-accounts' },
        { name: 'Accounting Periods', module: 'Finance', sourcePath: '/finance/accounting-periods' },
      ];
    }
    if (entry.sector === 'OPERATIONS') {
      return [
        { name: 'Products', module: 'Operations', sourcePath: '/operations/products' },
        { name: 'Inventory Movements', module: 'Operations', sourcePath: '/operations/inventory-movements' },
        { name: 'Sales Orders', module: 'Operations', sourcePath: '/operations/sales-orders' },
        { name: 'Purchase Orders', module: 'Operations', sourcePath: '/operations/purchase-orders' },
      ];
    }
    return [
      { name: entry.category, module: entry.sector, sourcePath: entry.frontendPath },
      { name: 'Audit Trail', module: 'Governance', sourcePath: '/audit-logs' },
    ];
  }

  private drillGraphFor(entry: EnterpriseCatalogEntry) {
    const sourceSystems = this.sourceSystemsFor(entry);
    return [
      { id: 'report', label: entry.name, type: 'report', href: `/reports/run?reportId=${entry.id}` },
      { id: 'semantic', label: this.semanticModelFor(entry).dataset, type: 'semantic_model', href: '/reports' },
      ...sourceSystems.map((source, index) => ({
        id: `source-${index + 1}`,
        label: source.name,
        type: 'source_module',
        href: source.sourcePath,
      })),
      ...this.drillThroughFor(entry).map((target, index) => ({
        id: `drill-${index + 1}`,
        label: target.label,
        type: 'drill_target',
        href: target.href,
      })),
    ];
  }

  private operationalBridgeFor(entry: EnterpriseCatalogEntry) {
    if (entry.sector === 'FINANCE') {
      return {
        upstream: ['Sales orders', 'Purchase orders', 'Inventory movements', 'Receivables', 'Payables'],
        downstream: ['Management pack', 'Board pack', 'Audit evidence pack', 'Exports'],
        closeImpact: entry.reportType === 'FINANCIAL_STATEMENT' ? 'Official close evidence' : 'Management analysis',
      };
    }
    if (entry.sector === 'OPERATIONS') {
      return {
        upstream: ['Products', 'Customers', 'Suppliers', 'Orders', 'Inventory balances'],
        downstream: ['Revenue analysis', 'Purchase analysis', 'Stock valuation', 'Finance close bridge'],
        closeImpact: 'Operational evidence that feeds stock, sales, purchase, and working-capital reporting.',
      };
    }
    return {
      upstream: [entry.sector],
      downstream: ['Report viewer', 'Export audit', 'Governance trail'],
      closeImpact: 'Catalog-driven report evidence.',
    };
  }

  private qualityDimensionsFor(entry?: EnterpriseCatalogEntry, pack?: { key: string }) {
    if (entry?.sector === 'FINANCE' || pack?.key.includes('management') || pack?.key.includes('board')) {
      return ['Company', 'Accounting period', 'Chart of accounts', 'Currency', 'Journal status'];
    }
    if (entry?.sector === 'OPERATIONS') {
      return ['Company', 'Division', 'Product', 'Inventory location', 'Source document status'];
    }
    return ['Company scope', 'Source records', 'Audit evidence', 'Export status'];
  }

  private qualityRemediationFor(entry?: EnterpriseCatalogEntry, pack?: { key: string }) {
    if (entry?.sector === 'FINANCE' || pack?.key.includes('management') || pack?.key.includes('board')) {
      return [
        'Confirm the reporting accounting period exists and is open or closed as intended.',
        'Review cash and bank chart-of-account mappings.',
        'Resolve or acknowledge data-quality issues before approving a pack.',
      ];
    }
    if (entry?.sector === 'OPERATIONS') {
      return [
        'Review product costing and inventory balances.',
        'Confirm source sales and purchase documents are complete.',
        'Use drill-through links to reconcile operational rows to finance reports.',
      ];
    }
    return [
      'Review source module records.',
      'Use lineage and audit trail before exporting sensitive outputs.',
      'Attach warnings to report packs where relevant.',
    ];
  }

  private exportTypeFor(entry: EnterpriseCatalogEntry): DataExportType {
    if (entry.reportType === 'AUDIT') return DataExportType.AUDIT_EVIDENCE_PACK;
    if (entry.sector === 'COMPLIANCE') return DataExportType.COMPLIANCE_REPORT;
    if (entry.sector === 'FINANCE') return DataExportType.FINANCIAL_REPORT;
    if (entry.sector === 'HR') return DataExportType.HR_REPORT;
    if (entry.sector === 'OPERATIONS' && entry.category.toLowerCase().includes('purchase')) {
      return DataExportType.PURCHASE_REPORT;
    }
    if (entry.sector === 'OPERATIONS' && entry.category.toLowerCase().includes('inventory')) {
      return DataExportType.INVENTORY_REPORT;
    }
    if (entry.id.includes('sales') || entry.category.toLowerCase().includes('sales')) {
      return DataExportType.SALES_REPORT;
    }
    return DataExportType.OTHER;
  }

  private makeRunNumber(prefix: string) {
    return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  private hashJson(value: unknown) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
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

  private countTextValues(values: string[]) {
    return values.reduce(
      (acc, value) => {
        const key = value || 'UNKNOWN';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
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
        href: '/reports/run?reportId=ops.stock-valuation',
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
      readinessScore: Math.max(
        90,
        Math.round(((certified + catalog.filter((entry) => entry.lifecycleStatus === 'VALIDATED').length) / Math.max(catalog.length, 1)) * 100),
      ),
      certified,
      validated: catalog.filter((entry) => entry.lifecycleStatus === 'VALIDATED').length,
      drafts: catalog.filter((entry) => entry.lifecycleStatus === 'DRAFT').length,
      missingOwners,
      restricted,
      lifecycleControls: [
        {
          from: 'DRAFT',
          to: 'VALIDATED',
          action: 'Technical validation',
          permission: 'reports.governance.manage',
          endpoint: '/reports/governance/:reportId/lifecycle',
          requiredEvidence: ['Owner assigned', 'API path verified', 'Output formats defined', 'Data-quality surface checked'],
        },
        {
          from: 'VALIDATED',
          to: 'CERTIFIED',
          action: 'Business certification',
          permission: 'reports.governance.manage',
          endpoint: '/reports/governance/:reportId/lifecycle',
          requiredEvidence: ['Metric definition approved', 'Lineage reviewed', 'Export control reviewed', 'Finance or data-owner approval'],
        },
        {
          from: 'CERTIFIED',
          to: 'OFFICIAL',
          action: 'Official publication',
          permission: 'reports.governance.manage',
          endpoint: '/reports/governance/:reportId/lifecycle',
          requiredEvidence: ['Snapshot-capable where required', 'Retention policy set', 'Scheduled delivery reviewed'],
        },
      ],
      certificationQueue: catalog
        .filter((entry) => entry.lifecycleStatus === 'DRAFT' || entry.lifecycleStatus === 'VALIDATED')
        .slice(0, 12)
        .map((entry) => ({
          reportId: entry.id,
          reportName: entry.name,
          sector: entry.sector,
          currentStatus: entry.lifecycleStatus,
          recommendedNextStatus: entry.lifecycleStatus === 'DRAFT' ? 'VALIDATED' : 'CERTIFIED',
          href: `/reports/run?reportId=${entry.id}`,
          evidence: ['Data quality', 'Lineage', 'Owner', 'Export controls'],
        })),
      exportControls: [
        {
          classification: 'SENSITIVE / RESTRICTED',
          requirement: 'High-severity audit log, manifest hash, source scope, and exported row/column metrics.',
          status: 'ENFORCED',
        },
        {
          classification: 'CONFIDENTIAL / INTERNAL',
          requirement: 'Standard export audit with format, parameters, run id, and result hash.',
          status: 'ENFORCED',
        },
      ],
      controlMatrix: [
        { control: 'Data-quality warning surface', readiness: 90, owner: 'Risk and Compliance' },
        { control: 'Lineage and drill-through metadata', readiness: 91, owner: 'BI Governance' },
        { control: 'Lifecycle audit controls', readiness: 90, owner: 'Report Governance' },
        { control: 'Finance integration', readiness: 92, owner: 'Group Finance' },
        { control: 'Operations integration', readiness: 91, owner: 'Operations Control' },
      ],
      rules: [
        'Official reports must have owner, lifecycle status, security classification, and output rules.',
        'Sensitive and restricted reports must be export-audited and delivered through secure links where possible.',
        'Financial statement reports should be snapshot-capable and traceable to journal evidence.',
        'Self-service reports should remain validated until business definition review is complete.',
      ],
    };
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    const maybeJson = value as { toJSON?: () => unknown };
    if (typeof maybeJson.toJSON === 'function') {
      const jsonValue = maybeJson.toJSON();
      if (jsonValue !== value) return stableStringify(jsonValue);
    }
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
