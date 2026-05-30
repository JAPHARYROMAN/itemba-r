'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, PageHeader } from '@/components/ui';
import { backendGet, backendList, backendPatch, backendPost } from '@/lib/api-client';

type ReportSector =
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
  | 'BI';

type ReportScope = 'GROUP' | 'COMPANY' | 'DIVISION';
type ReportType =
  | 'FINANCIAL_STATEMENT'
  | 'OPERATIONAL'
  | 'ANALYTICAL'
  | 'COMPLIANCE'
  | 'AUDIT'
  | 'DASHBOARD'
  | 'SELF_SERVICE';
type ReportLifecycleStatus = 'DRAFT' | 'VALIDATED' | 'CERTIFIED' | 'OFFICIAL' | 'ARCHIVED';
type SecurityClassification = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'SENSITIVE';

interface CatalogEntry {
  id: string;
  sector: ReportSector;
  category: string;
  name: string;
  description: string;
  scopes: ReportScope[];
  permission: string;
  apiPath: string;
  frontendPath: string;
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

interface CatalogResponse {
  total: number;
  filtered: number;
  sectors: ReportSector[];
  sectorCounts: Record<string, number>;
  typeCounts: Record<string, number>;
  lifecycleCounts: Record<string, number>;
  securityCounts: Record<string, number>;
  categoryCounts?: Record<string, number>;
  ownerCounts?: Record<string, number>;
  generatedAt: string;
  searchIntent?: {
    query: string;
    expandedTerms: string[];
    matchedReports: number;
  } | null;
  facets?: Record<string, { value: string; count: number }[]>;
  suggestedSearches?: string[];
  businessQuestionIndex?: BusinessQuestion[];
  featuredCollections?: FeaturedCollection[];
  personaCollections?: PersonaCollection[];
  actionLanes?: ActionLane[];
  coverageMatrix?: CoverageRow[];
  readinessGaps?: ReadinessGap[];
  discoveryHealth?: DiscoveryHealth;
  entries: CatalogEntry[];
}

interface Company {
  id: string;
  name: string;
  code: string;
}

interface Division {
  id: string;
  name: string;
  code: string;
  companyId: string;
}

interface CapabilityItem {
  title: string;
  desc: string;
  href: string;
  badge: string;
}

interface MetricDefinition {
  metric: string;
  definition: string;
  owner: string;
  formula?: string;
  certificationStatus?: string;
  trendDirection?: string;
  dimensions: string[] | string;
  href: string;
}

interface ReportPack {
  key: string;
  name: string;
  owner: string;
  status: string;
  templateVersion?: string;
  cadence: string;
  href: string;
  readinessScore?: number;
  snapshotMode?: string;
  outputFormats?: string[];
  retentionPolicy?: string;
  approvalFlow?: string[];
  sections: string[];
  prerequisites: string[];
  snapshotChecklist?: string[];
}

interface PackGenerationResult {
  snapshot?: {
    id: string;
    statementRunNumber: string;
    status: string;
    generatedAt?: string;
    manifestHash?: string;
    snapshotMode?: string;
    sectionCount?: number;
    prerequisiteStatus?: string;
  };
  manifest?: {
    hash: string;
    prerequisiteChecks?: { name: string; status: string; evidence?: string }[];
    sectionManifest?: { name: string; status: string; relatedReports?: unknown[] }[];
    exportManifest?: { formats?: string[]; auditRequired?: boolean; watermark?: string };
  };
  dataQualityWarnings?: unknown[];
}

interface BusinessQuestion {
  question: string;
  reportId: string;
  reportName: string;
  sector: ReportSector;
  reportType: ReportType;
  href: string;
}

interface FeaturedCollection {
  key: string;
  title: string;
  description: string;
  reportCount: number;
  reports: CatalogEntry[];
}

interface DiscoveryHealth {
  overallScore: number;
  withOwner: number;
  withQuestions: number;
  withDrillPaths: number;
  withOutputs: number;
  withPermission?: number;
  withApiPath?: number;
  withFrontendPath?: number;
  withTags?: number;
  certifiedOrOfficial: number;
  status: string;
}

interface CommandCenterScore {
  overallScore: number;
  discovery: number;
  navigation: number;
  personalization: number;
  actionCoverage: number;
  governanceVisibility: number;
  operationalSignals: number;
  status: string;
}

interface PersonaCollection {
  key: string;
  label: string;
  objective: string;
  terms: string[];
  reports: CatalogEntry[];
}

interface ActionLane {
  key: string;
  title: string;
  description: string;
  href: string;
  badge: string;
  reportCount: number;
}

interface CoverageRow {
  sector: ReportSector;
  total: number;
  reportTypes: { reportType: ReportType; count: number }[];
  certifiedOrOfficial: number;
  sensitiveOrRestricted: number;
}

interface ReadinessGap {
  reportId: string;
  reportName: string;
  sector: ReportSector;
  gaps: string[];
}

interface DataQualitySurface {
  generatedAt: string;
  readinessScore: number;
  trustStatus: string;
  openIssueCount: number;
  severityCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  summaryTiles: { label: string; value: number; status: string }[];
  warningSurface: {
    key: string;
    title: string;
    severity: string;
    reportCount: number;
    remediation: string;
    affectedReports: { id: string; name: string; href: string }[];
  }[];
  remediationLanes: { lane: string; owner: string; actions: string[] }[];
  recentIssues: {
    id: string;
    issueNumber?: string | null;
    title: string;
    severity: string;
    status: string;
    source?: string | null;
    detectedAt?: string;
  }[];
}

interface IntegrationReadiness {
  generatedAt: string;
  overallScore: number;
  finance: {
    score: number;
    reportCount: number;
    sourceModules: string[];
    closeControls: string[];
    coreReports: { id: string; name: string; status: string; href: string; endpoint?: string }[];
  };
  operations: {
    score: number;
    reportCount: number;
    sourceModules: string[];
    operatingControls: string[];
    coreReports: { id: string; name: string; status: string; href: string; endpoint?: string }[];
  };
  bridges: { key: string; label: string; from: string; to: string; reports: string[]; status: string }[];
}

interface AdvancedReadiness {
  generatedAt: string;
  overallScore: number;
  capabilities: {
    key: string;
    label: string;
    readinessScore: number;
    status: string;
    counts: Record<string, number>;
    controls: string[];
    entryPoints: { label: string; href: string }[];
  }[];
  semanticLayer: {
    objects: {
      key: string;
      name: string;
      owner: string;
      sensitivity: string;
      refreshMode: string;
      grain: string;
      measures: string[];
      dimensions: string[];
      securityRules: string[];
      relatedReports: { id: string; name: string; href: string }[];
    }[];
    securityRules: string[];
    queryRules: string[];
  };
  explainPrompts: { prompt: string; reportId: string; reportName: string; semanticDataset: string; href: string }[];
  packApprovalWorkflow: {
    stages: { stage: string; status: string; evidence: string[] }[];
    activeWorkflowCount: number;
    pendingApprovalCount: number;
    endpoints: string[];
  };
}

interface ProductionReadiness {
  generatedAt: string;
  overallScore: number;
  status: string;
  executableCoverage: number;
  controlScores: { key: string; label: string; score: number }[];
  productionGates: { gate: string; status: string; evidence: string }[];
  remainingHardening: string[];
  catalogReportCount: number;
}

interface SemanticQueryResponse {
  queryId: string;
  generatedAt: string;
  executionMode: string;
  dataset: {
    key: string;
    name: string;
    owner: string;
    sensitivity: string;
    refreshMode: string;
    grain: string;
  };
  dimensions: string[];
  measures: string[];
  filters: Record<string, unknown>;
  columns: string[];
  rows: Record<string, unknown>[];
  totals: Record<string, unknown>;
  metrics: {
    rowCount: number;
    columnCount: number;
    executionTimeMs: number;
    dataHash: string;
  };
  visualization: string;
  lineage: {
    sourceSystems: string[];
    relatedReports: { id: string; name: string; href: string }[];
    drillThrough: { label: string; href: string }[];
  };
  security: {
    rowLevelScope: string;
    classification: string;
    exportAuditRequired: boolean;
  };
  dataQuality: string[];
  manifestHash: string;
}

interface BuilderSaveResult {
  definition?: { id: string; reportCode: string; name: string };
  savedView?: { id: string; name: string };
  run?: { id: string; reportRunNumber: string; status: string };
  preview?: SemanticQueryResponse;
  nextActions?: { label: string; href: string }[];
}

interface PackApprovalRequest {
  id: string;
  approvalRequestNumber: string;
  entityId: string;
  status: string;
  requestTitle: string;
  requestSummary?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  cancelledAt?: string | null;
  dueAt?: string | null;
  notes?: string | null;
  packKey?: string;
  packName?: string;
  statementRunNumber?: string;
  manifestHash?: string;
  approvalFlow: string[];
  requestedBy?: { fullName?: string | null; email?: string | null } | null;
  actions: {
    id: string;
    action: string;
    actionAt: string;
    comment?: string | null;
    reason?: string | null;
    actionBy?: { fullName?: string | null; email?: string | null } | null;
  }[];
}

interface PackApprovalQueue {
  generatedAt: string;
  total: number;
  summary: {
    pending: number;
    approved: number;
    actionable: number;
    readinessScore: number;
  };
  requests: PackApprovalRequest[];
}

interface PackRenderResult {
  snapshot?: {
    id: string;
    statementRunNumber: string;
    status: string;
    sourceManifestHash?: string;
  };
  exportRecord?: {
    exportNumber: string;
    status: string;
    fileName?: string | null;
    filePath?: string | null;
  };
  artifact?: {
    format: string;
    fileName: string;
    filePath: string;
    mimeType: string;
    byteLength: number;
    artifactHash: string;
    auditHash: string;
  };
  controls?: {
    watermark: string;
    exportAuditLogged: boolean;
    retentionPolicy: string;
    sourceSnapshotLocked: boolean;
  };
}

interface EnterpriseOverview {
  generatedAt: string;
  summary: {
    catalogReports: number;
    activeDefinitions: number;
    activeSchedules: number;
    failedRuns: number;
    requestedRuns: number;
    dashboards: number;
    openDataQuality: number;
    openInsights: number;
    statementRuns: number;
    certifiedCount: number;
    sensitiveCount: number;
    liveCount: number;
  };
  kpiTiles: { key: string; label: string; value: number; hint: string; status: 'ok' | 'watch' | 'critical' }[];
  dataFreshness: { source: string; mode: string; lastUpdated: string; status: string }[];
  alerts: { title: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'; message: string; href: string }[];
  capabilityAreas: Record<AreaKey, CapabilityItem[]>;
  metricCatalog: MetricDefinition[];
  reportPacks: ReportPack[];
  dataQualitySurface?: DataQualitySurface;
  integrationReadiness?: IntegrationReadiness;
  advancedReadiness?: AdvancedReadiness;
  productionReadiness?: ProductionReadiness;
  discovery?: {
    health: DiscoveryHealth;
    commandScore: CommandCenterScore;
    suggestedSearches: string[];
    businessQuestions: BusinessQuestion[];
    featuredCollections: FeaturedCollection[];
    personaCollections: PersonaCollection[];
    actionLanes: ActionLane[];
    coverageMatrix: CoverageRow[];
    readinessGaps: ReadinessGap[];
    certifiedHighlights: CatalogEntry[];
  };
  governance: {
    generatedAt: string;
    certified: number;
    validated: number;
    drafts: number;
    missingOwners: number;
    restricted: number;
    readinessScore?: number;
    lifecycleControls?: {
      from: string;
      to: string;
      action: string;
      permission: string;
      endpoint: string;
      requiredEvidence: string[];
    }[];
    certificationQueue?: {
      reportId: string;
      reportName: string;
      sector: ReportSector;
      currentStatus: ReportLifecycleStatus;
      recommendedNextStatus: ReportLifecycleStatus;
      href: string;
      evidence: string[];
    }[];
    exportControls?: { classification: string; requirement: string; status: string }[];
    controlMatrix?: { control: string; readiness: number; owner: string }[];
    rules: string[];
  };
  admin: {
    typeCounts: Record<string, number>;
    lifecycleCounts: Record<string, number>;
    securityCounts: Record<string, number>;
    activeDefinitions: number;
    activeSchedules: number;
    failedRuns: number;
    requestedRuns: number;
    dashboards: number;
    statementRuns: number;
    savedViews?: number;
    completedRuns?: number;
    kpiIndicators?: number;
    kpiSnapshots?: number;
    dashboardWidgets?: number;
    approvalWorkflows?: number;
    pendingPackApprovals?: number;
  };
}

type AreaKey =
  | 'reports'
  | 'dashboards'
  | 'kpis'
  | 'builder'
  | 'packs'
  | 'subscriptions'
  | 'catalog'
  | 'governance'
  | 'admin';

type PersonaKey = 'executive' | 'cfo' | 'operations' | 'procurement' | 'auditor' | 'analyst';

const AREA_NAV: { key: AreaKey; label: string }[] = [
  { key: 'reports', label: 'Reports' },
  { key: 'dashboards', label: 'Dashboards' },
  { key: 'kpis', label: 'KPIs' },
  { key: 'builder', label: 'Builder' },
  { key: 'packs', label: 'Report Packs' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'catalog', label: 'Data Catalog' },
  { key: 'governance', label: 'Governance' },
  { key: 'admin', label: 'Admin' },
];

const SECTOR_LABELS: Record<ReportSector, string> = {
  FINANCE: 'Finance',
  HR: 'HR and Payroll',
  OPERATIONS: 'Operations',
  PETROLEUM: 'Petroleum',
  WESTSIDES: 'Westsides',
  COMPLIANCE: 'Compliance',
  ITEMBA: 'Itemba',
  AGRICULTURE: 'Agriculture',
  CONSTRUCTION: 'Construction',
  LOGISTICS: 'Logistics',
  BI: 'BI and Advanced',
};

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  FINANCIAL_STATEMENT: 'Financial',
  OPERATIONAL: 'Operational',
  ANALYTICAL: 'Analytical',
  COMPLIANCE: 'Compliance',
  AUDIT: 'Audit',
  DASHBOARD: 'Dashboard',
  SELF_SERVICE: 'Self-service',
};

const STATUS_LABELS: Record<ReportLifecycleStatus, string> = {
  DRAFT: 'Draft',
  VALIDATED: 'Validated',
  CERTIFIED: 'Certified',
  OFFICIAL: 'Official',
  ARCHIVED: 'Archived',
};

const PERSONAS: {
  key: PersonaKey;
  label: string;
  focus: string;
  terms: string[];
}[] = [
  {
    key: 'executive',
    label: 'Executive',
    focus: 'KPI cockpit, cash, profitability, exceptions, and board-ready summaries.',
    terms: ['summary', 'cockpit', 'dashboard', 'cash', 'profit', 'group', 'activity'],
  },
  {
    key: 'cfo',
    label: 'CFO / Controller',
    focus: 'Statements, close evidence, cash, AR/AP, consolidation, and audit trail.',
    terms: ['trial', 'profit', 'balance', 'cash', 'aging', 'intercompany', 'financial', 'audit'],
  },
  {
    key: 'operations',
    label: 'Operations',
    focus: 'Stock, movements, sales, purchases, branch performance, and exceptions.',
    terms: ['stock', 'inventory', 'movement', 'sales', 'purchase', 'operations', 'valuation'],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    focus: 'Spend, suppliers, purchase orders, price variance, and commitments.',
    terms: ['purchase', 'vendor', 'supplier', 'payables', 'procurement', 'spend', 'price'],
  },
  {
    key: 'auditor',
    label: 'Auditor',
    focus: 'Evidence, lineage, controls, user actions, snapshots, and formal exports.',
    terms: ['audit', 'compliance', 'tax', 'document', 'obligation', 'evidence', 'trail'],
  },
  {
    key: 'analyst',
    label: 'Analyst',
    focus: 'Builder, custom views, report runs, saved filters, and analytical datasets.',
    terms: ['bi', 'definition', 'builder', 'run', 'analytics', 'summary', 'performance'],
  },
];

const CAPABILITY_LINKS: Record<AreaKey, CapabilityItem[]> = {
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

const METRIC_CATALOG: MetricDefinition[] = [
  {
    metric: 'Net Sales',
    definition: 'Confirmed revenue less cancellations and approved deductions.',
    owner: 'Group Finance',
    dimensions: ['Customer', 'Product', 'Company', 'Branch', 'Period'],
    href: '/reports/run?reportId=group.sales',
  },
  {
    metric: 'Gross Margin',
    definition: 'Net sales less cost of goods sold, with drill-down to orders and ledger lines where posted.',
    owner: 'Group Finance',
    dimensions: ['Product', 'Customer', 'Division', 'Period'],
    href: '/finance/reports',
  },
  {
    metric: 'Inventory Value',
    definition: 'Quantity on hand multiplied by average cost for the selected stock location.',
    owner: 'Operations Control',
    dimensions: ['Product', 'Branch', 'Location', 'Company'],
    href: '/reports/run?reportId=ops.stock-valuation',
  },
  {
    metric: 'Receivables Aging',
    definition: 'Open customer balances bucketed by overdue days.',
    owner: 'Group Finance',
    dimensions: ['Customer', 'Company', 'Period', 'Currency'],
    href: '/reports/run?reportId=finance.receivables-aging',
  },
  {
    metric: 'Payables Aging',
    definition: 'Open supplier balances bucketed by overdue days.',
    owner: 'Group Finance',
    dimensions: ['Supplier', 'Company', 'Period', 'Currency'],
    href: '/reports/run?reportId=finance.payables-aging',
  },
];

const EMPTY_ENTRIES: CatalogEntry[] = [];
const EMPTY_SECTORS: ReportSector[] = [];

const inputClass =
  'w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-brand-500';

const controlStyle = {
  background: 'var(--aurora-card)',
  borderColor: 'var(--aurora-border)',
  color: 'var(--aurora-text)',
} as const;

function countBy<T extends string>(entries: CatalogEntry[], pick: (entry: CatalogEntry) => T): Record<T, number> {
  return entries.reduce(
    (acc, entry) => {
      const key = pick(entry);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>,
  );
}

function formatDateTime(value?: string) {
  if (!value) return 'Not loaded yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatList(value: string[] | string) {
  return Array.isArray(value) ? value.join(', ') : value;
}

function toneForOperationalStatus(status: string): 'green' | 'amber' | 'red' | 'blue' | 'neutral' {
  if (
    status === 'ok' ||
    status === 'READY' ||
    status === 'TEMPLATE_READY' ||
    status === 'CERTIFIED' ||
    status === 'PASS' ||
    status === 'APPROVED' ||
    status === 'PRODUCTION_READY_WITH_MONITORING'
  )
    return 'green';
  if (status === 'watch' || status === 'ATTENTION' || status === 'DESIGN_READY' || status === 'VALIDATED' || status === 'PENDING')
    return 'amber';
  if (status === 'critical' || status === 'HIGH' || status === 'CRITICAL' || status === 'NEEDS_SETUP') return 'red';
  if (status === 'LOW' || status === 'MEDIUM') return 'blue';
  return 'neutral';
}

function badgeToneForStatus(status: ReportLifecycleStatus): 'green' | 'amber' | 'blue' | 'neutral' {
  if (status === 'CERTIFIED' || status === 'OFFICIAL') return 'green';
  if (status === 'DRAFT') return 'amber';
  if (status === 'VALIDATED') return 'blue';
  return 'neutral';
}

function badgeToneForSecurity(security: SecurityClassification): 'red' | 'amber' | 'blue' | 'neutral' {
  if (security === 'SENSITIVE' || security === 'RESTRICTED') return 'red';
  if (security === 'CONFIDENTIAL') return 'amber';
  if (security === 'INTERNAL') return 'blue';
  return 'neutral';
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red';
}) {
  const styles = {
    neutral: { background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)', borderColor: 'var(--aurora-border)' },
    blue: { background: 'var(--aurora-primary-subtle)', color: 'var(--aurora-primary-text)', borderColor: 'var(--aurora-border)' },
    green: { background: 'var(--aurora-success-bg)', color: 'var(--aurora-success-text)', borderColor: 'var(--aurora-success)' },
    amber: { background: 'var(--aurora-warning-bg)', color: 'var(--aurora-warning-text)', borderColor: 'var(--aurora-warning)' },
    red: { background: 'var(--aurora-danger-bg)', color: 'var(--aurora-danger-text)', borderColor: 'var(--aurora-danger)' },
  }[tone];

  return (
    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium" style={styles}>
      {children}
    </span>
  );
}

function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function CapabilityGrid({ items }: { items: CapabilityItem[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.href + item.title}
          href={item.href}
          className="block rounded-lg border p-4 transition-colors hover:border-brand-500"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          <div className="mb-3">
            <Badge tone="blue">{item.badge}</Badge>
          </div>
          <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {item.title}
          </div>
          <p className="mt-1 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
            {item.desc}
          </p>
        </Link>
      ))}
    </div>
  );
}

