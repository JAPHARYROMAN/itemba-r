'use client';

/**
 * One update candidate, in enough detail to decide about it.
 *
 * The list view answers "what is in flight". This answers the two questions the
 * list cannot, and both are ones an operator gets hurt by not knowing:
 *
 *   1. **Did the rollback actually land?** A rollback is a wave, not an instant.
 *      The supervisor commits a terminal result even when a device is
 *      unreachable, so a candidate can sit in FAILED with a rollback still owed
 *      to some of its devices. That state is invisible in a status pill, and it
 *      is exactly the state where someone concludes "I rolled it back" and stops
 *      looking. It is the headline here whenever it is true.
 *
 *   2. **Who is affected?** Per-device deployment rows are not exposed on this
 *      permission, but the frozen cohort is — captured under device row locks
 *      when progression was armed, so later enrolment cannot join a rollout
 *      already in flight. That answers the same question, and the fact that it
 *      is frozen is worth stating rather than leaving as a surprise.
 *
 * Timers are shown only when automatic progression is armed. Unarmed, every
 * dwell column is null, and a grid of dashes would imply the policy exists and
 * is empty rather than that it does not apply.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { fetchMsaidiziUpdateCandidate } from '@/lib/msaidizi-updates-client';
import {
  RETRYABLE_RECOVERY_ERROR_CODES,
  formatDwell,
  ringDwellSeconds,
} from '@/lib/msaidizi-update-types';
import type { MsaidiziUpdateCandidateDetail } from '@/lib/msaidizi-update-types';
import { InlineMessage, controlPlaneError } from './msaidizi-control-plane-detail-ui';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="m-0" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </dt>
      <dd className="m-0" style={{ color: 'var(--aurora-text-secondary)' }}>
        {children}
      </dd>
    </>
  );
}

function Panel({
  title,
  tone = 'plain',
  children,
}: {
  title: string;
  tone?: 'plain' | 'alarm' | 'notice';
  children: React.ReactNode;
}) {
  const background =
    tone === 'alarm'
      ? 'var(--aurora-danger-bg)'
      : tone === 'notice'
        ? 'var(--aurora-info-bg)'
        : 'var(--aurora-card)';
  const border =
    tone === 'alarm'
      ? 'var(--aurora-danger)'
      : tone === 'notice'
        ? 'var(--aurora-info)'
        : 'var(--aurora-border-subtle)';
  const heading =
    tone === 'alarm'
      ? 'var(--aurora-danger-text)'
      : tone === 'notice'
        ? 'var(--aurora-info-text)'
        : 'var(--aurora-text)';

  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{ background, border: `1px solid ${border}` }}
    >
      <h4 className="m-0 text-[12px] font-semibold" style={{ color: heading }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * The rollback wave. Shown whenever a rollback has been dispatched and not yet
 * proven everywhere — the counts are the difference between "rolled back" and
 * "asked to roll back".
 */
