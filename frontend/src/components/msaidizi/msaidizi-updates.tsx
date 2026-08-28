'use client';

/**
 * Rollout — the self-update pipeline, as a person operates it.
 *
 * The update service shipped complete and had no UI: candidates could be listed,
 * advanced through rings and rolled back only by hand-rolling HTTP requests. The
 * decisions this screen exists for — advance to the next ring, or pull it back —
 * are exactly the ones a person is supposed to make deliberately, so leaving
 * them to curl meant the deliberation had no place to happen.
 *
 * Three server rules are mirrored here rather than reinvented, on the same
 * principle the procedures screen follows: a rule that lives only in the UI is
 * not a rule, so each is also allowed to fail loudly if it is reached anyway.
 *
 *   1. Rings are a progression. The only control offered is "advance to the next
 *      one", because 0 -> 5 -> 25 -> 100 is the order policy allows and a set of
 *      four buttons would imply otherwise.
 *   2. Armed automatic progression removes the manual choice. The API answers a
 *      manual rollout with 409 while armed; the button is withheld and the state
 *      is explained instead of being presented as a failure.
 *   3. Rollback exists only from CANARY or ACTIVE.
 *
 * What is deliberately NOT here: registering a candidate, which needs signed
 * artifact evidence from the release pipeline rather than a form, and submitting
 * an evaluation, whose endpoint answers 503 until signed evaluator attestations
 * exist. A control whose only outcome is an error teaches people to ignore
 * errors.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  listMsaidiziUpdateCandidates,
  rollbackMsaidiziUpdateCandidate,
  rolloutMsaidiziUpdateCandidate,
} from '@/lib/msaidizi-updates-client';
import {
  MSAIDIZI_ROLLOUT_RINGS,
  ROLLBACK_ELIGIBLE_STATUSES,
  ROLLOUT_ELIGIBLE_STATUSES,
  nextRolloutRing,
} from '@/lib/msaidizi-update-types';
import type {
  MsaidiziUpdateCandidate,
  MsaidiziUpdateCandidateStatus,
} from '@/lib/msaidizi-update-types';
import { InlineMessage, controlPlaneError } from './msaidizi-control-plane-detail-ui';
import { MsaidiziUpdateDetail } from './msaidizi-update-detail';

/**
 * Both permissions are required by the controller. `msaidizi.oversight` is
 * seeded to nobody, so an empty screen here is the expected state rather than a
 * fault — and saying so is the difference between a considered default and a
 * screen that looks broken.
 */
export const MSAIDIZI_USE_PERMISSION = 'msaidizi.use';
export const MSAIDIZI_OVERSIGHT_PERMISSION = 'msaidizi.oversight';

const STATUS_FILTERS: Array<{ id: MsaidiziUpdateCandidateStatus | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'CANARY', label: 'Canary' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'ROLLED_BACK', label: 'Rolled back' },
  { id: 'REJECTED', label: 'Rejected' },
];

/** Status colouring is semantic, and separate from the ring progression. */
function statusTone(status: MsaidiziUpdateCandidateStatus): {
  text: string;
  bg: string;
} {
  if (status === 'ACTIVE' || status === 'APPROVED') {
    return { text: 'var(--aurora-success-text)', bg: 'var(--aurora-success-bg)' };
  }
  if (status === 'CANARY' || status === 'EVALUATING') {
    return { text: 'var(--aurora-warning)', bg: 'var(--aurora-warning-subtle)' };
  }
  if (status === 'REJECTED' || status === 'FAILED' || status === 'ROLLED_BACK') {
    return { text: 'var(--aurora-danger-text)', bg: 'var(--aurora-danger-bg)' };
  }
  return { text: 'var(--aurora-text-secondary)', bg: 'var(--aurora-bg-subtle)' };
}

function shortDigest(value: string | null): string {
  return value ? `${value.slice(0, 12)}…` : 'not recorded';
}

/**
 * The ring progression, drawn as one. Reached rings are filled; the rest are
 * outlined. Numbering here is not decoration — the numbers are the share of
 * enrolled devices the candidate is on.
 */
