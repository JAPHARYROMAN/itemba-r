'use client';

/**
 * Coverage — what the agent can reach, and how much of it is actually proven.
 *
 * The report behind this screen exists for one reason, stated in its own
 * service: to stop a large capability manifest being mistaken for proven CRUD.
 * So the screen leads with the release gate and with what was EXECUTED, and puts
 * the manifest size last. Leading with "412 endpoints" would be flattering and
 * would defeat the report.
 *
 * Everything here is read-only. There is no action to take on this screen: it is
 * evidence, and the way to change it is to run the evidence harness, not to
 * press something in a browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { fetchMsaidiziCrudCoverage } from '@/lib/msaidizi-coverage-client';
import { CRUD_OPERATION_ORDER, humaniseBlockerCode } from '@/lib/msaidizi-coverage-types';
import type { CrudCoverageReport } from '@/lib/msaidizi-coverage-types';
import { InlineMessage, controlPlaneError } from './msaidizi-control-plane-detail-ui';

/** Both are required by the controller; the report names the whole agent surface. */
export const MSAIDIZI_USE_PERMISSION = 'msaidizi.use';
export const AUDIT_LOGS_READ_PERMISSION = 'audit-logs.read';

function percentage(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function Metric({
  value,
  label,
  hint,
  tone = 'neutral',
}: {
  value: string | number;
  label: string;
  hint?: string;
  tone?: 'neutral' | 'proven';
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-lg p-3"
      style={{
        background: 'var(--aurora-card)',
        border: '1px solid var(--aurora-border-subtle)',
      }}
    >
      <span
        className="text-xl font-semibold tabular-nums"
        style={{
          color: tone === 'proven' ? 'var(--aurora-success-text)' : 'var(--aurora-text)',
        }}
      >
        {value}
      </span>
      <span className="text-[11px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
        {label}
      </span>
      {hint ? (
        <span className="text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The gate is the headline, because it is the only line that answers "is this
 * ready". Its blockers are shown whether it passed or failed — an empty blocker
 * list under a pass is itself the evidence.
 */
function ReleaseGate({ report }: { report: CrudCoverageReport }) {
  const passed = report.releaseGate.status === 'passed';
  return (
    <section
      aria-label="Release gate"
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{
        background: passed ? 'var(--aurora-success-bg)' : 'var(--aurora-warning-subtle)',
        border: `1px solid ${passed ? 'var(--aurora-success)' : 'var(--aurora-warning)'}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3
          className="m-0 text-sm font-semibold"
          style={{ color: passed ? 'var(--aurora-success-text)' : 'var(--aurora-warning)' }}
        >
          {passed ? 'Release gate passed' : 'Release gate not passed'}
        </h3>
        <span className="text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
          Target: {report.releaseGate.target.replace(/_/g, ' ')}
        </span>
      </div>

      {report.releaseGate.blockers.length === 0 ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
          Nothing is blocking.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {report.releaseGate.blockers.map((blocker) => (
            <li
              key={blocker.code}
              className="flex items-baseline justify-between gap-3 text-[12px]"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              <span>{humaniseBlockerCode(blocker.code)}</span>
              <span className="font-mono tabular-nums">{blocker.count}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EvidenceArtifact({ report }: { report: CrudCoverageReport }) {
  const { executionEvidence } = report;
  const accepted = executionEvidence.status === 'accepted';

  return (
    <section
      aria-label="Execution evidence"
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{
        background: 'var(--aurora-card)',
        border: '1px solid var(--aurora-border-subtle)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Signed execution evidence
        </h3>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: accepted ? 'var(--aurora-success-text)' : 'var(--aurora-text-secondary)',
            background: accepted ? 'var(--aurora-success-bg)' : 'var(--aurora-bg-subtle)',
          }}
        >
          {accepted ? 'Accepted' : 'None accepted'}
        </span>
      </div>

      {accepted && executionEvidence.artifact ? (
        <dl
          className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
          style={{ gridTemplateColumns: 'auto 1fr', color: 'var(--aurora-text-muted)' }}
        >
          <dt>Run</dt>
          <dd className="m-0 font-mono">{executionEvidence.artifact.runId}</dd>
          <dt>Harness</dt>
          <dd className="m-0 font-mono">{executionEvidence.artifact.harnessVersion}</dd>
          <dt>Signing key</dt>
          <dd className="m-0 font-mono">{executionEvidence.artifact.keyId}</dd>
          <dt>Expires</dt>
          <dd className="m-0">{executionEvidence.artifact.expiresAt}</dd>
        </dl>
      ) : (
        <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
          {executionEvidence.detail ??
            'No signed artifact is configured here, so nothing on this page is backed by a recorded run. The counts below describe the manifest, not proof.'}
        </p>
      )}

      {Object.keys(executionEvidence.securityControls ?? {}).length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
          {Object.entries(executionEvidence.securityControls).map(([kind, control]) => (
            <li
              key={kind}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                color: control.passed ? 'var(--aurora-success-text)' : 'var(--aurora-danger-text)',
                background: control.passed ? 'var(--aurora-success-bg)' : 'var(--aurora-danger-bg)',
              }}
            >
              {kind.replace(/_/g, ' ')}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * Per-operation proof. A single bar per operation kind, showing verified
 * against included — the shape makes an unproven operation obvious in a way a
 * column of numbers does not.
 */
function OperationBreakdown({ report }: { report: CrudCoverageReport }) {
  const { includedByOperation, loopbackVerifiedByOperation } = report.summary;

  return (
    <section
      aria-label="Proof by operation"
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{
        background: 'var(--aurora-card)',
        border: '1px solid var(--aurora-border-subtle)',
      }}
    >
      <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
        Executed against included, by operation
      </h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {CRUD_OPERATION_ORDER.map((operation) => {
          const included = includedByOperation?.[operation] ?? 0;
          const verified = loopbackVerifiedByOperation?.[operation] ?? 0;
          const ratio = included > 0 ? Math.min(1, verified / included) : 0;
          return (
            <li key={operation} className="flex flex-col gap-1">
              <div
                className="flex items-baseline justify-between text-[11px]"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                <span className="font-medium capitalize">{operation}</span>
                <span className="font-mono tabular-nums">
                  {verified} / {included}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'var(--aurora-bg-subtle)' }}
                role="presentation"
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${ratio * 100}%`,
                    background: ratio > 0 ? 'var(--aurora-success)' : 'var(--aurora-border-strong)',
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function MsaidiziCoverageWorkspace() {
  const { hasPermission } = useAuth();
  const [report, setReport] = useState<CrudCoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadToken = useRef(0);

  const canRead =
    hasPermission(MSAIDIZI_USE_PERMISSION) && hasPermission(AUDIT_LOGS_READ_PERMISSION);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMsaidiziCrudCoverage();
      if (token !== loadToken.current) return;
      setReport(next);
    } catch (loadError) {
      if (token !== loadToken.current) return;
      setError(controlPlaneError(loadError, 'Try loading again.').message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void load();
  }, [canRead, load]);

  if (!canRead) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          The coverage report names every endpoint the assistant can reach, so reading it needs
          audit-log access as well as Msaidizi access.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="m-0 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
        What the assistant can reach, and how much of it has been proven by an actual recorded run.
        A large manifest is not coverage.
      </p>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error ? (
        <InlineMessage kind="error">{error}</InlineMessage>
      ) : report ? (
        <>
          <ReleaseGate report={report} />

          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(9rem,1fr))' }}
          >
            <Metric
              value={report.summary.loopbackVerified}
              label="Executed and verified"
              hint="observed doing what they claim"
              tone="proven"
            />
            <Metric
              value={percentage(report.summary.loopbackVerified, report.summary.included)}
              label="Of included capabilities"
              hint={`${report.summary.included} included`}
              tone="proven"
            />
            <Metric
              value={report.summary.passedPositiveFixtures}
              label="Positive fixtures passed"
              hint={`${report.summary.registeredPositiveFixtures} registered`}
            />
            <Metric
              value={report.summary.strictSchemas}
              label="Strict schemas"
              hint="request shape fully described"
            />
            <Metric
              value={report.summary.total}
              label="Endpoints in the router"
              hint={`${report.summary.excluded} excluded from the agent`}
            />
          </div>

          <OperationBreakdown report={report} />
          <EvidenceArtifact report={report} />

          <p className="m-0 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Generated {report.generatedAt} · {report.contract}
          </p>
        </>
      ) : null}
    </div>
  );
}
