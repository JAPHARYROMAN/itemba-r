import type { ValuationOptions } from '@/features/inventory/stock-valuation-format';

export interface CatalogEntry {
  id: string;
  sector: string;
  category: string;
  name: string;
  description: string;
  scopes: string[];
  permission: string;
  apiPath: string;
  frontendPath: string;
  reportType?: string;
  lifecycleStatus?: string;
  owner?: string;
  dataFreshness?: string;
  securityClassification?: string;
  outputFormats?: string[];
  tags?: string[];
  businessQuestions?: string[];
  drillPaths?: string[];
  relatedCapabilities?: string[];
}

export interface LineageStep {
  stage: string;
  detail: string;
  reference: string;
}

export interface DrillTarget {
  label: string;
  href: string;
  target: string;
  evidenceType?: string;
}

export interface LineageResponse {
  lineage: LineageStep[];
  drillThrough: DrillTarget[];
  semanticModel?: {
    dataset: string;
    measures: string[];
    dimensions: string[];
    basis: string;
    grain: string;
  };
  sourceSystems?: { name: string; module: string; sourcePath: string }[];
  drillGraph?: { id: string; label: string; type: string; href: string }[];
  securityTrace?: {
    requiredPermission: string;
    scope: string[];
    accessLevel: string;
    rowLevelFilter: string;
    exportControl: string;
  };
  operationalBridge?: {
    upstream: string[];
    downstream: string[];
    closeImpact: string;
  };
}

export interface QualityWarning {
  severity?: string;
  title: string;
  description?: string | null;
  source?: string;
  issueNumber?: string;
  status?: string;
  detectedAt?: string;
}

export interface QualitySurface {
  readinessScore: number;
  trustStatus: string;
  severityCounts: Record<string, number>;
  affectedDimensions: string[];
  displayMode: string;
  remediationActions: string[];
  officialUse: string;
}

export interface ExplainResponse {
  summary: string;
  basis: string;
  drivers: { label: string; value: string; interpretation: string }[];
  recommendedDrillDowns: DrillTarget[];
  explainThisNumber?: {
    mode: string;
    confidence: string;
    semanticDataset: string;
    formulaTrace: string[];
    sourceSystems: string[];
    groundingSignals: string[];
    generatedNarrative: string;
    nextBestActions: string[];
  };
  promptTemplates?: {
    prompt: string;
    reportId: string;
    reportName: string;
    semanticDataset: string;
    href: string;
  }[];
  caveats: string[];
}

export interface ReportResultMetrics {
  rowCount: number;
  columnCount: number;
  scalarCount: number;
  objectSectionCount: number;
  primarySection: string;
  dataHash: string;
}

export interface ViewerRunManifest {
  runId: string;
  reportId: string;
  reportName: string;
  generatedAt: string;
  sourcePath: string;
  sourceUrl?: string;
  lifecycleStatus: string;
  securityClassification: string;
  metrics: ReportResultMetrics & { clientDataHash?: string };
  controls: {
    dataQualityAttached: boolean;
    lineageAttached: boolean;
    exportAuditRequired: boolean;
    snapshotEligible: boolean;
  };
  manifestHash: string;
  status: string;
}

export interface ExportHistoryItem {
  id: string;
  exportNumber: string;
  format: string;
  status: string;
  fileName?: string | null;
  createdAt: string;
  completedAt?: string | null;
  auditHash?: string | null;
  runId?: string | null;
  metrics?: Partial<ReportResultMetrics>;
  exportedBy?: { fullName?: string | null; email?: string | null } | null;
}

export interface ExportAuditHistory {
  total: number;
  exports: ExportHistoryItem[];
}

export interface ExportAuditResponse {
  exportRecord?: { exportNumber: string; completedAt?: string; fileName?: string | null };
  audit?: {
    auditHash: string;
    runId?: string | null;
    dataHash?: string | null;
    exportedAt?: string;
    metrics?: Partial<ReportResultMetrics>;
  };
}

/** Parameters persisted inside a saved view's `filters` blob. */
export interface SavedViewFilters {
  companyId?: string;
  divisionId?: string;
  dateFrom?: string;
  dateTo?: string;
  asOf?: string;
}

/** Presentation config persisted inside a saved view's `chartConfig` blob. */
export interface SavedViewChartConfig {
  viewMode?: 'table' | 'chart';
  metricColumns?: string[] | null;
  stockValuation?: ValuationOptions;
}

export interface SavedReportView {
  id: string;
  name: string;
  reportDefinitionId: string;
  companyId?: string | null;
  filters?: SavedViewFilters | null;
  chartConfig?: SavedViewChartConfig | null;
  isDefault?: boolean;
  isShared?: boolean;
  userId?: string;
  createdAt?: string;
}

export type ReportFilters = {
  companyId: string;
  divisionId: string;
  dateFrom: string;
  dateTo: string;
  asOf: string;
};
export type ReportPresentation = {
  viewMode: 'table' | 'chart';
  metricColumns: string[] | null;
  stockValuation?: ValuationOptions;
};
export type ReportCatalog = { entries: CatalogEntry[]; generatedAt: string };
export type SavedViewTarget =
  | {
      kind: 'saved-view-create';
      reportId: string;
      permission: string;
      name: string;
      filters: ReportFilters;
      chartConfig: ReportPresentation;
    }
  | { kind: 'saved-view-action'; id: string; action: 'default' | 'delete' };