function RingProgress({ ring }: { ring: number }) {
  return (
    <ol className="flex list-none items-center gap-1 p-0" aria-label={`Rollout ring ${ring}%`}>
      {MSAIDIZI_ROLLOUT_RINGS.map((step, index) => {
        const reached = ring >= step;
        return (
          <li key={step} className="flex items-center gap-1">
            {index > 0 ? (
              <span
                aria-hidden="true"
                className="h-px w-3"
                style={{ background: 'var(--aurora-border)' }}
              />
            ) : null}
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
              style={{
                color: reached ? 'var(--aurora-accent-text)' : 'var(--aurora-text-muted)',
                background: reached ? 'var(--aurora-accent-subtle)' : 'transparent',
                border: `1px solid ${reached ? 'var(--aurora-border-focus)' : 'var(--aurora-border-subtle)'}`,
              }}
            >
              {step}%
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CandidateRow({
  candidate,
  onChanged,
  selected,
  onSelect,
}: {
  candidate: MsaidiziUpdateCandidate;
  onChanged: (updated: MsaidiziUpdateCandidate) => void;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [busy, setBusy] = useState<null | 'rollout' | 'rollback'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRollback, setConfirmingRollback] = useState(false);

  const nextRing = nextRolloutRing(candidate.rolloutRing);
  const canRollout =
    ROLLOUT_ELIGIBLE_STATUSES.has(candidate.status) &&
    nextRing !== null &&
    !candidate.automaticProgressionEnabled;
  const canRollback = ROLLBACK_ELIGIBLE_STATUSES.has(candidate.status);
  const tone = statusTone(candidate.status);

  const act = useCallback(
    async (kind: 'rollout' | 'rollback') => {
      setBusy(kind);
      setError(null);
      try {
        const updated =
          kind === 'rollback'
            ? await rollbackMsaidiziUpdateCandidate(candidate.id)
            : await rolloutMsaidiziUpdateCandidate(candidate.id, { ring: nextRing! });
        onChanged(updated);
        setConfirmingRollback(false);
      } catch (actionError) {
        setError(
          controlPlaneError(actionError, 'Reload to see where the rollout actually got to.')
            .message,
        );
      } finally {
        setBusy(null);
      }
    },
    [candidate.id, nextRing, onChanged],
  );

  return (
    <article
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{
        background: 'var(--aurora-card)',
        border: `1px solid ${selected ? 'var(--aurora-border-focus)' : 'var(--aurora-border-subtle)'}`,
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="m-0 text-sm font-semibold">
            <button
              type="button"
              onClick={() => onSelect(candidate.id)}
              aria-expanded={selected}
              className="cursor-pointer bg-transparent p-0 text-sm font-semibold"
              style={{ color: 'var(--aurora-text)' }}
            >
              {candidate.name}
            </button>
          </h3>
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {candidate.version}
          </span>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: tone.text, background: tone.bg }}
        >
          {candidate.status.replace('_', ' ')}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <RingProgress ring={candidate.rolloutRing} />
        <span className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          {candidate.scope}
        </span>
      </div>

      {candidate.proposalRationale ? (
        <p className="m-0 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
          {candidate.proposalRationale}
        </p>
      ) : null}

      <dl
        className="m-0 grid gap-x-3 gap-y-1 text-[11px]"
        style={{ gridTemplateColumns: 'auto 1fr', color: 'var(--aurora-text-muted)' }}
      >
        <dt>Source</dt>
        <dd className="m-0 font-mono">{shortDigest(candidate.sourceArtifactSha256)}</dd>
        <dt>Rollback</dt>
        <dd className="m-0 font-mono">
          {candidate.rollbackVersion
            ? `${candidate.rollbackVersion} · ${shortDigest(candidate.rollbackArtifactSha256)}`
            : 'no rollback version — not eligible to deploy'}
        </dd>
      </dl>

      {candidate.automaticProgressionEnabled ? (
        <p
          className="m-0 rounded p-2 text-[11px]"
          style={{
            background: 'var(--aurora-info-bg)',
            color: 'var(--aurora-info-text)',
          }}
        >
          Automatic progression is armed, so rings advance on their own and manual rollout is
          unavailable. Rollback still works.
        </p>
      ) : null}

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

      {canRollout || canRollback ? (
        <div className="flex flex-wrap items-center gap-2">
          {canRollout ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act('rollout')}
              className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                color: 'var(--aurora-accent-text)',
                background: 'var(--aurora-accent-subtle)',
                border: '1px solid var(--aurora-border-focus)',
              }}
            >
              {busy === 'rollout' ? 'Advancing…' : `Advance to ${nextRing}%`}
            </button>
          ) : null}

          {canRollback && !confirmingRollback ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmingRollback(true)}
              className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                color: 'var(--aurora-danger-text)',
                background: 'transparent',
                border: '1px solid var(--aurora-border)',
              }}
            >
              Roll back
            </button>
          ) : null}

          {canRollback && confirmingRollback ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
                Return every device on {candidate.rolloutRing}% to{' '}
                {candidate.rollbackVersion ?? 'the previous version'}?
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act('rollback')}
                className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  color: 'var(--aurora-danger-text)',
                  background: 'var(--aurora-danger-bg)',
                  border: '1px solid var(--aurora-danger)',
                }}
              >
                {busy === 'rollback' ? 'Rolling back…' : 'Roll back now'}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmingRollback(false)}
                className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] disabled:cursor-not-allowed"
                style={{ color: 'var(--aurora-text-secondary)', background: 'transparent' }}
              >
                Keep it
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function MsaidiziUpdatesWorkspace({
  focusedCandidateId = null,
  onOpenTask,
}: {
  focusedCandidateId?: string | null;
  onOpenTask?: (taskId: string) => void;
} = {}) {
  const { hasPermission } = useAuth();
  const [candidates, setCandidates] = useState<MsaidiziUpdateCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MsaidiziUpdateCandidateStatus | 'ALL'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(focusedCandidateId);
  const loadToken = useRef(0);

  const canOversee =
    hasPermission(MSAIDIZI_USE_PERMISSION) && hasPermission(MSAIDIZI_OVERSIGHT_PERMISSION);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const list = await listMsaidiziUpdateCandidates();
      if (token !== loadToken.current) return;
      setCandidates(list);
    } catch (loadError) {
      if (token !== loadToken.current) return;
      setError(controlPlaneError(loadError, 'Try loading again.').message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canOversee) {
      setLoading(false);
      return;
    }
    void load();
  }, [canOversee, load]);

  const replace = useCallback((updated: MsaidiziUpdateCandidate) => {
    setCandidates((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }, []);

  const visible = useMemo(
    () => (filter === 'ALL' ? candidates : candidates.filter((entry) => entry.status === filter)),
    [candidates, filter],
  );

  // Not a permission error to render as a failure: nobody holds oversight by
  // default, so this is the designed state for almost every account.
  if (!canOversee) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <p className="m-0 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Advancing or rolling back a workstation update needs the Msaidizi oversight permission,
          which is granted to nobody by default. Ask an administrator if you are meant to hold it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <p className="m-0 text-xs" style={{ color: 'var(--aurora-text-secondary)' }}>
        Updates reach workstations one ring at a time. Advancing is a decision; rolling back is
        always available while a candidate is live.
      </p>

      <section aria-label="Update candidates">
        <div className="flex flex-wrap items-center gap-1">
          {STATUS_FILTERS.map((entry) => {
            const selected = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                aria-pressed={selected}
                className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-medium"
                style={{
                  color: selected ? 'var(--aurora-accent-text)' : 'var(--aurora-text-secondary)',
                  background: selected ? 'var(--aurora-accent-subtle)' : 'transparent',
                  border: `1px solid ${selected ? 'var(--aurora-border-focus)' : 'transparent'}`,
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div className="mt-3">
            <InlineMessage kind="error">{error}</InlineMessage>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {candidates.length === 0
              ? 'No update candidates. They are registered by the release pipeline from signed artifact evidence, never from this screen.'
              : 'Nothing under this filter.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((candidate) => (
              <li key={candidate.id} className="flex flex-col gap-2">
                <CandidateRow
                  candidate={candidate}
                  onChanged={replace}
                  selected={selectedId === candidate.id}
                  onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
                />
                {selectedId === candidate.id ? (
                  <div className="pl-3">
                    <MsaidiziUpdateDetail
                      candidateId={candidate.id}
                      onClose={() => setSelectedId(null)}
                      onOpenTask={onOpenTask}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
