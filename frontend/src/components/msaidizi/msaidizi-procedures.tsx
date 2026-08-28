'use client';

/**
 * Saved procedures — author, review, approve, retire.
 *
 * The screen exists because the review step is the whole feature. A procedure
 * is invoked repeatedly, often by people who never saw it compiled, so the one
 * moment anybody looks at its capability list is the moment it is approved. The
 * layout is built around that: the instruction verbatim, and every capability a
 * run could reach, both in front of the approver before the button is.
 *
 * Three rules this component must not soften, all enforced server-side:
 *
 *   1. An author cannot approve their own procedure. The button is hidden for
 *      the author, and the 403 is still rendered plainly if it is ever reached —
 *      a maker-checker rule that only exists in the UI is not a rule.
 *   2. The approved capability list is a ceiling. Nothing here recompiles an
 *      existing procedure, because that would silently widen it.
 *   3. A run uses the invoker's permissions. The list is not a statement about
 *      what *this* reader may do, and the copy says so rather than implying a
 *      procedure carries authority with it.
 *
 * The instruction and every description are rendered as text. They are user
 * prose and provider-adjacent strings; nothing here is markup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  activateMsaidiziProcedure,
  archiveMsaidiziProcedure,
  compileMsaidiziProcedure,
  createMsaidiziProcedure,
  listMsaidiziProcedures,
} from '@/lib/msaidizi-procedures-client';
import type {
  MsaidiziCompiledProcedure,
  MsaidiziProcedure,
  MsaidiziProcedureStatus,
} from '@/lib/msaidizi-procedure-types';
import type { ReversibilityTier } from '@/lib/msaidizi-types';
import {
  CONTROL_INPUT_CLASS,
  CONTROL_INPUT_STYLE,
  ControlButton,
  ControlField,
  ControlStatus,
  InlineMessage,
  controlPlaneError,
  formatWhen,
} from './msaidizi-control-plane-detail-ui';

export const MSAIDIZI_PROCEDURES_MANAGE_PERMISSION = 'msaidizi.procedures.manage';
export const MSAIDIZI_PROCEDURES_APPROVE_PERMISSION = 'msaidizi.procedures.approve';

const TIER_COPY: Record<ReversibilityTier, { label: string; detail: string }> = {
  green: {
    label: 'Green',
    detail: 'Reads only. A run cannot change anything through this procedure.',
  },
  amber: {
    label: 'Amber',
    detail: 'Makes changes that can be undone by hand. No confirmation is asked for at run time.',
  },
  red: {
    label: 'Red',
    detail:
      'Makes changes that are not reversible. Each one is proposed and needs a person to confirm it before it runs.',
  },
};

function tierColor(tier: ReversibilityTier): string {
  if (tier === 'red') return 'var(--aurora-danger-text)';
  if (tier === 'amber') return 'var(--aurora-warning-text)';
  return 'var(--aurora-success-text)';
}

/** The blast radius, stated once and in the same words everywhere. */
function TierBadge({ tier }: { tier: ReversibilityTier }) {
  const copy = TIER_COPY[tier] ?? TIER_COPY.green;
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color: tierColor(tier), border: `1px solid ${tierColor(tier)}` }}
      title={copy.detail}
    >
      {copy.label}
    </span>
  );
}

/**
 * The capability list, which is the review material rather than a detail.
 * Ordered most-irreversible first: if a reviewer reads only the top of a long
 * list, it should be the part that can hurt.
 */
