'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Btn, FormSelect, PageHeader, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { RecordBrowser } from './record-browser';
import {
  approvalDestinations,
  controlIndicators,
  readinessLabel,
  readinessDetailLabel,
  type ApprovalReadiness,
  type ReadinessStatus,
} from './approval-overview-types';
import './workspace.css';
import './approval-overview.css';

function ReadinessState({ status }: { status: ReadinessStatus }) {
  return (
    <span className="approval-readiness-state" data-status={status}>
      {readinessLabel(status)}
    </span>
  );
}
function checkedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? 'Unavailable'
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
export function ApprovalOverview() {
  const { hasPermission } = useAuth();
  const canRead =
    hasPermission('approvals.dashboard.view') && hasPermission('approval_requests.view');
  const [companyId, setCompanyId] = useState('');
  const result = useWorkspaceResource<ApprovalReadiness>(
    '/approvals/requests/readiness',
    { companyId },
    canRead,
  );
  const companies = useWorkspaceChoices<{ id: string; name: string }>(
    '/companies',
    {},
    canRead && hasPermission('companies.read'),
  );
  if (!canRead)
    return (
      <PermissionDeniedState description="Your role needs approval overview and request-view access to read these checks." />
    );
  const data = result.data;
  const destinations = approvalDestinations.filter((d) => hasPermission(d.permission));
  const count = (value: number | undefined) =>
    value == null ? '—' : value.toLocaleString('en-GB');
  return (
    <div className="business-workspace approval-overview">
      <PageHeader
        title="Approvals"
        subtitle="Workflow health and the requests that need attention."
        actions={
          <Btn variant="secondary" onClick={result.reload} disabled={result.loading}>
            Refresh
          </Btn>
        }
      />
      <div className="approval-overview-scope">
        {hasPermission('companies.read') && (
          <FormSelect
            label="Company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder={companies.loading ? 'Loading companies…' : 'All accessible companies'}
            options={companies.rows.map((c) => ({ value: c.id, label: c.name }))}
            disabled={companies.loading || !!companies.error}
          />
        )}
        <p>
          Workflow and data quality checks for{' '}
          {companyId ? 'the selected company' : 'your accessible companies'}.
        </p>
      </div>
      {companies.error && (
        <div role="alert" className="workspace-notice">
          Company choices unavailable. {companies.error}
          <Btn variant="ghost" onClick={companies.retry}>
            Retry companies
          </Btn>
        </div>
      )}
      {result.loading ? (
        <div role="status" className="approval-overview-feedback">
          Loading approval overview…
        </div>
      ) : result.error ? (
        <div role="alert" className="approval-overview-feedback">
          <h2>Approval overview unavailable</h2>
          <p>{result.error}</p>
          <Btn variant="secondary" onClick={result.reload}>
            Try again
          </Btn>
        </div>
      ) : data ? (
        <>
          <section className="approval-readiness-summary" aria-label="Workflow readiness">
            <div className="approval-overview-heading">
              <h2>Workflow readiness</h2>
              <ReadinessState status={data.status} />
            </div>
            <p>{data.maturity}</p>
            <dl className="approval-overview-metrics">
              <div>
                <dt>Readiness score</dt>
                <dd>{data.score}%</dd>
              </div>
              <div>
                <dt>Active workflows</dt>
                <dd>{count(data.indicators.activeWorkflows)}</dd>
              </div>
              <div>
                <dt>Pending requests</dt>
                <dd>{count(data.indicators.pendingRequests)}</dd>
              </div>
              <div>
                <dt>Open data quality issues</dt>
                <dd>{count(data.indicators.openDataQualityIssues)}</dd>
              </div>
            </dl>
            <div className="approval-readiness-context">
              <span>Target {data.target}%</span>
              <span>Last checked {checkedAt(data.updatedAt)}</span>
            </div>
            <p className="approval-overview-caption">
              Readiness reflects these workflow checks. It does not approve a request.
            </p>
          </section>
          <RecordBrowser
            key={companyId}
            title="Readiness checks"
            records={data.checks.map((c) => ({ ...c, id: c.key }))}
            name={(c) => c.title}
            fields={[
              { label: 'Score', value: (c) => `${c.score}%` },
              { label: 'Status', value: (c) => <ReadinessState status={c.status} /> },
            ]}
            details={[
              { label: 'Finding', value: (c) => c.message },
              {
                label: 'Check details',
                value: (c) =>
                  Object.keys(c.details).length ? (
                    <ul className="approval-check-details">
                      {Object.entries(c.details).map(([label, value]) => (
                        <li key={label}>
                          <span>{readinessDetailLabel(label)}</span>
                          <strong>{typeof value === 'number' ? count(value) : value}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    'No additional details.'
                  ),
              },
            ]}
            empty="No readiness checks were returned for this scope."
          />
          <section className="approval-controls" aria-label="Control indicators">
            <h2>Control indicators</h2>
            <dl className="approval-overview-metrics">
              {controlIndicators.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{count(data.indicators[key])}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      ) : null}
      <nav aria-label="Approval workspaces" className="approval-overview-destinations">
        <h2>Your approval workspaces</h2>
        <div>
          {destinations.map((d) => (
            <Link key={d.href} href={d.href}>
              <span>
                <strong>{d.label}</strong>
                <small>{d.description}</small>
              </span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
