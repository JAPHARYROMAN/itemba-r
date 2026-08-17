import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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
  ApprovalActionEnum,
  ApprovalRequestActionType,
  ApprovalRequestStatus,
  AuditSeverity,
  DataExportStatus,
  DataExportType,
  DataQualityIssueStatus,
  Prisma,
  ReportCategory,
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

type SemanticGroupByRunner = (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;

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
      securityCounts[e.securityClassification] =
        (securityCounts[e.securityClassification] ?? 0) + 1;
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

  viewerMetadata(reportId: string) {
    const entry = this.catalog().find((candidate) => candidate.id === reportId);
    if (!entry) return null;
    return {
      entry,
      viewer: {
        basis:
          entry.reportType === 'FINANCIAL_STATEMENT'
            ? 'Accrual by default, cash basis where endpoint supports it'
            : 'Operational basis',
        snapshotMode:
          entry.reportType === 'FINANCIAL_STATEMENT' ||
          entry.reportType === 'COMPLIANCE' ||
          entry.reportType === 'AUDIT'
            ? 'Snapshot capable'
            : 'Live view',
        lineage: entry.drillPaths,
        explainPrompts: entry.businessQuestions,
        recommendedActions: entry.relatedCapabilities,
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
        {
          stage: 'Catalog',
          detail: `${entry.sector} / ${entry.category}`,
          reference: '/reports/catalog',
        },
        {
          stage: 'Semantic layer',
          detail: entry.tags.join(', '),
          reference: '/reports/data-catalog',
        },
        { stage: 'Source endpoint', detail: entry.apiPath, reference: entry.apiPath },
        { stage: 'Viewer', detail: entry.frontendPath, reference: entry.frontendPath },
        {
          stage: 'Audit trail',
          detail: 'Report runs, exports, pack generation, and lifecycle actions are logged.',
          reference: '/audit-logs',
        },
      ],
      drillGraph: this.drillGraphFor(entry),
      drillThrough: this.drillThroughFor(entry),
      securityTrace: {
        requiredPermission: entry.permission,
        scope: entry.scopes,
        accessLevel: 'READ',
        rowLevelFilter: companyId ? `companyId=${companyId}` : 'user company scope / group scope',
        exportControl:
          entry.securityClassification === 'SENSITIVE' ||
          entry.securityClassification === 'RESTRICTED'
            ? 'High-severity export audit required'
            : 'Standard export audit required',
      },
      operationalBridge: this.operationalBridgeFor(entry),
      recentGovernanceEvents: governanceEvents,
    };
  }

  async dataQualityWarnings(reportId: string, user: AuthUser, query: Record<string, unknown> = {}) {
    const entry = this.catalog().find((candidate) => candidate.id === reportId);
    if (!entry) throw new NotFoundException('Report not found');

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
    if (entry?.reportType === 'FINANCIAL_STATEMENT') {
      if (!companyId) {
        computedWarnings.push({
          severity: 'MEDIUM',
          title: 'Group-level financial pack',
          description:
            'No company was selected, so the output is treated as group-level and requires a group-scoped user.',
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
            description:
              'Create or open the relevant accounting period before using this output as an official report.',
            source: 'accounting_periods',
          });
        }
      }
    }

    if (companyId && entry?.id.includes('cash')) {
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
          description:
            'Set accountSubType="cash_on_hand" or "bank" on cash/bank accounts, or create a conventional account code such as 1000, 1010, or 1020.',
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
    const severityCounts = this.countTextValues(
      warnings.map((warning) => String(warning.severity ?? 'UNKNOWN')),
    );
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
        trustStatus:
          readinessScore >= 90 ? 'READY' : readinessScore >= 80 ? 'ATTENTION' : 'BLOCKED',
        severityCounts,
        affectedDimensions: this.qualityDimensionsFor(entry),
        displayMode: 'INLINE_VIEWER_AND_COMMAND_CENTER',
        remediationActions: this.qualityRemediationFor(entry),
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

    const [postedJournals, draftJournals, openQuality] = await Promise.all([
      this.prisma.journalEntry.count({
        where: { ...companyWhere, ...dateWhere, status: 'POSTED', deletedAt: null },
      }),
      this.prisma.journalEntry.count({
        where: { ...companyWhere, ...dateWhere, status: 'DRAFT', deletedAt: null },
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
      explainThisNumber: {
        mode: 'GOVERNED_ASSISTED_EXPLANATION',
        confidence: 'MEDIUM',
        semanticDataset: this.semanticModelFor(entry).dataset,
        formulaTrace: this.semanticModelFor(entry).measures,
        sourceSystems: this.sourceSystemsFor(entry).map((source) => source.name),
        groundingSignals: [
          `${postedJournals} posted journal(s)`,
          `${draftJournals} draft journal(s)`,
          `${openQuality} open data-quality issue(s)`,
        ],
        generatedNarrative:
          openQuality > 0
            ? 'The number should be treated as provisional because open or acknowledged data-quality issues exist in the selected scope.'
            : 'The number is grounded in currently accessible source records and can be investigated through the recommended drill-down path.',
        nextBestActions: this.drillThroughFor(entry)
          .slice(0, 3)
          .map((target) => target.label),
      },
      promptTemplates: this.explainPromptLibrary([entry]),
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
        entry.securityClassification === 'SENSITIVE' ||
        entry.securityClassification === 'RESTRICTED'
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
        entry.securityClassification === 'SENSITIVE' ||
        entry.securityClassification === 'RESTRICTED'
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
      'who owes us money': [
        'receivables',
        'aging',
        'customer',
        'balance',
        'collections',
        'overdue',
      ],
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
      scopes: this.facet(
        catalog.flatMap((entry) => entry.scopes.map((scope) => ({ scope }))),
        (entry) => entry.scope,
      ),
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
      collection(
        'cfo-close',
        'CFO close and statements',
        'Financial statements, cash, AR/AP, consolidation, and close evidence.',
        (entry) =>
          entry.sector === 'FINANCE' ||
          entry.relatedCapabilities.includes('Financial Statements Archive'),
      ),
      collection(
        'operations-live',
        'Operations control',
        'Inventory, sales, purchases, movements, and branch execution.',
        (entry) =>
          entry.sector === 'OPERATIONS' ||
          entry.sector === 'WESTSIDES' ||
          entry.sector === 'PETROLEUM',
      ),
      collection(
        'audit-compliance',
        'Audit and compliance evidence',
        'Formal reports, control evidence, tax readiness, and audit trail.',
        (entry) => entry.reportType === 'AUDIT' || entry.reportType === 'COMPLIANCE',
      ),
      collection(
        'self-service-bi',
        'Self-service BI',
        'Builder, saved views, report runs, scheduled delivery, and governed datasets.',
        (entry) => entry.reportType === 'SELF_SERVICE' || entry.sector === 'BI',
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
        terms: [
          'trial',
          'profit',
          'balance',
          'cash',
          'aging',
          'intercompany',
          'financial',
          'audit',
        ],
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
    const count = (predicate: (entry: EnterpriseCatalogEntry) => boolean) =>
      catalog.filter(predicate).length;
    return [
      {
        key: 'run-certified',
        title: 'Run certified reports',
        description:
          'Launch official and certified reports with context, export, and lineage controls.',
        href: '/reports',
        badge: 'Run',
        reportCount: count(
          (entry) => entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL',
        ),
      },
      {
        key: 'answer-question',
        title: 'Answer a business question',
        description:
          'Use synonym-aware discovery to find reports by business language rather than menu location.',
        href: '/reports',
        badge: 'Discover',
        reportCount: this.businessQuestionIndex(catalog).length,
      },
      {
        key: 'govern-catalog',
        title: 'Govern the catalog',
        description:
          'Review ownership, lifecycle, export sensitivity, readiness gaps, and certified coverage.',
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
        count: catalog.filter((entry) => entry.sector === sector && entry.reportType === reportType)
          .length,
      })),
      certifiedOrOfficial: catalog.filter(
        (entry) =>
          entry.sector === sector &&
          (entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL'),
      ).length,
      sensitiveOrRestricted: catalog.filter(
        (entry) =>
          entry.sector === sector &&
          (entry.securityClassification === 'SENSITIVE' ||
            entry.securityClassification === 'RESTRICTED'),
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
    const withQuestions = percent(
      catalog.filter((entry) => entry.businessQuestions.length > 0).length,
    );
    const withDrillPaths = percent(catalog.filter((entry) => entry.drillPaths.length > 0).length);
    const withOutputs = percent(catalog.filter((entry) => entry.outputFormats.length > 0).length);
    const withPermission = percent(catalog.filter((entry) => Boolean(entry.permission)).length);
    const withApiPath = percent(catalog.filter((entry) => Boolean(entry.apiPath)).length);
    const withFrontendPath = percent(catalog.filter((entry) => Boolean(entry.frontendPath)).length);
    const withTags = percent(catalog.filter((entry) => entry.tags.length >= 4).length);
    const certifiedOrOfficial = percent(
      catalog.filter(
        (entry) => entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL',
      ).length,
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

  private explainPromptLibrary(catalog: EnterpriseCatalogEntry[]) {
    return catalog
      .flatMap((entry) =>
        entry.businessQuestions.slice(0, 3).map((question) => ({
          prompt: question,
          reportId: entry.id,
          reportName: entry.name,
          semanticDataset: this.semanticModelFor(entry).dataset,
          groundedBy: [
            'data-quality warnings',
            'lineage',
            'source-count drivers',
            'drill-through targets',
          ],
          href: `/reports/run?reportId=${entry.id}`,
        })),
      )
      .slice(0, 30);
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
        {
          label: 'Statement line',
          href: '/finance/reports',
          target: 'financial-statement-line',
          evidenceType: 'financial_statement_line',
        },
        {
          label: 'Account detail',
          href: '/accounting-engine/chart-of-accounts',
          target: 'chart-of-account',
          evidenceType: 'chart_of_account',
        },
        {
          label: 'Journal entries',
          href: '/accounting-engine/journal-entries',
          target: 'journal-entry',
          evidenceType: 'journal_entry',
        },
        {
          label: 'Source documents',
          href: '/documents',
          target: 'document',
          evidenceType: 'source_document',
        },
      ];
    }
    if (entry.sector === 'OPERATIONS') {
      return [
        {
          label: 'Operational summary',
          href: '/operations/reports',
          target: 'summary',
          evidenceType: 'operational_report',
        },
        {
          label: 'Inventory movements',
          href: '/inventory?tab=stock&view=movements',
          target: 'inventory-movement',
          evidenceType: 'inventory_movement',
        },
        {
          label: 'Products',
          href: '/inventory?tab=catalog&view=products',
          target: 'product',
          evidenceType: 'product_master',
        },
        {
          label: 'Source orders',
          href: '/operations/sales-orders',
          target: 'sales-order',
          evidenceType: 'sales_or_purchase_order',
        },
      ];
    }
    if (entry.sector === 'COMPLIANCE' || entry.reportType === 'AUDIT') {
      return [
        {
          label: 'Control finding',
          href: '/compliance/reports',
          target: 'control',
          evidenceType: 'control_finding',
        },
        {
          label: 'Audit trail',
          href: '/audit-logs',
          target: 'audit-log',
          evidenceType: 'audit_log',
        },
        {
          label: 'Evidence packs',
          href: '/compliance/evidence-packs',
          target: 'evidence-pack',
          evidenceType: 'evidence_pack',
        },
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
        measures: [
          'Opening balance',
          'Debit movement',
          'Credit movement',
          'Closing balance',
          'Period activity',
        ],
        dimensions: ['Company', 'Account', 'Fiscal period', 'Currency', 'Branch', 'Division'],
        basis: 'Accrual with endpoint-specific cash basis where supported',
        grain: 'Journal line / account period',
      };
    }
    if (entry.sector === 'OPERATIONS') {
      return {
        dataset: 'operations_transactions',
        measures: [
          'Quantity',
          'Value',
          'Average cost',
          'Sales amount',
          'Purchase amount',
          'Variance',
        ],
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
        {
          name: 'General Ledger',
          module: 'Accounting Engine',
          sourcePath: '/accounting-engine/journal-entries',
        },
        { name: 'Chart of Accounts', module: 'Finance', sourcePath: '/finance/chart-of-accounts' },
        {
          name: 'Accounting Periods',
          module: 'Finance',
          sourcePath: '/finance/accounting-periods',
        },
      ];
    }
    if (entry.sector === 'OPERATIONS') {
      return [
        { name: 'Products', module: 'Operations', sourcePath: '/inventory?tab=catalog&view=products' },
        {
          name: 'Inventory Movements',
          module: 'Operations',
          sourcePath: '/inventory?tab=stock&view=movements',
        },
        { name: 'Sales Orders', module: 'Operations', sourcePath: '/operations/sales-orders' },
        {
          name: 'Purchase Orders',
          module: 'Operations',
          sourcePath: '/operations/purchase-orders',
        },
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
      {
        id: 'report',
        label: entry.name,
        type: 'report',
        href: `/reports/run?reportId=${entry.id}`,
      },
      {
        id: 'semantic',
        label: this.semanticModelFor(entry).dataset,
        type: 'semantic_model',
        href: '/reports',
      },
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
        upstream: [
          'Sales orders',
          'Purchase orders',
          'Inventory movements',
          'Receivables',
          'Payables',
        ],
        downstream: ['Management pack', 'Board pack', 'Audit evidence pack', 'Exports'],
        closeImpact:
          entry.reportType === 'FINANCIAL_STATEMENT'
            ? 'Official close evidence'
            : 'Management analysis',
      };
    }
    if (entry.sector === 'OPERATIONS') {
      return {
        upstream: ['Products', 'Customers', 'Suppliers', 'Orders', 'Inventory balances'],
        downstream: [
          'Revenue analysis',
          'Purchase analysis',
          'Stock valuation',
          'Finance close bridge',
        ],
        closeImpact:
          'Operational evidence that feeds stock, sales, purchase, and working-capital reporting.',
      };
    }
    return {
      upstream: [entry.sector],
      downstream: ['Report viewer', 'Export audit', 'Governance trail'],
      closeImpact: 'Catalog-driven report evidence.',
    };
  }

  private qualityDimensionsFor(entry?: EnterpriseCatalogEntry, pack?: { key: string }) {
    if (
      entry?.sector === 'FINANCE' ||
      pack?.key.includes('management') ||
      pack?.key.includes('board')
    ) {
      return ['Company', 'Accounting period', 'Chart of accounts', 'Currency', 'Journal status'];
    }
    if (entry?.sector === 'OPERATIONS') {
      return ['Company', 'Division', 'Product', 'Inventory location', 'Source document status'];
    }
    return ['Company scope', 'Source records', 'Audit evidence', 'Export status'];
  }

  private qualityRemediationFor(entry?: EnterpriseCatalogEntry, pack?: { key: string }) {
    if (
      entry?.sector === 'FINANCE' ||
      pack?.key.includes('management') ||
      pack?.key.includes('board')
    ) {
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
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value);
  if (
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber: () => number }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function normalizeSemanticKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  const escaped = text.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, '_').replace(/^_+|_+$/g, '') || 'report';
}

function neutralizeSpreadsheetFormula(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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