function CapabilityReview({
  preview,
  capabilities,
}: {
  preview?: MsaidiziCompiledProcedure['preview'];
  capabilities: string[];
}) {
  const rank: Record<ReversibilityTier, number> = { red: 0, amber: 1, green: 2 };
  const rows = useMemo(
    () => (preview ? [...preview].sort((a, b) => rank[a.tier] - rank[b.tier]) : null),
    // `rank` is a literal rebuilt each render; the sort depends only on preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview],
  );

  if (!rows) {
    // A stored procedure keeps names only. Showing them unadorned is honest:
    // re-resolving descriptions here would recompile against today's manifest
    // and could show a wider list than the one that was approved.
    return (
      <ul className="mt-2 space-y-1">
        {capabilities.map((tool) => (
          <li key={tool} className="text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            {tool}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-2 space-y-2">
      {rows.map((entry) => (
        <li
          key={entry.tool}
          className="rounded-lg p-2"
          style={{ border: '1px solid var(--aurora-border-subtle)' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
              {entry.tool}
            </span>
            <TierBadge tier={entry.tier} />
            <span className="text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
              {entry.path}
            </span>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            {entry.description}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Author flow: write the instruction, compile it, read what it resolved to,
 * then save. Compiling is deliberately its own step — the list is the thing
 * being agreed to, and a single "create" button would hide it.
 */
function ProcedureAuthor({ onCreated }: { onCreated: (procedure: MsaidiziProcedure) => void }) {
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [compiled, setCompiled] = useState<MsaidiziCompiledProcedure | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A compiled list belongs to the exact words that produced it. Editing the
  // instruction afterwards must drop it, or the author reviews one thing and
  // saves another.
  const changeInstruction = (value: string) => {
    setInstruction(value);
    setCompiled(null);
  };

  const compile = async () => {
    setBusy('compile');
    setError(null);
    try {
      setCompiled(await compileMsaidiziProcedure(instruction.trim()));
    } catch (compileError) {
      setCompiled(null);
      setError(controlPlaneError(compileError, 'Try compiling again.').message);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!compiled) return;
    setBusy('create');
    setError(null);
    try {
      const created = await createMsaidiziProcedure({
        name: name.trim(),
        instruction: instruction.trim(),
        capabilities: compiled.capabilities,
      });
      onCreated(created);
      setName('');
      setInstruction('');
      setCompiled(null);
    } catch (createError) {
      setError(controlPlaneError(createError, 'Try saving again.').message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="rounded-xl p-3"
      style={{ border: '1px solid var(--aurora-border-subtle)' }}
      aria-label="Write a procedure"
    >
      <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
        Write a procedure
      </h3>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
        Compile it to see exactly what a run would be allowed to do. Someone else approves it before
        it can be used.
      </p>

      <div className="mt-3 space-y-3">
        <ControlField label="Name">
          <input
            className={CONTROL_INPUT_CLASS}
            style={CONTROL_INPUT_STYLE}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
        </ControlField>
        <ControlField
          label="Instruction"
          hint="Name the records involved. The capability list is resolved from these words."
        >
          <textarea
            className={CONTROL_INPUT_CLASS}
            style={{ ...CONTROL_INPUT_STYLE, minHeight: '5rem' }}
            value={instruction}
            maxLength={4000}
            onChange={(event) => changeInstruction(event.target.value)}
          />
        </ControlField>

        <div className="flex flex-wrap items-center gap-2">
          <ControlButton
            onClick={compile}
            busy={busy === 'compile'}
            disabled={busy !== null || instruction.trim().length < 4}
          >
            Compile
          </ControlButton>
          <ControlButton
            onClick={create}
            busy={busy === 'create'}
            disabled={busy !== null || !compiled || name.trim().length < 2}
          >
            Save as draft
          </ControlButton>
        </div>

        {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}

        {compiled ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                {compiled.capabilities.length}{' '}
                {compiled.capabilities.length === 1 ? 'capability' : 'capabilities'}
              </span>
              <TierBadge tier={compiled.highestTier} />
            </div>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              {TIER_COPY[compiled.highestTier]?.detail}
            </p>
            <CapabilityReview preview={compiled.preview} capabilities={compiled.capabilities} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** One saved procedure, with whatever actions this reader is actually allowed. */
function ProcedureCard({
  procedure,
  currentUserId,
  canApprove,
  canManage,
  onChanged,
}: {
  procedure: MsaidiziProcedure;
  currentUserId: string | null;
  canApprove: boolean;
  canManage: boolean;
  onChanged: (procedure: MsaidiziProcedure) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Maker-checker, mirrored rather than invented: the server refuses the
  // author, so offering the button to them would only produce a 403.
  const isAuthor = currentUserId !== null && procedure.createdById === currentUserId;
  const approvable = procedure.status === 'DRAFT' && canApprove && !isAuthor;

  const act = async (label: string, action: () => Promise<MsaidiziProcedure>) => {
    setBusy(label);
    setError(null);
    try {
      onChanged(await action());
    } catch (actionError) {
      setError(controlPlaneError(actionError, 'Reload the list before trying again.').message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-xl p-3" style={{ border: '1px solid var(--aurora-border-subtle)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          {procedure.name}
        </span>
        <ControlStatus status={procedure.status} />
        <TierBadge tier={procedure.highestTier} />
      </div>

      <p
        className="mt-2 whitespace-pre-wrap text-[12px]"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {procedure.instruction}
      </p>

      <p className="mt-2 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
        {procedure.status === 'ACTIVE'
          ? `Approved ${formatWhen(procedure.approvedAt)}`
          : procedure.status === 'ARCHIVED'
            ? 'Retired. It cannot be reactivated.'
            : 'Not approved yet, so it cannot be run.'}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ControlButton onClick={() => setExpanded((open) => !open)} disabled={busy !== null}>
          {expanded ? 'Hide capabilities' : `Show ${procedure.capabilities.length} capabilities`}
        </ControlButton>
        {approvable ? (
          <ControlButton
            onClick={() => act('activate', () => activateMsaidiziProcedure(procedure.id))}
            busy={busy === 'activate'}
            disabled={busy !== null}
          >
            Approve
          </ControlButton>
        ) : null}
        {canManage && procedure.status !== 'ARCHIVED' ? (
          <ControlButton
            onClick={() => act('archive', () => archiveMsaidiziProcedure(procedure.id))}
            busy={busy === 'archive'}
            disabled={busy !== null}
            danger
          >
            Retire
          </ControlButton>
        ) : null}
      </div>

      {procedure.status === 'DRAFT' && isAuthor ? (
        <p className="mt-2 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
          You wrote this one, so somebody else has to approve it.
        </p>
      ) : null}

      {error ? (
        <div className="mt-2">
          <InlineMessage kind="error">{error}</InlineMessage>
        </div>
      ) : null}

      {expanded ? (
        <div className="mt-2">
          <p className="text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            What a run may call. Whoever runs it also needs these permissions themselves — a
            procedure is a saved instruction, not permission to do something new.
          </p>
          <CapabilityReview capabilities={procedure.capabilities} />
        </div>
      ) : null}
    </li>
  );
}

const STATUS_FILTERS: Array<{ id: MsaidiziProcedureStatus | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'DRAFT', label: 'Awaiting approval' },
  { id: 'ACTIVE', label: 'Approved' },
  { id: 'ARCHIVED', label: 'Retired' },
];

export function MsaidiziProceduresWorkspace() {
  const { user, hasPermission } = useAuth();
  const [procedures, setProcedures] = useState<MsaidiziProcedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MsaidiziProcedureStatus | 'ALL'>('ALL');
  const loadToken = useRef(0);

  const canManage = hasPermission(MSAIDIZI_PROCEDURES_MANAGE_PERMISSION);
  const canApprove = hasPermission(MSAIDIZI_PROCEDURES_APPROVE_PERMISSION);
  const currentUserId = user?.id ?? null;

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    try {
      const list = await listMsaidiziProcedures();
      if (token !== loadToken.current) return;
      setProcedures(list);
    } catch (loadError) {
      if (token !== loadToken.current) return;
      setError(controlPlaneError(loadError, 'Try loading again.').message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replace = useCallback((updated: MsaidiziProcedure) => {
    setProcedures((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }, []);

  const add = useCallback((created: MsaidiziProcedure) => {
    setProcedures((current) => [created, ...current].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const visible = useMemo(
    () => (filter === 'ALL' ? procedures : procedures.filter((entry) => entry.status === filter)),
    [procedures, filter],
  );

  const awaiting = procedures.filter((entry) => entry.status === 'DRAFT').length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {canManage ? <ProcedureAuthor onCreated={add} /> : null}

      <section aria-label="Saved procedures">
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
                {entry.id === 'DRAFT' && awaiting > 0 ? ` (${awaiting})` : ''}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error ? (
          <div className="mt-3">
            <InlineMessage kind="error">{error}</InlineMessage>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {procedures.length === 0
              ? 'No procedures yet. A procedure is a job taught once, reviewed once, then run by name.'
              : 'Nothing under this filter.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((procedure) => (
              <ProcedureCard
                key={procedure.id}
                procedure={procedure}
                currentUserId={currentUserId}
                canApprove={canApprove}
                canManage={canManage}
                onChanged={replace}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