function RollbackWave({ candidate }: { candidate: MsaidiziUpdateCandidateDetail }) {
  const health = candidate.healthSummary;
  if (!health?.rollbackInProgress && !candidate.recoveryPending) return null;

  const required = health?.requiredRollbackDevices ?? 0;
  const remaining = health?.remainingRollbackDevices ?? 0;
  const unavailable = health?.unavailableRollbackDevices ?? 0;
  const done = Math.max(0, required - remaining);
  const retryable =
    candidate.recoveryLastErrorCode !== null &&
    RETRYABLE_RECOVERY_ERROR_CODES.has(candidate.recoveryLastErrorCode);

  return (
    <Panel title="Rollback has not finished" tone="alarm">
      <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
        {required > 0
          ? `${done} of ${required} devices are back on the previous version.`
          : 'A rollback is dispatched and not yet proven on every device.'}
        {unavailable > 0
          ? ` ${unavailable} could not be reached, so the rollback is still owed to them.`
          : ''}
      </p>

      {required > 0 ? (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--aurora-bg-subtle)' }}
          role="presentation"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, (done / required) * 100)}%`,
              background: 'var(--aurora-danger)',
            }}
          />
        </div>
      ) : null}

      <dl
        className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        {health?.queuedRollbackDeployments !== undefined ? (
          <Field label="Queued">{health.queuedRollbackDeployments}</Field>
        ) : null}
        {candidate.recoveryRequestedAt ? (
          <Field label="Requested">{candidate.recoveryRequestedAt}</Field>
        ) : null}
        {candidate.recoveryLastAttemptAt ? (
          <Field label="Last attempt">{candidate.recoveryLastAttemptAt}</Field>
        ) : null}
        {candidate.recoveryLastErrorCode ? (
          <Field label="Last error">
            <span className="font-mono">{candidate.recoveryLastErrorCode}</span>
          </Field>
        ) : null}
      </dl>

      {candidate.recoveryPending ? (
        <p className="m-0 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
          {retryable
            ? 'The server retries this on its own sweep. It is waiting, not stuck.'
            : 'This error is not retried automatically. It needs someone to look at it.'}
        </p>
      ) : null}
    </Panel>
  );
}

/** The frozen cohort. Only exists once progression has been armed. */
function Cohort({ candidate }: { candidate: MsaidiziUpdateCandidateDetail }) {
  const ids = candidate.automaticProgressionCohortDeviceIds;
  if (!ids || !candidate.automaticProgressionCohortCapturedAt) return null;

  return (
    <Panel title="Devices in this rollout">
      <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
        {ids.length} device{ids.length === 1 ? '' : 's'}, fixed when progression was armed. Anything
        enrolled since is not part of this rollout.
      </p>
      <dl
        className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <Field label="Captured">{candidate.automaticProgressionCohortCapturedAt}</Field>
        {candidate.automaticProgressionCohortSha256 ? (
          <Field label="Cohort digest">
            <span className="font-mono">
              {candidate.automaticProgressionCohortSha256.slice(0, 16)}…
            </span>
          </Field>
        ) : null}
      </dl>
    </Panel>
  );
}

/** Dwell and soak policy. Meaningful only while progression is armed. */
function ProgressionPolicy({ candidate }: { candidate: MsaidiziUpdateCandidateDetail }) {
  if (!candidate.automaticProgressionEnabled) return null;

  return (
    <Panel title="Automatic progression" tone="notice">
      <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-info-text)' }}>
        Rings advance on their own once each one has been healthy for its dwell.
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
        {ringDwellSeconds(candidate).map(({ ring, seconds }) => (
          <li
            key={ring}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
            style={{
              color: 'var(--aurora-text-secondary)',
              background: 'var(--aurora-bg-subtle)',
            }}
          >
            {ring}% · {formatDwell(seconds)}
          </li>
        ))}
      </ul>
      <dl
        className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <Field label="Minimum soak">
          {formatDwell(candidate.automaticProgressionMinimumSoakSeconds)}
        </Field>
        <Field label="Health timeout">
          {formatDwell(candidate.automaticProgressionHealthTimeoutSeconds)}
        </Field>
        {candidate.automaticProgressionRingHealthyAt ? (
          <Field label="Ring healthy since">{candidate.automaticProgressionRingHealthyAt}</Field>
        ) : null}
        {candidate.automaticProgressionArmedAt ? (
          <Field label="Armed">{candidate.automaticProgressionArmedAt}</Field>
        ) : null}
      </dl>
    </Panel>
  );
}

function Provenance({
  candidate,
  onOpenTask,
}: {
  candidate: MsaidiziUpdateCandidateDetail;
  onOpenTask?: (taskId: string) => void;
}) {
  return (
    <Panel title="Where this came from">
      <dl
        className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        <Field label="Proposed by">
          {candidate.proposedByTaskId ? (
            onOpenTask ? (
              <button
                type="button"
                onClick={() => onOpenTask(candidate.proposedByTaskId!)}
                className="cursor-pointer bg-transparent p-0 font-mono underline"
                style={{ color: 'var(--aurora-accent-text)' }}
              >
                {candidate.proposedByTaskId.slice(0, 8)}…
              </button>
            ) : (
              <span className="font-mono">{candidate.proposedByTaskId.slice(0, 8)}…</span>
            )
          ) : (
            'not recorded'
          )}
        </Field>
        {candidate.proposalRationale ? (
          <Field label="Rationale">{candidate.proposalRationale}</Field>
        ) : null}
        {candidate.evaluationDecidedAt ? (
          <Field label="Evaluated">{candidate.evaluationDecidedAt}</Field>
        ) : null}
        {candidate.deployedAt ? <Field label="Deployed">{candidate.deployedAt}</Field> : null}
        {candidate.rolledBackAt ? (
          <Field label="Rolled back">{candidate.rolledBackAt}</Field>
        ) : null}
      </dl>
    </Panel>
  );
}

function Digests({ candidate }: { candidate: MsaidiziUpdateCandidateDetail }) {
  const rows: Array<[string, string | null]> = [
    ['Source artifact', candidate.sourceArtifactSha256],
    ['Rollback artifact', candidate.rollbackArtifactSha256],
    ['Evaluation bundle', candidate.evaluationBundleDigest],
    ['Generation manifest', candidate.generationManifestSha256],
    ['Proposal', candidate.proposalDigest],
  ];
  const present = rows.filter(([, value]) => value);
  if (present.length === 0) return null;

  return (
    <Panel title="Digests">
      <dl
        className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
        style={{ gridTemplateColumns: 'auto 1fr' }}
      >
        {present.map(([label, value]) => (
          <Field key={label} label={label}>
            <span className="font-mono break-all">{value}</span>
          </Field>
        ))}
      </dl>
    </Panel>
  );
}

export function MsaidiziUpdateDetail({
  candidateId,
  onClose,
  onOpenTask,
}: {
  candidateId: string;
  onClose?: () => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const [candidate, setCandidate] = useState<MsaidiziUpdateCandidateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const next = (await fetchMsaidiziUpdateCandidate(
        candidateId,
      )) as MsaidiziUpdateCandidateDetail;
      if (token !== loadToken.current) return;
      setCandidate(next);
    } catch (loadError) {
      if (token !== loadToken.current) return;
      setError(controlPlaneError(loadError, 'Try loading it again.').message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {candidate ? `${candidate.name} ${candidate.version}` : 'Update candidate'}
        </h3>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer bg-transparent px-2 py-1 text-[11px]"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Close
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error ? (
        <InlineMessage kind="error">{error}</InlineMessage>
      ) : candidate ? (
        <div className="flex flex-col gap-2">
          <RollbackWave candidate={candidate} />
          <ProgressionPolicy candidate={candidate} />
          <Cohort candidate={candidate} />
          <Provenance candidate={candidate} onOpenTask={onOpenTask} />
          <Digests candidate={candidate} />
        </div>
      ) : null}
    </div>
  );
}
