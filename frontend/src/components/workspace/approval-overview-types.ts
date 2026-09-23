export type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';
export interface ReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}
export interface ApprovalReadiness {
  score: number;
  target: number;
  status: ReadinessStatus;
  maturity: string;
  updatedAt: string;
  indicators: Record<string, number>;
  checks: ReadinessCheck[];
}
export const approvalDestinations = [
  {
    label: 'Pending approvals',
    href: '/approvals/pending',
    description: 'Requests awaiting your review',
    permission: 'approval_requests.view',
  },
  {
    label: 'All requests',
    href: '/approvals/requests',
    description: 'Track requests and their progress',
    permission: 'approval_requests.view',
  },
  {
    label: 'Workflows',
    href: '/approvals/workflows',
    description: 'Steps and approval responsibilities',
    permission: 'approval_workflows.view',
  },
  {
    label: 'Delegations',
    href: '/approvals/delegations',
    description: 'Cover and continuity assignments',
    permission: 'approval_delegations.view',
  },
  {
    label: 'Tasks',
    href: '/tasks',
    description: 'Follow-up work and remediation',
    permission: 'tasks.view',
  },
];
export const controlIndicators = [
  ['workflowsWithoutSteps', 'Workflows without steps'],
  ['overduePendingRequests', 'Overdue requests'],
  ['actionTrailEntries', 'Action trail entries'],
  ['attachmentCount', 'Attachments'],
  ['activeDelegations', 'Active delegations'],
  ['criticalDataQualityIssues', 'Critical data quality issues'],
  ['highDataQualityIssues', 'High data quality issues'],
  ['staleOpenDataQualityIssues', 'Stale data quality issues'],
] as const;
export function readinessLabel(status: ReadinessStatus) {
  return status === 'READY' ? 'Ready' : status === 'WARNING' ? 'Needs review' : 'Action required';
}
export function readinessDetailLabel(value: string) {
  return value
    .replace(
      /([a-z0-9])([A-Z])/g,
      (_, first: string, second: string) => `${first} ${second.toLowerCase()}`,
    )
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