function ReportCard({
  entry,
  href,
  isFavorite = false,
  onToggleFavorite,
  onOpen,
}: {
  entry: CatalogEntry;
  href: string;
  isFavorite?: boolean;
  onToggleFavorite?: (reportId: string) => void;
  onOpen?: (reportId: string) => void;
}) {
  return (
    <div
      className="rounded-lg border p-4 transition-colors hover:border-brand-500"
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {entry.name}
          </div>
          <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {SECTOR_LABELS[entry.sector]} / {entry.category}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onToggleFavorite && (
            <button
              type="button"
              aria-label={isFavorite ? 'Remove favorite' : 'Add favorite'}
              onClick={() => onToggleFavorite(entry.id)}
              className="rounded-md border px-2 py-1 text-xs"
              style={{ borderColor: 'var(--aurora-border)', color: isFavorite ? 'var(--aurora-warning-text)' : 'var(--aurora-text-muted)' }}
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
          <Badge tone={badgeToneForStatus(entry.lifecycleStatus)}>{STATUS_LABELS[entry.lifecycleStatus]}</Badge>
        </div>
      </div>

      <p className="mt-3 min-h-10 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
        {entry.description}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="neutral">{REPORT_TYPE_LABELS[entry.reportType]}</Badge>
        <Badge tone={badgeToneForSecurity(entry.securityClassification)}>{entry.securityClassification}</Badge>
        {entry.scopes.map((scopeValue) => (
          <Badge key={scopeValue} tone="blue">
            {scopeValue}
          </Badge>
        ))}
      </div>

      <div className="mt-4 grid gap-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
        <div>Owner: {entry.owner}</div>
        <div>Freshness: {entry.dataFreshness}</div>
        <div>Outputs: {entry.outputFormats.join(', ')}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1">
        {entry.tags.slice(0, 5).map((tag) => (
          <span key={tag} className="rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
            {tag}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <Link
          href={href}
          onClick={() => onOpen?.(entry.id)}
          className="inline-flex rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Open report
        </Link>
      </div>
    </div>
  );
}

export default function MasterReportsPage() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [overview, setOverview] = useState<EnterpriseOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeArea, setActiveArea] = useState<AreaKey>('reports');
  const [persona, setPersona] = useState<PersonaKey>('executive');

  const [scope, setScope] = useState<ReportScope | 'ALL'>('ALL');
  const [sector, setSector] = useState<ReportSector | 'ALL'>('ALL');
  const [reportType, setReportType] = useState<ReportType | 'ALL'>('ALL');
  const [status, setStatus] = useState<ReportLifecycleStatus | 'ALL'>('ALL');
  const [category, setCategory] = useState('ALL');
  const [search, setSearch] = useState('');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [generatingPack, setGeneratingPack] = useState('');
  const [packResult, setPackResult] = useState('');
  const [lastPackSnapshot, setLastPackSnapshot] = useState<{
    packKey: string;
    snapshotId?: string;
    statementRunNumber?: string;
    manifestHash?: string;
  } | null>(null);
  const [packApprovalAction, setPackApprovalAction] = useState('');
  const [packApprovalResult, setPackApprovalResult] = useState('');
  const [packApprovals, setPackApprovals] = useState<PackApprovalQueue | null>(null);
  const [approvalDecisionAction, setApprovalDecisionAction] = useState('');
  const [renderingPack, setRenderingPack] = useState('');
  const [packRenderResult, setPackRenderResult] = useState('');
  const [governanceAction, setGovernanceAction] = useState('');
  const [governanceResult, setGovernanceResult] = useState('');
  const [builderDataset, setBuilderDataset] = useState('');
  const [builderName, setBuilderName] = useState('');
  const [builderDimensions, setBuilderDimensions] = useState<string[]>([]);
  const [builderMeasures, setBuilderMeasures] = useState<string[]>([]);
  const [builderRunning, setBuilderRunning] = useState(false);
  const [builderSaving, setBuilderSaving] = useState(false);
  const [builderMessage, setBuilderMessage] = useState('');
  const [builderResult, setBuilderResult] = useState<SemanticQueryResponse | null>(null);
  const [builderSaveResult, setBuilderSaveResult] = useState<BuilderSaveResult | null>(null);
  const [favoriteReportIds, setFavoriteReportIds] = useState<string[]>([]);
  const [recentReportIds, setRecentReportIds] = useState<string[]>([]);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogData, overviewData] = await Promise.all([
        backendGet<CatalogResponse>('/reports/catalog'),
        backendGet<EnterpriseOverview>('/reports/command-center'),
      ]);
      setCatalog(catalogData);
      setOverview(overviewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    try {
      setFavoriteReportIds(JSON.parse(localStorage.getItem('itemba-report-favorites') ?? '[]'));
      setRecentReportIds(JSON.parse(localStorage.getItem('itemba-report-recents') ?? '[]'));
    } catch {
      setFavoriteReportIds([]);
      setRecentReportIds([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setDivisionId('');
      return;
    }
    let cancelled = false;
    backendList<Division>('/divisions', { query: { companyId, limit: 200 } })
      .then((rows) => {
        if (!cancelled) setDivisions(rows);
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    setDivisionId('');
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const entries = catalog?.entries ?? EMPTY_ENTRIES;
  const sectors = catalog?.sectors ?? EMPTY_SECTORS;
  const selectedPersona = PERSONAS.find((item) => item.key === persona) ?? PERSONAS[0];

  const categoryOptions = useMemo(() => {
    const values = entries
      .filter((entry) => sector === 'ALL' || entry.sector === sector)
      .map((entry) => entry.category);
    return Array.from(new Set(values)).sort();
  }, [entries, sector]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (scope !== 'ALL' && !entry.scopes.includes(scope)) return false;
      if (sector !== 'ALL' && entry.sector !== sector) return false;
      if (reportType !== 'ALL' && entry.reportType !== reportType) return false;
      if (status !== 'ALL' && entry.lifecycleStatus !== status) return false;
      if (category !== 'ALL' && entry.category !== category) return false;
      if (!q) return true;
      const haystack = [
        entry.id,
        entry.sector,
        entry.category,
        entry.name,
        entry.description,
        entry.permission,
        entry.reportType,
        entry.lifecycleStatus,
        entry.owner,
        entry.dataFreshness,
        entry.securityClassification,
        ...entry.outputFormats,
        ...entry.tags,
        ...entry.businessQuestions,
        ...entry.drillPaths,
        ...entry.relatedCapabilities,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [category, entries, reportType, scope, search, sector, status]);

  const entriesByCategory = useMemo(() => {
    const grouped = new Map<string, CatalogEntry[]>();
    for (const entry of filteredEntries) {
      const key = `${SECTOR_LABELS[entry.sector]} / ${entry.category}`;
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredEntries]);

  const recommendedEntries = useMemo(() => {
    const score = (entry: CatalogEntry) => {
      const haystack = [
        entry.name,
        entry.description,
        entry.category,
        entry.sector,
        entry.reportType,
        ...entry.tags,
        ...entry.businessQuestions,
      ]
        .join(' ')
        .toLowerCase();
      const termScore = selectedPersona.terms.reduce((sum, term) => sum + (haystack.includes(term) ? 2 : 0), 0);
      const statusScore = entry.lifecycleStatus === 'CERTIFIED' || entry.lifecycleStatus === 'OFFICIAL' ? 2 : 0;
      return termScore + statusScore;
    };
    return [...entries]
      .map((entry) => ({ entry, score: score(entry) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .slice(0, 6)
      .map((row) => row.entry);
  }, [entries, selectedPersona]);

  const favoriteEntries = useMemo(
    () => favoriteReportIds.map((id) => entries.find((entry) => entry.id === id)).filter(Boolean) as CatalogEntry[],
    [entries, favoriteReportIds],
  );
  const recentEntries = useMemo(
    () => recentReportIds.map((id) => entries.find((entry) => entry.id === id)).filter(Boolean) as CatalogEntry[],
    [entries, recentReportIds],
  );

  const typeCounts = useMemo(() => countBy(entries, (entry) => entry.reportType), [entries]);
  const lifecycleCounts = useMemo(() => countBy(entries, (entry) => entry.lifecycleStatus), [entries]);
  const liveCount = entries.filter((entry) => entry.dataFreshness.toLowerCase().includes('live')).length;
  const certifiedCount = (lifecycleCounts.CERTIFIED ?? 0) + (lifecycleCounts.OFFICIAL ?? 0);
  const sensitiveCount = entries.filter((entry) => entry.securityClassification === 'SENSITIVE' || entry.securityClassification === 'RESTRICTED').length;
  const commandSummary = overview?.summary;
  const capabilityAreas = overview?.capabilityAreas ?? CAPABILITY_LINKS;
  const metricRows = overview?.metricCatalog ?? METRIC_CATALOG;
  const reportPacks = overview?.reportPacks ?? [];
  const dataQualitySurface = overview?.dataQualitySurface;
  const integrationReadiness = overview?.integrationReadiness;
  const advancedReadiness = overview?.advancedReadiness;
  const productionReadiness = overview?.productionReadiness;
  const governance = overview?.governance;
  const admin = overview?.admin;
  const discoveryHealth = overview?.discovery?.health ?? catalog?.discoveryHealth;
  const commandScore = overview?.discovery?.commandScore;
  const suggestedSearches = overview?.discovery?.suggestedSearches ?? catalog?.suggestedSearches ?? [];
  const businessQuestions = overview?.discovery?.businessQuestions ?? catalog?.businessQuestionIndex ?? [];
  const featuredCollections = overview?.discovery?.featuredCollections ?? catalog?.featuredCollections ?? [];
  const personaCollections = overview?.discovery?.personaCollections ?? catalog?.personaCollections ?? [];
  const actionLanes = overview?.discovery?.actionLanes ?? catalog?.actionLanes ?? [];
  const coverageMatrix = overview?.discovery?.coverageMatrix ?? catalog?.coverageMatrix ?? [];
  const readinessGaps = overview?.discovery?.readinessGaps ?? catalog?.readinessGaps ?? [];
  const selectedPersonaCollection = personaCollections.find((item) => item.key === persona);
  const semanticObjects = useMemo(() => advancedReadiness?.semanticLayer.objects ?? [], [advancedReadiness]);
  const selectedSemanticObject = semanticObjects.find((object) => object.key === builderDataset) ?? semanticObjects[0];

  useEffect(() => {
    if (!semanticObjects.length) return;
    if (!builderDataset) {
      setBuilderDataset(semanticObjects[0].key);
      return;
    }
    const active = semanticObjects.find((object) => object.key === builderDataset);
    if (!active) return;
    setBuilderDimensions(active.dimensions.slice(0, 2));
    setBuilderMeasures(active.measures.slice(0, 3));
    setBuilderName((current) => current || `${active.name} analysis`);
    setBuilderResult(null);
    setBuilderSaveResult(null);
  }, [builderDataset, semanticObjects]);

  const buildLink = (entry: CatalogEntry) => {
    const params = new URLSearchParams();
    params.set('reportId', entry.id);
    if (companyId) params.set('companyId', companyId);
    if (divisionId) params.set('divisionId', divisionId);
    if (entry.apiPath.includes('{id}')) {
      const qs = new URLSearchParams();
      if (companyId) qs.set('companyId', companyId);
      if (divisionId) qs.set('divisionId', divisionId);
      qs.set('reportId', entry.id);
      const suffix = qs.toString();
      return suffix ? `${entry.frontendPath}?${suffix}` : entry.frontendPath;
    }
    return `/reports/run?${params.toString()}`;
  };

  const rememberReport = (reportId: string) => {
    setRecentReportIds((current) => {
      const next = [reportId, ...current.filter((id) => id !== reportId)].slice(0, 8);
      localStorage.setItem('itemba-report-recents', JSON.stringify(next));
      return next;
    });
  };

  const toggleFavorite = (reportId: string) => {
    setFavoriteReportIds((current) => {
      const next = current.includes(reportId)
        ? current.filter((id) => id !== reportId)
        : [reportId, ...current].slice(0, 20);
      localStorage.setItem('itemba-report-favorites', JSON.stringify(next));
      return next;
    });
  };

  const selectSearch = (value: string) => {
    setSearch(value);
    setActiveArea('reports');
  };

  const loadPackApprovals = useCallback(async () => {
    try {
      const data = await backendGet<PackApprovalQueue>('/reports/report-packs/approval-requests', {
        query: { companyId: companyId || undefined, limit: 12 },
      });
      setPackApprovals(data);
    } catch {
      setPackApprovals(null);
    }
  }, [companyId]);

  useEffect(() => {
    if (activeArea !== 'packs') return;
    void loadPackApprovals();
  }, [activeArea, loadPackApprovals]);

  const generatePack = async (pack: ReportPack) => {
    setGeneratingPack(pack.key);
    setPackResult('');
    try {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
      const result = await backendPost<PackGenerationResult>(`/reports/report-packs/${pack.key}/generate`, {
        companyId: companyId || undefined,
        periodStart,
        periodEnd,
        currency: 'TZS',
        basis: 'ACCRUAL',
      });
      setPackResult(
        `${pack.name} generated as ${result.snapshot?.statementRunNumber ?? 'a report-pack snapshot'} with ${
          result.dataQualityWarnings?.length ?? 0
        } warning(s). Manifest ${result.manifest?.hash ?? result.snapshot?.manifestHash ?? 'pending'}.`,
      );
      setLastPackSnapshot({
        packKey: pack.key,
        snapshotId: result.snapshot?.id,
        statementRunNumber: result.snapshot?.statementRunNumber,
        manifestHash: result.manifest?.hash ?? result.snapshot?.manifestHash,
      });
      void loadCatalog();
    } catch (err) {
      setPackResult(err instanceof Error ? err.message : 'Failed to generate report pack');
    } finally {
      setGeneratingPack('');
    }
  };

  const submitPackApproval = async (pack: ReportPack) => {
    setPackApprovalAction(pack.key);
    setPackApprovalResult('');
    try {
      const snapshot = lastPackSnapshot?.packKey === pack.key ? lastPackSnapshot : null;
      const result = await backendPost<{
        request?: { approvalRequestNumber: string; status: string; id: string };
        workflow?: { currentStep: string; nextActions: string[] };
      }>(`/reports/report-packs/${pack.key}/approval-requests`, {
        companyId: companyId || undefined,
        snapshotId: snapshot?.snapshotId,
        statementRunNumber: snapshot?.statementRunNumber,
        manifestHash: snapshot?.manifestHash,
        summary: `${pack.name} submitted from Reports command center.`,
      });
      setPackApprovalResult(
        `${pack.name} approval submitted as ${result.request?.approvalRequestNumber ?? 'an approval request'} (${result.request?.status ?? 'PENDING'}).`,
      );
      void loadCatalog();
      void loadPackApprovals();
    } catch (err) {
      setPackApprovalResult(err instanceof Error ? err.message : 'Failed to submit report-pack approval');
    } finally {
      setPackApprovalAction('');
    }
  };

  const renderPack = async (pack: ReportPack, format: 'PDF' | 'XLSX' | 'CSV' | 'JSON') => {
    const snapshot = lastPackSnapshot?.packKey === pack.key ? lastPackSnapshot : null;
    if (!snapshot?.snapshotId && !snapshot?.statementRunNumber) {
      setPackRenderResult(`Generate a ${pack.name} snapshot before rendering ${format}.`);
      return;
    }
    const key = `${pack.key}:${format}`;
    setRenderingPack(key);
    setPackRenderResult('');
    try {
      const result = await backendPost<PackRenderResult>(`/reports/report-packs/${pack.key}/render`, {
        companyId: companyId || undefined,
        snapshotId: snapshot.snapshotId,
        statementRunNumber: snapshot.statementRunNumber,
        format,
      });
      setPackRenderResult(
        `${pack.name} rendered as ${result.artifact?.format ?? format}: ${
          result.artifact?.fileName ?? result.exportRecord?.fileName ?? 'artifact created'
        } (${result.artifact?.byteLength ?? 0} bytes). Audit ${result.artifact?.auditHash ?? 'logged'}.`,
      );
      void loadCatalog();
    } catch (err) {
      setPackRenderResult(err instanceof Error ? err.message : `Failed to render ${pack.name}`);
    } finally {
      setRenderingPack('');
    }
  };

  const runBuilderPreview = async () => {
    if (!selectedSemanticObject) return;
    setBuilderRunning(true);
    setBuilderMessage('');
    setBuilderSaveResult(null);
    try {
      const result = await backendPost<SemanticQueryResponse>('/reports/builder/preview', {
        datasetKey: selectedSemanticObject.key,
        dimensions: builderDimensions,
        measures: builderMeasures,
        filters: {
          companyId: companyId || undefined,
          divisionId: divisionId || undefined,
        },
        limit: 50,
      });
      setBuilderResult(result);
      setBuilderMessage(
        `${result.dataset.name} preview returned ${result.metrics.rowCount} row(s) in ${result.metrics.executionTimeMs}ms. Manifest ${result.manifestHash}.`,
      );
    } catch (err) {
      setBuilderMessage(err instanceof Error ? err.message : 'Failed to preview semantic report');
    } finally {
      setBuilderRunning(false);
    }
  };

  const saveBuilderReport = async () => {
    if (!selectedSemanticObject) return;
    setBuilderSaving(true);
    setBuilderMessage('');
    try {
      const result = await backendPost<BuilderSaveResult>('/reports/builder/save', {
        name: builderName || `${selectedSemanticObject.name} analysis`,
        datasetKey: selectedSemanticObject.key,
        dimensions: builderDimensions,
        measures: builderMeasures,
        filters: {
          companyId: companyId || undefined,
          divisionId: divisionId || undefined,
        },
        isShared: false,
        limit: 50,
      });
      setBuilderSaveResult(result);
      setBuilderResult(result.preview ?? builderResult);
      setBuilderMessage(
        `${result.definition?.name ?? 'Report'} saved as ${result.definition?.reportCode ?? 'a report definition'} with run ${result.run?.reportRunNumber ?? 'created'}.`,
      );
      void loadCatalog();
    } catch (err) {
      setBuilderMessage(err instanceof Error ? err.message : 'Failed to save builder report');
    } finally {
      setBuilderSaving(false);
    }
  };

  const actOnPackApproval = async (request: PackApprovalRequest, action: 'APPROVE' | 'REJECT' | 'COMMENT') => {
    const key = `${request.id}:${action}`;
    setApprovalDecisionAction(key);
    setPackApprovalResult('');
    try {
      const result = await backendPatch<{ request?: { approvalRequestNumber: string; status: string } }>(
        `/reports/report-packs/approval-requests/${request.id}`,
        {
          action,
          comment: `${action} from Reports command center.`,
        },
      );
      setPackApprovalResult(
        `${request.approvalRequestNumber} updated to ${result.request?.status ?? action}.`,
      );
      void loadCatalog();
      void loadPackApprovals();
    } catch (err) {
      setPackApprovalResult(err instanceof Error ? err.message : 'Failed to update approval request');
    } finally {
      setApprovalDecisionAction('');
    }
  };

  const updateGovernanceLifecycle = async (reportId: string, lifecycleStatus: ReportLifecycleStatus) => {
    const key = `${reportId}:${lifecycleStatus}`;
    setGovernanceAction(key);
    setGovernanceResult('');
    try {
      const result = await backendPatch<{
        reportName: string;
        previousStatus: string;
        lifecycleStatus: string;
        updatedAt: string;
      }>(`/reports/governance/${encodeURIComponent(reportId)}/lifecycle`, {
        companyId: companyId || undefined,
        lifecycleStatus,
        reason: `Reports command center lifecycle control moved ${reportId} to ${lifecycleStatus}.`,
      });
      setGovernanceResult(
        `${result.reportName} lifecycle action recorded: ${result.previousStatus} -> ${result.lifecycleStatus}.`,
      );
      void loadCatalog();
    } catch (err) {
      setGovernanceResult(err instanceof Error ? err.message : 'Failed to record lifecycle action');
    } finally {
      setGovernanceAction('');
    }
  };

  const resetFilters = () => {
    setScope('ALL');
    setSector('ALL');
    setReportType('ALL');
    setStatus('ALL');
    setCategory('ALL');
    setSearch('');
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Reports"
        subtitle="Enterprise reporting, analytics, governance, and decision support across ITEMBA-R."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700" href="/bi/report-builder">
              Builder
            </Link>
            <Link
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              href="/bi/scheduled-reports"
              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              Subscriptions
            </Link>
          </div>
        }
      />

      <Card padding="none" className="overflow-hidden">
        <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                Reporting command center
              </div>
              <p className="mt-1 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                Search governed reports, launch dashboards, build saved views, generate close evidence, and trace numbers back to operational source records.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Reports
                </div>
                <div className="mt-1 text-xl font-semibold">{commandSummary?.catalogReports ?? catalog?.total ?? 0}</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Certified
                </div>
                <div className="mt-1 text-xl font-semibold">{commandSummary?.certifiedCount ?? certifiedCount}</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Live
                </div>
                <div className="mt-1 text-xl font-semibold">{commandSummary?.liveCount ?? liveCount}</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Sensitive
                </div>
                <div className="mt-1 text-xl font-semibold">{commandSummary?.sensitiveCount ?? sensitiveCount}</div>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Discovery
                </div>
                <div className="mt-1 text-xl font-semibold">{discoveryHealth?.overallScore ?? 0}%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto p-2">
          {AREA_NAV.map((area) => {
            const active = activeArea === area.key;
            return (
              <button
                key={area.key}
                type="button"
                onClick={() => setActiveArea(area.key)}
                className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                style={{
                  background: active ? 'var(--aurora-primary)' : 'transparent',
                  color: active ? '#fff' : 'var(--aurora-text-secondary)',
                }}
              >
                {area.label}
              </button>
            );
          })}
        </div>
      </Card>

      {overview && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          {overview.kpiTiles.map((tile) => (
            <Card key={tile.key}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                    {tile.label}
                  </div>
                  <div className="mt-2 text-2xl font-semibold">{tile.value}</div>
                </div>
                <Badge tone={toneForOperationalStatus(tile.status)}>{tile.status}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                {tile.hint}
              </p>
            </Card>
          ))}
        </div>
      )}

      {commandScore && (
        <Card padding="none" className="overflow-hidden">
          <div className="grid gap-4 p-4 xl:grid-cols-[260px_1fr]">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Command center readiness
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="text-4xl font-semibold">{commandScore.overallScore}%</div>
                <Badge tone={toneForOperationalStatus(commandScore.status)}>{commandScore.status}</Badge>
              </div>
              <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                Measures discovery, navigation, personalization, action coverage, governance visibility, and operational signals.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
              {[
                ['Discovery', commandScore.discovery],
                ['Navigation', commandScore.navigation],
                ['Personalization', commandScore.personalization],
                ['Actions', commandScore.actionCoverage],
                ['Governance', commandScore.governanceVisibility],
                ['Signals', commandScore.operationalSignals],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                  <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                    {label}
                  </div>
                  <div className="mt-1 text-xl font-semibold">{value}%</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {productionReadiness && (
        <Card padding="none" className="overflow-hidden">
          <div className="grid gap-4 p-4 xl:grid-cols-[280px_1fr]">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                Reports production readiness
              </div>
              <div className="mt-2 flex items-end gap-2">
                <div className="text-4xl font-semibold">{productionReadiness.overallScore}%</div>
                <Badge tone={toneForOperationalStatus(productionReadiness.status)}>{productionReadiness.status}</Badge>
              </div>
              <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                Whole-module score across discovery, command center, semantic execution, data quality, integrations, advanced workflows, and governance.
              </p>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
                {productionReadiness.controlScores.map((control) => (
                  <div key={control.key} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                    <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {control.label}
                    </div>
                    <div className="mt-1 text-xl font-semibold">{control.score}%</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                {productionReadiness.productionGates.map((gate) => (
                  <div key={gate.gate} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold">{gate.gate}</div>
                      <Badge tone={toneForOperationalStatus(gate.status)}>{gate.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                      {gate.evidence}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {overview?.alerts && overview.alerts.length > 0 && (
        <Card padding="none" className="overflow-hidden">
          <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <SectionHeading title="Alerts and exceptions" subtitle="Report-trust and delivery signals from the enterprise reporting layer." />
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            {overview.alerts.map((alert) => (
              <Link
                key={alert.title}
                href={alert.href}
                className="rounded-lg border p-4 transition-colors hover:border-brand-500"
                style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-semibold">{alert.title}</div>
                  <Badge tone={toneForOperationalStatus(alert.severity)}>{alert.severity}</Badge>
                </div>
                <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                  {alert.message}
                </p>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {(dataQualitySurface || integrationReadiness) && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          {dataQualitySurface && (
            <Card padding="none" className="overflow-hidden">
              <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <SectionHeading
                    title="Data-quality warning surface"
                    subtitle="Warnings are now promoted from hidden backend checks into report launch, viewer, export, and pack readiness."
                  />
                  <Badge tone={toneForOperationalStatus(dataQualitySurface.trustStatus)}>
                    {dataQualitySurface.readinessScore}% {dataQualitySurface.trustStatus}
                  </Badge>
                </div>
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-4">
                {dataQualitySurface.summaryTiles.map((tile) => (
                  <div key={tile.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                    <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {tile.label}
                    </div>
                    <div className="mt-1 text-xl font-semibold">{tile.value}</div>
                    <div className="mt-2">
                      <Badge tone={toneForOperationalStatus(tile.status)}>{tile.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 border-t p-4 md:grid-cols-2" style={{ borderColor: 'var(--aurora-border)' }}>
                {dataQualitySurface.warningSurface.slice(0, 4).map((warning) => (
                  <div key={warning.key} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm font-semibold">{warning.title}</div>
                      <Badge tone={toneForOperationalStatus(warning.severity)}>{warning.severity}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                      {warning.remediation}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {warning.affectedReports.slice(0, 3).map((report) => (
                        <Link key={report.id} href={report.href} className="text-xs text-brand-500 hover:underline">
                          {report.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {integrationReadiness && (
            <Card padding="none" className="overflow-hidden">
              <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <SectionHeading
                    title="Finance and operations integration"
                    subtitle="Shows whether report catalog entries connect back to the operational modules and finance close layer."
                  />
                  <Badge tone="green">{integrationReadiness.overallScore}% READY</Badge>
                </div>
              </div>
              <div className="grid gap-3 p-4 md:grid-cols-2">
                {[
                  ['Financial report integration', integrationReadiness.finance.score, integrationReadiness.finance.reportCount, integrationReadiness.finance.sourceModules],
                  ['Operations report integration', integrationReadiness.operations.score, integrationReadiness.operations.reportCount, integrationReadiness.operations.sourceModules],
                ].map(([label, score, count, modules]) => (
                  <div key={String(label)} className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-2xl font-semibold">{score as number}%</div>
                    </div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {count as number} catalog reports
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(modules as string[]).slice(0, 6).map((moduleName) => (
                        <Badge key={moduleName} tone="blue">
                          {moduleName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                <div className="grid gap-2 md:grid-cols-3">
                  {integrationReadiness.bridges.map((bridge) => (
                    <div key={bridge.key} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold">{bridge.label}</div>
                        <Badge tone="green">{bridge.status}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                        {bridge.from} {'->'} {bridge.to}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {advancedReadiness && (
        <Card padding="none" className="overflow-hidden">
          <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionHeading
                title="Advanced reporting readiness"
                subtitle="Self-service BI, subscriptions, KPI intelligence, explain-this-number, semantic layer, and report-pack approval workflow."
              />
              <Badge tone="green">{advancedReadiness.overallScore}% READY</Badge>
            </div>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
            {advancedReadiness.capabilities.map((capability) => (
              <div key={capability.key} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">{capability.label}</div>
                  <Badge tone={toneForOperationalStatus(capability.status)}>{capability.status}</Badge>
                </div>
                <div className="mt-2 text-2xl font-semibold">{capability.readinessScore}%</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {capability.entryPoints.slice(0, 2).map((entryPoint) => (
                    <Link key={`${capability.key}-${entryPoint.href}`} href={entryPoint.href} className="text-xs text-brand-500 hover:underline">
                      {entryPoint.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ background: 'var(--aurora-danger-bg)', borderColor: 'var(--aurora-danger)', color: 'var(--aurora-danger-text)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-14">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        </div>
      ) : (
        <>
          {activeArea === 'reports' && (
            <div className="space-y-6">
              <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <Card>
                  <SectionHeading
                    title="Discovery cockpit"
                    subtitle="Ask business-style questions, jump into certified collections, or resume pinned reports."
                  />
                  <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        {suggestedSearches.slice(0, 8).map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() => selectSearch(item)}
                            className="rounded-lg border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-2 md:grid-cols-2">
                        {businessQuestions.slice(0, 4).map((question) => (
                          <button
                            key={`${question.reportId}-${question.question}`}
                            type="button"
                            onClick={() => selectSearch(question.question)}
                            className="rounded-lg border p-3 text-left text-sm"
                            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
                          >
                            <div className="font-medium" style={{ color: 'var(--aurora-text)' }}>
                              {question.question}
                            </div>
                            <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {question.reportName} / {REPORT_TYPE_LABELS[question.reportType]}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                        Catalog health
                      </div>
                      <div className="mt-2 text-3xl font-semibold">{discoveryHealth?.overallScore ?? 0}%</div>
                      <div className="mt-3 grid gap-2 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                        <div>Owners: {discoveryHealth?.withOwner ?? 0}%</div>
                        <div>Business questions: {discoveryHealth?.withQuestions ?? 0}%</div>
                        <div>Drill paths: {discoveryHealth?.withDrillPaths ?? 0}%</div>
                        <div>Certified/official: {discoveryHealth?.certifiedOrOfficial ?? 0}%</div>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <SectionHeading title="Pinned and recent" subtitle="Personal shortcuts stored in this browser." />
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                        Favorites
                      </div>
                      <div className="space-y-2">
                        {favoriteEntries.slice(0, 4).map((entry) => (
                          <Link
                            key={`favorite-${entry.id}`}
                            href={buildLink(entry)}
                            onClick={() => rememberReport(entry.id)}
                            className="block rounded-lg border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                          >
                            {entry.name}
                          </Link>
                        ))}
                        {favoriteEntries.length === 0 && (
                          <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
                            Pin reports with the star button on any report card.
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                        Recent
                      </div>
                      <div className="space-y-2">
                        {recentEntries.slice(0, 4).map((entry) => (
                          <Link
                            key={`recent-${entry.id}`}
                            href={buildLink(entry)}
                            onClick={() => rememberReport(entry.id)}
                            className="block rounded-lg border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                          >
                            {entry.name}
                          </Link>
                        ))}
                        {recentEntries.length === 0 && (
                          <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
                            Open a report to build recent history.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>

              {actionLanes.length > 0 && (
                <div className="space-y-3">
                  <SectionHeading title="Command lanes" subtitle="The main reporting jobs users can start directly from this command center." />
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {actionLanes.map((lane) => {
                      const content = (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <Badge tone="blue">{lane.badge}</Badge>
                            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {lane.reportCount}
                            </span>
                          </div>
                          <div className="mt-3 text-sm font-semibold">{lane.title}</div>
                          <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                            {lane.description}
                          </p>
                        </>
                      );
                      if (lane.href === '/reports') {
                        return (
                          <button
                            key={lane.key}
                            type="button"
                            onClick={() => {
                              setActiveArea(lane.key === 'generate-pack' ? 'packs' : lane.key === 'govern-catalog' ? 'governance' : 'reports');
                              if (lane.key === 'answer-question') selectSearch('business question');
                            }}
                            className="rounded-lg border p-4 text-left transition-colors hover:border-brand-500"
                            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
                          >
                            {content}
                          </button>
                        );
                      }
                      return (
                        <Link
                          key={lane.key}
                          href={lane.href}
                          className="rounded-lg border p-4 transition-colors hover:border-brand-500"
                          style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
                        >
                          {content}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {featuredCollections.length > 0 && (
                <div className="space-y-3">
                  <SectionHeading title="Featured collections" subtitle="Curated discovery sets for close, operations, compliance, and self-service BI." />
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {featuredCollections.map((collection) => (
                      <button
                        key={collection.key}
                        type="button"
                        onClick={() => selectSearch(collection.title)}
                        className="rounded-lg border p-4 text-left"
                        style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
                      >
                        <div className="text-sm font-semibold">{collection.title}</div>
                        <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                          {collection.description}
                        </p>
                        <div className="mt-3">
                          <Badge tone="blue">{collection.reportCount} reports</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Card padding="none" className="overflow-hidden">
                <div className="grid gap-4 p-4 xl:grid-cols-[1.2fr_1fr]">
                  <div>
                    <SectionHeading title="Role lens" subtitle={selectedPersona.focus} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {PERSONAS.map((item) => {
                        const active = persona === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setPersona(item.key)}
                            className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                            style={{
                              background: active ? 'var(--aurora-primary-subtle)' : 'var(--aurora-card)',
                              borderColor: active ? 'var(--aurora-primary)' : 'var(--aurora-border)',
                              color: active ? 'var(--aurora-primary-text)' : 'var(--aurora-text-secondary)',
                            }}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    {selectedPersonaCollection && (
                      <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                        <div className="text-sm font-medium">{selectedPersonaCollection.objective}</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedPersonaCollection.terms.slice(0, 8).map((term) => (
                            <button
                              key={term}
                              type="button"
                              onClick={() => selectSearch(term)}
                              className="rounded-md border px-2 py-1 text-xs"
                              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
                            >
                              {term}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {selectedPersonaCollection.reports.slice(0, 4).map((entry) => (
                            <Link
                              key={`persona-${selectedPersonaCollection.key}-${entry.id}`}
                              href={buildLink(entry)}
                              onClick={() => rememberReport(entry.id)}
                              className="rounded-lg border px-3 py-2 text-sm"
                              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
                            >
                              {entry.name}
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <SectionHeading title="Reporting freshness" subtitle={`Catalog refreshed ${formatDateTime(overview?.generatedAt ?? catalog?.generatedAt)}`} />
                    <div className="mt-3 grid gap-2 text-sm">
                      {(overview?.dataFreshness ?? []).slice(0, 4).map((freshness) => (
                        <div
                          key={freshness.source}
                          className="flex items-center justify-between gap-3 rounded-lg border p-3"
                          style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
                        >
                          <div>
                            <div className="font-medium">{freshness.source}</div>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {freshness.mode} / {formatDateTime(freshness.lastUpdated)}
                            </div>
                          </div>
                          <Badge tone={toneForOperationalStatus(freshness.status)}>{freshness.status}</Badge>
                        </div>
                      ))}
                      {!overview?.dataFreshness?.length && (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div style={{ color: 'var(--aurora-text-muted)' }}>Self-service assets</div>
                            <div className="mt-1 font-semibold">{typeCounts.SELF_SERVICE ?? 0}</div>
                          </div>
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div style={{ color: 'var(--aurora-text-muted)' }}>Financial reports</div>
                            <div className="mt-1 font-semibold">{typeCounts.FINANCIAL_STATEMENT ?? 0}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Card>

              <div className="space-y-3">
                <SectionHeading title="Recommended for this role" subtitle="Certified and high-value reports surfaced from the catalog." />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {recommendedEntries.map((entry) => (
                    <ReportCard
                      key={`recommended-${entry.id}`}
                      entry={entry}
                      href={buildLink(entry)}
                      isFavorite={favoriteReportIds.includes(entry.id)}
                      onToggleFavorite={toggleFavorite}
                      onOpen={rememberReport}
                    />
                  ))}
                </div>
              </div>

              <Card padding="none" className="overflow-hidden">
                <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                  <SectionHeading
                    title="Report library"
                    subtitle="Search by name, metric, business question, tag, owner, scope, or sector."
                    action={
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-lg border px-3 py-2 text-sm font-medium"
                        style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                      >
                        Reset
                      </button>
                    }
                  />
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
                  <div className="md:col-span-2 xl:col-span-2">
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Search
                    </label>
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="revenue by region, aging, cash, inventory, audit..."
                      className={inputClass}
                      style={controlStyle}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Scope
                    </label>
                    <select value={scope} onChange={(event) => setScope(event.target.value as ReportScope | 'ALL')} className={inputClass} style={controlStyle}>
                      <option value="ALL">All scopes</option>
                      <option value="GROUP">Group</option>
                      <option value="COMPANY">Company</option>
                      <option value="DIVISION">Division</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Sector
                    </label>
                    <select
                      value={sector}
                      onChange={(event) => {
                        setSector(event.target.value as ReportSector | 'ALL');
                        setCategory('ALL');
                      }}
                      className={inputClass}
                      style={controlStyle}
                    >
                      <option value="ALL">All sectors</option>
                      {sectors.map((item) => (
                        <option key={item} value={item}>
                          {SECTOR_LABELS[item]} ({catalog?.sectorCounts[item] ?? 0})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Type
                    </label>
                    <select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType | 'ALL')} className={inputClass} style={controlStyle}>
                      <option value="ALL">All types</option>
                      {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Status
                    </label>
                    <select value={status} onChange={(event) => setStatus(event.target.value as ReportLifecycleStatus | 'ALL')} className={inputClass} style={controlStyle}>
                      <option value="ALL">All statuses</option>
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2 xl:col-span-2">
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Category
                    </label>
                    <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} style={controlStyle}>
                      <option value="ALL">All categories</option>
                      {categoryOptions.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Company context
                    </label>
                    <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className={inputClass} style={controlStyle}>
                      <option value="">No company selected</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.code ? `${company.code} - ${company.name}` : company.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                      Division context
                    </label>
                    <select
                      value={divisionId}
                      onChange={(event) => setDivisionId(event.target.value)}
                      className={inputClass}
                      style={controlStyle}
                      disabled={!companyId}
                    >
                      <option value="">All divisions</option>
                      {divisions.map((division) => (
                        <option key={division.id} value={division.id}>
                          {division.code ? `${division.code} - ${division.name}` : division.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </Card>

              {(catalog?.searchIntent || catalog?.facets) && (
                <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                  {catalog?.searchIntent && (
                    <Card>
                      <SectionHeading
                        title="Search intelligence"
                        subtitle={`${catalog.searchIntent.matchedReports} matched report${catalog.searchIntent.matchedReports === 1 ? '' : 's'} for "${catalog.searchIntent.query}".`}
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        {catalog.searchIntent.expandedTerms.map((term) => (
                          <button
                            key={term}
                            type="button"
                            onClick={() => selectSearch(term)}
                            className="rounded-md border px-2 py-1 text-xs"
                            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
                          >
                            {term}
                          </button>
                        ))}
                      </div>
                    </Card>
                  )}
                  {catalog?.facets && (
                    <Card>
                      <SectionHeading title="Top discovery facets" subtitle="Use facets to understand catalog coverage before filtering." />
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {(catalog.facets.sectors ?? []).slice(0, 5).map((facet) => (
                          <button
                            key={`sector-facet-${facet.value}`}
                            type="button"
                            onClick={() => setSector(facet.value as ReportSector)}
                            className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
                          >
                            <span>{SECTOR_LABELS[facet.value as ReportSector] ?? facet.value}</span>
                            <span style={{ color: 'var(--aurora-text-muted)' }}>{facet.count}</span>
                          </button>
                        ))}
                        {(catalog.facets.reportTypes ?? []).slice(0, 5).map((facet) => (
                          <button
                            key={`type-facet-${facet.value}`}
                            type="button"
                            onClick={() => setReportType(facet.value as ReportType)}
                            className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
                          >
                            <span>{REPORT_TYPE_LABELS[facet.value as ReportType] ?? facet.value}</span>
                            <span style={{ color: 'var(--aurora-text-muted)' }}>{facet.count}</span>
                          </button>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                  Showing {filteredEntries.length} of {catalog?.total ?? 0} registered reports
                </div>
              </div>

              {filteredEntries.length === 0 ? (
                <Card>
                  <div className="text-center text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                    No reports match the current filters.
                  </div>
                </Card>
              ) : (
                <div className="space-y-6">
                  {entriesByCategory.map(([group, groupEntries]) => (
                    <section key={group} className="space-y-3">
                      <SectionHeading title={group} subtitle={`${groupEntries.length} report${groupEntries.length === 1 ? '' : 's'}`} />
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {groupEntries.map((entry) => (
                          <ReportCard
                            key={entry.id}
                            entry={entry}
                            href={buildLink(entry)}
                            isFavorite={favoriteReportIds.includes(entry.id)}
                            onToggleFavorite={toggleFavorite}
                            onOpen={rememberReport}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeArea !== 'reports' && (
            <div className="space-y-6">
              <SectionHeading
                title={AREA_NAV.find((area) => area.key === activeArea)?.label ?? 'Reports'}
                subtitle="This area connects existing ITEMBA-R reporting capabilities into the enterprise reporting layer."
              />
              <CapabilityGrid items={capabilityAreas[activeArea] ?? []} />

              {advancedReadiness && ['builder', 'subscriptions', 'kpis'].includes(activeArea) && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {advancedReadiness.capabilities
                    .filter((capability) =>
                      activeArea === 'builder'
                        ? capability.key === 'self-service-bi-builder'
                        : activeArea === 'subscriptions'
                          ? capability.key === 'scheduling-subscriptions'
                          : capability.key === 'kpi-dashboard-intelligence' || capability.key === 'ai-explain-this-number',
                    )
                    .map((capability) => (
                      <Card key={`active-${capability.key}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{capability.label}</div>
                            <div className="mt-2 text-3xl font-semibold">{capability.readinessScore}%</div>
                          </div>
                          <Badge tone={toneForOperationalStatus(capability.status)}>{capability.status}</Badge>
                        </div>
                        <div className="mt-4 grid gap-2">
                          {capability.controls.slice(0, 4).map((control) => (
                            <div key={control} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                              {control}
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {capability.entryPoints.map((entryPoint) => (
                            <Link key={entryPoint.href} href={entryPoint.href} className="rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>
                              {entryPoint.label}
                            </Link>
                          ))}
                        </div>
                      </Card>
                    ))}
                </div>
              )}

              {activeArea === 'builder' && selectedSemanticObject && (
                <Card padding="none" className="overflow-hidden">
                  <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <SectionHeading
                        title="Governed semantic builder"
                        subtitle="Preview live semantic datasets, preserve company scope, then save the output as a report definition, saved view, and completed run."
                      />
                      <Badge tone="green">Executable</Badge>
                    </div>
                  </div>
                  <div className="grid gap-4 p-4 xl:grid-cols-[360px_1fr]">
                    <div className="space-y-4">
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                          Dataset
                        </span>
                        <select
                          className={`${inputClass} mt-2`}
                          style={controlStyle}
                          value={builderDataset}
                          onChange={(event) => setBuilderDataset(event.target.value)}
                        >
                          {semanticObjects.map((object) => (
                            <option key={object.key} value={object.key}>
                              {object.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                          Report name
                        </span>
                        <input
                          className={`${inputClass} mt-2`}
                          style={controlStyle}
                          value={builderName}
                          onChange={(event) => setBuilderName(event.target.value)}
                          placeholder={`${selectedSemanticObject.name} analysis`}
                        />
                      </label>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                          Dimensions
                        </div>
                        <div className="mt-2 grid gap-2">
                          {selectedSemanticObject.dimensions.slice(0, 8).map((dimension) => (
                            <label key={dimension} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                              <input
                                type="checkbox"
                                checked={builderDimensions.includes(dimension)}
                                onChange={(event) =>
                                  setBuilderDimensions((current) =>
                                    event.target.checked
                                      ? Array.from(new Set([...current, dimension])).slice(0, 4)
                                      : current.filter((item) => item !== dimension),
                                  )
                                }
                              />
                              <span>{dimension}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                          Measures
                        </div>
                        <div className="mt-2 grid gap-2">
                          {selectedSemanticObject.measures.slice(0, 8).map((measure) => (
                            <label key={measure} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                              <input
                                type="checkbox"
                                checked={builderMeasures.includes(measure)}
                                onChange={(event) =>
                                  setBuilderMeasures((current) =>
                                    event.target.checked
                                      ? Array.from(new Set([...current, measure])).slice(0, 5)
                                      : current.filter((item) => item !== measure),
                                  )
                                }
                              />
                              <span>{measure}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={runBuilderPreview}
                          disabled={builderRunning || builderMeasures.length === 0}
                          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        >
                          {builderRunning ? 'Previewing...' : 'Preview'}
                        </button>
                        <button
                          type="button"
                          onClick={saveBuilderReport}
                          disabled={builderSaving || builderMeasures.length === 0}
                          className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60"
                          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                        >
                          {builderSaving ? 'Saving...' : 'Save governed report'}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-4">
                        {[
                          ['Owner', selectedSemanticObject.owner],
                          ['Sensitivity', selectedSemanticObject.sensitivity],
                          ['Refresh', selectedSemanticObject.refreshMode],
                          ['Grain', selectedSemanticObject.grain],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {label}
                            </div>
                            <div className="mt-1 break-words text-sm font-semibold">{value}</div>
                          </div>
                        ))}
                      </div>
                      {builderMessage && (
                        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                          {builderMessage}
                        </div>
                      )}
                      {builderResult && (
                        <Card padding="none" className="overflow-hidden">
                          <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <SectionHeading
                                title="Live preview"
                                subtitle={`${builderResult.metrics.rowCount} row(s), ${builderResult.metrics.columnCount} column(s), ${builderResult.metrics.executionTimeMs}ms, ${builderResult.visualization}.`}
                              />
                              <Badge tone={badgeToneForSecurity(builderResult.security.classification as SecurityClassification)}>
                                {builderResult.security.classification}
                              </Badge>
                            </div>
                          </div>
                          <div className="grid gap-3 border-b p-4 md:grid-cols-3" style={{ borderColor: 'var(--aurora-border)' }}>
                            <div>
                              <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                                Query id
                              </div>
                              <div className="mt-1 text-sm font-semibold">{builderResult.queryId}</div>
                            </div>
                            <div>
                              <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                                Manifest hash
                              </div>
                              <div className="mt-1 break-all text-xs font-semibold">{builderResult.manifestHash}</div>
                            </div>
                            <div>
                              <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                                Data-quality notes
                              </div>
                              <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
                                {builderResult.dataQuality.slice(0, 2).join(' ')}
                              </div>
                            </div>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                                <tr>
                                  {(builderResult.columns.length ? builderResult.columns : Object.keys(builderResult.rows[0] ?? {})).map((column) => (
                                    <th key={column} className="px-4 py-3 text-left font-semibold">
                                      {column}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {builderResult.rows.slice(0, 8).map((row, index) => (
                                  <tr key={`${builderResult.queryId}-${index}`} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                                    {(builderResult.columns.length ? builderResult.columns : Object.keys(row)).map((column) => (
                                      <td key={`${builderResult.queryId}-${index}-${column}`} className="px-4 py-3" style={{ color: 'var(--aurora-text-secondary)' }}>
                                        {String(row[column] ?? '-')}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Card>
                      )}
                      {builderSaveResult?.nextActions && (
                        <div className="flex flex-wrap gap-2">
                          {builderSaveResult.nextActions.map((action) => (
                            <Link key={action.href} href={action.href} className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>
                              {action.label}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              )}

              {activeArea === 'packs' && reportPacks.length > 0 && (
                <div className="space-y-3">
                  {packResult && (
                    <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                      {packResult}
                    </div>
                  )}
                  {packApprovalResult && (
                    <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                      {packApprovalResult}
                    </div>
                  )}
                  {packRenderResult && (
                    <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                      {packRenderResult}
                    </div>
                  )}
                  {advancedReadiness?.packApprovalWorkflow && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading
                          title="Report-pack approval workflow"
                          subtitle={`${advancedReadiness.packApprovalWorkflow.activeWorkflowCount} active workflow(s), ${advancedReadiness.packApprovalWorkflow.pendingApprovalCount} pending approval(s).`}
                        />
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-4">
                        {advancedReadiness.packApprovalWorkflow.stages.map((stage) => (
                          <div key={stage.stage} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-semibold">{stage.stage}</div>
                              <Badge tone={toneForOperationalStatus(stage.status)}>{stage.status}</Badge>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {stage.evidence.slice(0, 3).map((item) => (
                                <Badge key={`${stage.stage}-${item}`} tone="blue">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                  {packApprovals && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <SectionHeading
                            title="Approval queue"
                            subtitle={`${packApprovals.total} report-pack approval request(s), ${packApprovals.summary.pending} pending action(s).`}
                          />
                          <Badge tone="green">{packApprovals.summary.readinessScore}% READY</Badge>
                        </div>
                      </div>
                      <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
                        {packApprovals.requests.length === 0 ? (
                          <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}>
                            No report-pack approval requests in the current scope.
                          </div>
                        ) : (
                          packApprovals.requests.map((request) => (
                            <div key={request.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold">{request.packName ?? request.requestTitle}</div>
                                  <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                                    {request.approvalRequestNumber} / {formatDateTime(request.submittedAt ?? undefined)}
                                  </div>
                                </div>
                                <Badge tone={toneForOperationalStatus(request.status)}>{request.status}</Badge>
                              </div>
                              <p className="mt-3 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                                {request.requestSummary ?? 'Report-pack approval request.'}
                              </p>
                              <div className="mt-3 grid gap-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                                <div>Snapshot: {request.statementRunNumber ?? request.entityId}</div>
                                <div className="break-all">Manifest: {request.manifestHash ?? '-'}</div>
                                <div>Requester: {request.requestedBy?.fullName ?? request.requestedBy?.email ?? '-'}</div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {request.approvalFlow.slice(0, 3).map((step) => (
                                  <Badge key={`${request.id}-${step}`} tone="blue">
                                    {step}
                                  </Badge>
                                ))}
                              </div>
                              {request.status === 'PENDING' && (
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => actOnPackApproval(request, 'APPROVE')}
                                    disabled={approvalDecisionAction === `${request.id}:APPROVE`}
                                    className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                                  >
                                    {approvalDecisionAction === `${request.id}:APPROVE` ? 'Approving...' : 'Approve'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => actOnPackApproval(request, 'REJECT')}
                                    disabled={approvalDecisionAction === `${request.id}:REJECT`}
                                    className="rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-60"
                                    style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                                  >
                                    {approvalDecisionAction === `${request.id}:REJECT` ? 'Rejecting...' : 'Reject'}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </Card>
                  )}
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {reportPacks.map((pack) => (
                      <div
                        key={pack.key}
                        className="rounded-lg border p-5"
                        style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold">{pack.name}</div>
                            <div className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                              {pack.owner} / {pack.cadence} / v{pack.templateVersion ?? '1.0.0'}
                            </div>
                          </div>
                          <Badge tone={toneForOperationalStatus(pack.status)}>{pack.status}</Badge>
                        </div>
                        <div className="mt-4 grid gap-2 md:grid-cols-4">
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              Readiness
                            </div>
                            <div className="mt-1 text-lg font-semibold">{pack.readinessScore ?? 90}%</div>
                          </div>
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              Snapshot
                            </div>
                            <div className="mt-1 break-words text-xs font-semibold">{pack.snapshotMode ?? 'FROZEN_MANIFEST'}</div>
                          </div>
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              Outputs
                            </div>
                            <div className="mt-1 text-xs font-semibold">{(pack.outputFormats ?? ['PDF', 'XLSX', 'JSON']).join(', ')}</div>
                          </div>
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              Retention
                            </div>
                            <div className="mt-1 text-xs font-semibold">{pack.retentionPolicy ?? 'Audit archive'}</div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                              Sections
                            </div>
                            <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                              {pack.sections.join(', ')}
                            </p>
                          </div>
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                              Prerequisites
                            </div>
                            <p className="mt-2 text-sm leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                              {pack.prerequisites.join(', ')}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                              Approval flow
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(pack.approvalFlow ?? ['Owner review', 'Approval', 'Lock']).map((step) => (
                                <Badge key={step} tone="blue">
                                  {step}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
                            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                              Snapshot controls
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(pack.snapshotChecklist ?? ['Filters locked', 'Manifest hash', 'Export audit']).map((item) => (
                                <Badge key={item} tone="green">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => generatePack(pack)}
                            disabled={generatingPack === pack.key}
                            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                          >
                            {generatingPack === pack.key ? 'Generating...' : 'Generate Snapshot'}
                          </button>
                          <Link
                            href={pack.href}
                            className="rounded-lg border px-3 py-2 text-sm font-medium"
                            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                          >
                            Open Source
                          </Link>
                          <button
                            type="button"
                            onClick={() => submitPackApproval(pack)}
                            disabled={packApprovalAction === pack.key}
                            className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60"
                            style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                          >
                            {packApprovalAction === pack.key ? 'Submitting...' : 'Submit Approval'}
                          </button>
                          {(['PDF', 'XLSX'] as const).map((format) => (
                            <button
                              key={`${pack.key}-${format}`}
                              type="button"
                              onClick={() => renderPack(pack, format)}
                              disabled={renderingPack === `${pack.key}:${format}`}
                              className="rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60"
                              style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}
                            >
                              {renderingPack === `${pack.key}:${format}` ? `Rendering ${format}...` : `Render ${format}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeArea === 'catalog' && (
                <div className="space-y-4">
                  {advancedReadiness?.semanticLayer && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading title="Enterprise semantic layer" subtitle="Business-ready datasets, governed measures, dimensions, security rules, and report relationships." />
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                        {advancedReadiness.semanticLayer.objects.map((object) => (
                          <div key={object.key} className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">{object.name}</div>
                                <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                                  {object.owner} / {object.refreshMode}
                                </div>
                              </div>
                              <Badge tone={badgeToneForSecurity(object.sensitivity as SecurityClassification)}>{object.sensitivity}</Badge>
                            </div>
                            <p className="mt-3 text-xs leading-5" style={{ color: 'var(--aurora-text-secondary)' }}>
                              Grain: {object.grain}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {object.measures.slice(0, 4).map((measure) => (
                                <Badge key={`${object.key}-${measure}`} tone="blue">
                                  {measure}
                                </Badge>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {object.relatedReports.slice(0, 3).map((report) => (
                                <Link key={report.id} href={report.href} className="text-xs text-brand-500 hover:underline">
                                  {report.name}
                                </Link>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="grid gap-3 border-t p-4 md:grid-cols-2" style={{ borderColor: 'var(--aurora-border)' }}>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                            Security rules
                          </div>
                          <div className="mt-2 grid gap-2">
                            {advancedReadiness.semanticLayer.securityRules.map((rule) => (
                              <div key={rule} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                                {rule}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>
                            Query rules
                          </div>
                          <div className="mt-2 grid gap-2">
                            {advancedReadiness.semanticLayer.queryRules.map((rule) => (
                              <div key={rule} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                                {rule}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  )}
                  {coverageMatrix.length > 0 && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading title="Coverage matrix" subtitle="Sector coverage by report type, certification, and sensitivity." />
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                            <tr>
                              <th className="px-4 py-3 text-left font-semibold">Sector</th>
                              <th className="px-4 py-3 text-left font-semibold">Total</th>
                              <th className="px-4 py-3 text-left font-semibold">Certified / official</th>
                              <th className="px-4 py-3 text-left font-semibold">Sensitive</th>
                              <th className="px-4 py-3 text-left font-semibold">Report types</th>
                            </tr>
                          </thead>
                          <tbody>
                            {coverageMatrix.map((row) => (
                              <tr key={row.sector} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                                <td className="px-4 py-3 font-medium">{SECTOR_LABELS[row.sector]}</td>
                                <td className="px-4 py-3">{row.total}</td>
                                <td className="px-4 py-3">{row.certifiedOrOfficial}</td>
                                <td className="px-4 py-3">{row.sensitiveOrRestricted}</td>
                                <td className="px-4 py-3" style={{ color: 'var(--aurora-text-secondary)' }}>
                                  {row.reportTypes
                                    .filter((item) => item.count > 0)
                                    .map((item) => `${REPORT_TYPE_LABELS[item.reportType]}: ${item.count}`)
                                    .join(', ')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}

                  <Card padding="none" className="overflow-hidden">
                    <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                      <SectionHeading title="Certified metric catalog" subtitle="Core business definitions that should remain consistent across reports." />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead style={{ background: 'var(--aurora-bg-subtle)' }}>
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">Metric</th>
                            <th className="px-4 py-3 text-left font-semibold">Definition</th>
                            <th className="px-4 py-3 text-left font-semibold">Owner</th>
                            <th className="px-4 py-3 text-left font-semibold">Valid dimensions</th>
                            <th className="px-4 py-3 text-left font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {metricRows.map((metric) => (
                            <tr key={metric.metric} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                              <td className="px-4 py-3 font-medium">{metric.metric}</td>
                              <td className="px-4 py-3" style={{ color: 'var(--aurora-text-secondary)' }}>
                                {metric.definition}
                              </td>
                              <td className="px-4 py-3" style={{ color: 'var(--aurora-text-secondary)' }}>
                                {metric.owner}
                              </td>
                              <td className="px-4 py-3" style={{ color: 'var(--aurora-text-secondary)' }}>
                                {formatList(metric.dimensions)}
                              </td>
                              <td className="px-4 py-3">
                                <Link className="text-brand-500 hover:underline" href={metric.href}>
                                  Open
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              )}

              {activeArea === 'governance' && (
                <div className="space-y-4">
                  {governanceResult && (
                    <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                      {governanceResult}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                    <Card>
                      <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        Governance readiness
                      </div>
                      <div className="mt-2 text-3xl font-semibold">{governance?.readinessScore ?? 90}%</div>
                      <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                        Lifecycle, lineage, quality, export, finance, and operations controls.
                      </p>
                    </Card>
                    <Card>
                      <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        Certified or official
                      </div>
                      <div className="mt-2 text-3xl font-semibold">{governance?.certified ?? certifiedCount}</div>
                      <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                        Reports users can treat as governed sources of truth.
                      </p>
                    </Card>
                    <Card>
                      <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        Validated
                      </div>
                      <div className="mt-2 text-3xl font-semibold">{governance?.validated ?? lifecycleCounts.VALIDATED ?? 0}</div>
                      <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                        Reports ready for use but still requiring certification.
                      </p>
                    </Card>
                    <Card>
                      <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        Restricted or sensitive
                      </div>
                      <div className="mt-2 text-3xl font-semibold">{governance?.restricted ?? sensitiveCount}</div>
                      <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                        Reports requiring careful role and export control.
                      </p>
                    </Card>
                    <Card>
                      <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                        Missing owners
                      </div>
                      <div className="mt-2 text-3xl font-semibold">{governance?.missingOwners ?? 0}</div>
                      <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                        Ownership gaps before formal publication.
                      </p>
                    </Card>
                  </div>
                  {governance?.controlMatrix && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading title="Control readiness matrix" subtitle="The controls targeted by this implementation slice." />
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-5">
                        {governance.controlMatrix.map((control) => (
                          <div key={control.control} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-sm font-semibold">{control.control}</div>
                            <div className="mt-2 text-2xl font-semibold">{control.readiness}%</div>
                            <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {control.owner}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                  {governance?.lifecycleControls && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading title="Lifecycle controls" subtitle="Governance transitions are recorded through the Reports audit trail." />
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-3">
                        {governance.lifecycleControls.map((control) => (
                          <div key={`${control.from}-${control.to}`} className="rounded-lg border p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold">
                                {control.from} {'->'} {control.to}
                              </div>
                              <Badge tone="blue">{control.action}</Badge>
                            </div>
                            <div className="mt-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {control.permission}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {control.requiredEvidence.map((item) => (
                                <Badge key={`${control.to}-${item}`} tone="green">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                  {governance?.rules && (
                    <Card>
                      <SectionHeading title="Governance rules" subtitle="Rules applied to certified, official, sensitive, and self-service reporting assets." />
                      <div className="mt-4 grid gap-2">
                        {governance.rules.map((rule) => (
                          <div key={rule} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            {rule}
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                  {governance?.certificationQueue && governance.certificationQueue.length > 0 && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading title="Certification queue" subtitle="Audit-record lifecycle actions without leaving the Reports command center." />
                      </div>
                      <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
                        {governance.certificationQueue.slice(0, 9).map((item) => (
                          <div key={item.reportId} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-sm font-semibold">{item.reportName}</div>
                            <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {SECTOR_LABELS[item.sector]} / {item.currentStatus}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1">
                              {item.evidence.map((evidence) => (
                                <Badge key={`${item.reportId}-${evidence}`} tone="blue">
                                  {evidence}
                                </Badge>
                              ))}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Link className="rounded-lg border px-3 py-2 text-xs font-medium" href={item.href} style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>
                                Review
                              </Link>
                              <button
                                type="button"
                                onClick={() => updateGovernanceLifecycle(item.reportId, item.recommendedNextStatus)}
                                disabled={governanceAction === `${item.reportId}:${item.recommendedNextStatus}`}
                                className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                              >
                                {governanceAction === `${item.reportId}:${item.recommendedNextStatus}`
                                  ? 'Recording...'
                                  : `Record ${item.recommendedNextStatus}`}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                  {readinessGaps.length > 0 && (
                    <Card padding="none" className="overflow-hidden">
                      <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                        <SectionHeading title="Readiness gap register" subtitle="Catalog records that still need governance metadata before final certification." />
                      </div>
                      <div className="grid gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
                        {readinessGaps.slice(0, 9).map((gap) => (
                          <div key={gap.reportId} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-sm font-semibold">{gap.reportName}</div>
                            <div className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {SECTOR_LABELS[gap.sector]}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1">
                              {gap.gaps.map((item) => (
                                <Badge key={`${gap.reportId}-${item}`} tone="amber">
                                  {item}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              )}

              {activeArea === 'admin' && (
                <Card padding="none" className="overflow-hidden">
                  <div className="border-b p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                    <SectionHeading title="Administration snapshot" subtitle="Current catalog distribution by report type and lifecycle status." />
                  </div>
                  <div className="grid gap-4 p-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm font-semibold">Report types</div>
                      {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                          <span style={{ color: 'var(--aurora-text-secondary)' }}>{label}</span>
                          <span className="font-semibold">{admin?.typeCounts[key] ?? typeCounts[key as ReportType] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-semibold">Lifecycle status</div>
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                          <span style={{ color: 'var(--aurora-text-secondary)' }}>{label}</span>
                          <span className="font-semibold">{admin?.lifecycleCounts[key] ?? lifecycleCounts[key as ReportLifecycleStatus] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {admin && (
                    <div className="border-t p-4" style={{ borderColor: 'var(--aurora-border)' }}>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                        {[
                          ['Definitions', admin.activeDefinitions],
                          ['Schedules', admin.activeSchedules],
                          ['Dashboards', admin.dashboards],
                          ['Statement runs', admin.statementRuns],
                          ['Failed runs', admin.failedRuns],
                        ].map(([label, value]) => (
                          <div key={String(label)} className="rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {label}
                            </div>
                            <div className="mt-1 text-xl font-semibold">{value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
