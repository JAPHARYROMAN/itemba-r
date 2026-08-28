'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import {
  activateMsaidiziMandate,
  cancelMsaidiziTask,
  createMsaidiziMandate,
  createMsaidiziMemory,
  createMsaidiziPairingCode,
  createMsaidiziSchedule,
  createMsaidiziTaskDraft,
  createMsaidiziTask,
  disableMsaidiziAutopilot,
  enableMsaidiziAutopilot,
  fetchMsaidiziRecoveryCommand,
  fetchMsaidiziTask,
  fetchMsaidiziTaskEvents,
  getMsaidiziSafetyStatus,
  killAllMsaidiziDevices,
  killMsaidiziDevice,
  listMsaidiziMandates,
  listMsaidiziMemories,
  listMsaidiziDevices,
  listMsaidiziRecoveryCommands,
  listMsaidiziSchedules,
  listMsaidiziTasks,
  pauseMsaidiziTask,
  planMsaidiziTask,
  proposeMsaidiziTask,
  replanMsaidiziTask,
  resumeMsaidiziTask,
  revokeMsaidiziMandate,
  revokeMsaidiziDevice,
  requestMsaidiziRecoveryCommand,
  msaidiziArtifactDownloadUrl,
  suspendMsaidiziMandate,
  watchMsaidiziTaskEvents,
  type MsaidiziTaskEventTransport,
} from '@/lib/msaidizi-tasks-client';
import type {
  MsaidiziDevice,
  MsaidiziArtifact,
  MsaidiziHostAction,
  MsaidiziInputBinding,
  MsaidiziMandate,
  MsaidiziMemory,
  MsaidiziMemoryKind,
  MsaidiziPlanVersion,
  MsaidiziPairingCode,
  MsaidiziRecoveryCommand,
  MsaidiziSchedule,
  MsaidiziSafetyStatus,
  MsaidiziTask,
  MsaidiziTaskEffect,
  MsaidiziTaskEvent,
  MsaidiziTaskMode,
  MsaidiziTaskPlanStepInput,
  MsaidiziTaskProposal,
  MsaidiziTaskStep,
  MsaidiziTaskStatus,
  PlanMsaidiziTaskRequest,
  ReplanMsaidiziTaskRequest,
} from '@/lib/msaidizi-task-types';
import { displayTaskWallTime, formatTaskWallTime } from '@/lib/msaidizi-task-wall-time';
import { MsaidiziLocalDictationButton, MsaidiziTaskCapture } from './msaidizi-task-capture';
import { MsaidiziMemoryDetailPanel } from './msaidizi-memory-detail';
import { MsaidiziCoverageWorkspace } from './msaidizi-coverage';
import { MsaidiziProceduresWorkspace } from './msaidizi-procedures';
import { MsaidiziRoutineDetail } from './msaidizi-routine-detail';
import { MsaidiziUpdatesWorkspace } from './msaidizi-updates';

type MsaidiziWorkspace =
  | 'conversations'
  | 'tasks'
  | 'routines'
  | 'procedures'
  | 'devices'
  | 'memory'
  | 'rollout'
  | 'coverage';

export const MSAIDIZI_WORKSPACES: Array<{ id: MsaidiziWorkspace; label: string }> = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'routines', label: 'Routines' },
  { id: 'procedures', label: 'Procedures' },
  { id: 'devices', label: 'Devices' },
  { id: 'memory', label: 'Memory' },
  { id: 'rollout', label: 'Rollout' },
  { id: 'coverage', label: 'Coverage' },
];

const MODE_COPY: Record<MsaidiziTaskMode, { label: string; detail: string }> = {
  ASK: {
    label: 'Ask',
    detail:
      'Creates a reviewable task record, but does not infer permission to continue unattended.',
  },
  COLLABORATIVE: {
    label: 'Work with me',
    detail: 'Msaidizi follows the reviewed plan while you remain in control of its next actions.',
  },
  AUTOPILOT: {
    label: 'Autopilot',
    detail:
      'Requires an active mandate and deployment enablement. This mode is selected explicitly, never inferred from your words.',
  },
};

const STATUS_STYLE: Record<MsaidiziTaskStatus, { color: string; background: string }> = {
  PLANNING: { color: 'var(--aurora-info-text)', background: 'var(--aurora-info-bg)' },
  READY: { color: 'var(--aurora-info-text)', background: 'var(--aurora-info-bg)' },
  QUEUED: { color: 'var(--aurora-info-text)', background: 'var(--aurora-info-bg)' },
  RUNNING: { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' },
  PAUSING: { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' },
  PAUSED: { color: 'var(--aurora-text-secondary)', background: 'var(--aurora-bg-muted)' },
  CANCELLING: { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' },
  COMPLETED: { color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' },
  PARTIAL: { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' },
  FAILED: { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' },
  CANCELLED: { color: 'var(--aurora-text-secondary)', background: 'var(--aurora-bg-muted)' },
  NEEDS_ATTENTION: { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' },
};

const TERMINAL_TASK_STATUSES = new Set<MsaidiziTaskStatus>([
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
  'NEEDS_ATTENTION',
]);

const REPLANNABLE_TASK_STATUSES = new Set<MsaidiziTaskStatus>([
  'READY',
  'PAUSED',
  'PARTIAL',
  'FAILED',
  'NEEDS_ATTENTION',
]);

const PROPOSAL_BUDGET_LABELS: Record<string, string> = {
  maxWallTimeSeconds: 'Wall time',
  maxModelTurns: 'Model turns',
  maxAttemptedToolCalls: 'Tool attempts',
  maxMutations: 'Mutations',
  maxLocalBytes: 'Local I/O',
  maxExternalEgressBytes: 'External egress',
  maxModelCostUsd: 'Model spend',
};

function isTerminalTask(task: MsaidiziTask): boolean {
  return TERMINAL_TASK_STATUSES.has(task.status);
}

function isReplannableTask(task: MsaidiziTask): boolean {
  return (
    REPLANNABLE_TASK_STATUSES.has(task.status) &&
    task.mutations === 0 &&
    !(task.toolAttempts ?? []).some((attempt) => attempt.uncertainOutcome) &&
    !(task.hostActions ?? []).some((action) => action.uncertainOutcome)
  );
}

function proposalBudgetValue(key: string, value: number | undefined): string {
  if (value === undefined) return 'Not declared';
  if (key === 'maxLocalBytes' || key === 'maxExternalEgressBytes') {
    return formatBytes(String(value));
  }
  if (key === 'maxModelCostUsd') return `$${value}`;
  if (key === 'maxWallTimeSeconds') return `${value}s`;
  return String(value);
}

function compactJson(value: unknown): string {
  const rendered = JSON.stringify(value);
  if (!rendered) return 'None declared';
  return rendered.length > 240 ? `${rendered.slice(0, 237)}…` : rendered;
}

function bindingSourceLabel(binding: MsaidiziInputBinding): string {
  if (binding.source.kind === 'PLAN_INPUT') return `plan input ${binding.source.path || '/'}`;
  if (binding.source.kind === 'SECRET_REFERENCE') {
    return `scoped reference ${binding.source.secretReferenceSha256?.slice(0, 12) ?? 'digest unavailable'}…`;
  }
  return `${binding.source.dependencyStepKey ?? 'dependency'} · ${binding.source.kind
    .replace('DEPENDENCY_', '')
    .toLowerCase()}`;
}

function replanStepInput(step: MsaidiziTaskStep): MsaidiziTaskPlanStepInput {
  return {
    key: step.stepKey,
    name: step.name,
    target: step.target,
    capability: step.capability,
    capabilityVersion: step.capabilityVersion,
    arguments: step.arguments,
    dependsOn: step.dependencies,
    inputBindings: step.inputBindings ?? [],
    expectedEffect: step.expectedEffect,
    dataClass: step.dataClass,
    preconditions: step.preconditions,
    recovery: step.recovery,
    budgets: step.budgets,
    stopConditions: step.stopConditions,
    idempotent: step.idempotent,
    mutation: step.mutation,
  };
}

interface TaskSnapshotRefresh {
  taskId: string;
  token: symbol;
  pending: boolean;
}

function replaceTask(tasks: MsaidiziTask[], next: MsaidiziTask): MsaidiziTask[] {
  const index = tasks.findIndex((task) => task.id === next.id);
  if (index < 0) return [next, ...tasks];
  return tasks.map((task) => (task.id === next.id ? next : task));
}

const TASK_EVENT_CURSOR = /^(0|[1-9]\d*)$/;

function laterCursor(left: string, right: string): string {
  if (!TASK_EVENT_CURSOR.test(left)) return right;
  if (!TASK_EVENT_CURSOR.test(right)) return left;
  return BigInt(left) >= BigInt(right) ? left : right;
}

function mergeTaskEvents(
  taskId: string,
  current: MsaidiziTaskEvent[],
  incoming: MsaidiziTaskEvent[],
): MsaidiziTaskEvent[] {
  const events = new Map<string, MsaidiziTaskEvent>();
  for (const event of [...current, ...incoming]) {
    if (event.taskId === taskId && TASK_EVENT_CURSOR.test(event.cursor)) {
      events.set(event.cursor, event);
    }
  }
  return [...events.values()].sort((left, right) => {
    const leftCursor = BigInt(left.cursor);
    const rightCursor = BigInt(right.cursor);
    return leftCursor < rightCursor ? -1 : leftCursor > rightCursor ? 1 : 0;
  });
}

function formatBytes(value: string): string {
  try {
    const bytes = BigInt(value);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unit = 0;
    let whole = bytes;
    while (whole >= 1024n && unit < units.length - 1) {
      whole /= 1024n;
      unit += 1;
    }
    return `${whole.toString()} ${units[unit]}`;
  } catch {
    return value;
  }
}

function formatWhen(value: string | null): string {
  if (!value) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

function statusLabel(status: string): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function asError(error: unknown): string {
  return error instanceof Error ? error.message : 'The task request could not be completed.';
}

interface MsaidiziTaskPlannerProps {
  draftTask: MsaidiziTask | null;
  onTaskChanged: (task: MsaidiziTask) => void;
  onDraftArtifactUploaded: (taskId: string) => void;
}

function MsaidiziProposalReviewCard({ proposal }: { proposal: MsaidiziTaskProposal }) {
  const plan = proposal.plan;
  const devices = proposal.provenance.deviceIds ?? [];
  const dataClasses = Array.from(new Set(plan.steps.map((step) => step.dataClass)));
  const externalSteps = plan.steps.filter(
    (step) => step.expectedEffect === 'EXTERNAL' || step.expectedEffect === 'IRREVERSIBLE',
  );
  const mutationSteps = plan.steps.filter((step) => step.mutation);
  const boundSteps = plan.steps.filter((step) => (step.inputBindings?.length ?? 0) > 0);
  const policy = proposal.policy;
  const critique = proposal.critique;
  const outcome = proposal.outcome;

  return (
    <section
      aria-label="Generated proposal review"
      className="space-y-4 rounded-xl p-4"
      style={{ background: 'var(--aurora-bg)', border: '1px solid var(--aurora-border-focus)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Governed proposal review
          </h3>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Review this generated scope before saving. Saving still does not queue or execute it.
          </p>
        </div>
        <span
          className="rounded-full px-2 py-1 text-[10px] font-semibold"
          style={{ color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' }}
        >
          Policy {policy?.allowed ? 'allowed' : 'not cleared'} · Critic{' '}
          {critique?.acceptable ? 'accepted' : 'not cleared'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="proposal-scope-heading">
          <h4
            id="proposal-scope-heading"
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Scope and devices
          </h4>
          <dl className="mt-2 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
            <dt style={{ color: 'var(--aurora-text-muted)' }}>Mode</dt>
            <dd style={{ color: 'var(--aurora-text)' }}>{MODE_COPY[plan.mode].label}</dd>
            <dt style={{ color: 'var(--aurora-text-muted)' }}>Company scope</dt>
            <dd style={{ color: 'var(--aurora-text)' }}>
              {plan.companyId ? `Company ${plan.companyId}` : 'Current permission-filtered scope'}
            </dd>
            <dt style={{ color: 'var(--aurora-text-muted)' }}>Mandate</dt>
            <dd className="break-all" style={{ color: 'var(--aurora-text)' }}>
              {plan.mandateId ?? 'No unattended mandate'}
            </dd>
            <dt style={{ color: 'var(--aurora-text-muted)' }}>Data classes</dt>
            <dd style={{ color: 'var(--aurora-text)' }}>
              {dataClasses.length > 0 ? dataClasses.join(', ') : 'None declared'}
            </dd>
            <dt style={{ color: 'var(--aurora-text-muted)' }}>Devices</dt>
            <dd className="break-all" style={{ color: 'var(--aurora-text)' }}>
              {devices.length > 0 ? devices.join(', ') : 'No device selected'}
            </dd>
          </dl>
          <p className="mt-2 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {proposal.provenance.callerPermissionFiltered
              ? 'Capabilities were filtered to the caller before planning.'
              : 'Caller permission filtering was not attested.'}
          </p>
        </section>

        <section aria-labelledby="proposal-budget-heading">
          <h4
            id="proposal-budget-heading"
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Proposed hard budgets
          </h4>
          <dl className="mt-2 grid grid-cols-2 gap-2">
            {Object.entries(PROPOSAL_BUDGET_LABELS).map(([key, label]) => (
              <div
                key={key}
                className="rounded-lg p-2"
                style={{ background: 'var(--aurora-bg-muted)' }}
              >
                <dt className="text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  {label}
                </dt>
                <dd className="text-[11px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                  {proposalBudgetValue(key, plan.budgets?.[key as keyof typeof plan.budgets])}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="proposal-risk-heading">
          <h4
            id="proposal-risk-heading"
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Risks and expected external actions
          </h4>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text)' }}>
            Highest risk: {statusLabel(outcome?.highestRisk ?? 'READ')} ·{' '}
            {outcome?.mutationCount ?? mutationSteps.length} mutation(s) ·{' '}
            {outcome?.irreversibleActionCount ?? 0} irreversible
          </p>
          {externalSteps.length > 0 ? (
            <ul className="mt-2 space-y-1" aria-label="Expected external actions">
              {externalSteps.map((step) => (
                <li key={step.key} className="text-[11px]" style={{ color: 'var(--aurora-text)' }}>
                  {step.name} · {statusLabel(step.expectedEffect)} · {step.capability}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              No external or irreversible action is expected.
            </p>
          )}
          <p className="mt-2 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Stop conditions: {compactJson(plan.stopConditions ?? {})}
          </p>
        </section>

        <section aria-labelledby="proposal-recovery-heading">
          <h4
            id="proposal-recovery-heading"
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Recovery strategy
          </h4>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text)' }}>
            Recovery coverage: {Math.round((outcome?.recoveryCoverage ?? 0) * 100)}%
          </p>
          {mutationSteps.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {mutationSteps.map((step) => (
                <li key={step.key} className="text-[11px]" style={{ color: 'var(--aurora-text)' }}>
                  {step.name}: {compactJson(step.recovery)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              No mutation requires recovery.
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="proposal-dataflow-heading">
        <h4
          id="proposal-dataflow-heading"
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Immutable dataflow bindings
        </h4>
        {boundSteps.length > 0 ? (
          <ul className="mt-2 space-y-1" aria-label="Immutable dataflow bindings">
            {boundSteps.flatMap((step) =>
              (step.inputBindings ?? []).map((binding) => (
                <li
                  key={`${step.key}:${binding.targetPath}`}
                  className="text-[11px]"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  {step.name} · {binding.targetPath} ← {bindingSourceLabel(binding)} ·{' '}
                  {binding.expectedType} · {binding.transform.name} v{binding.transform.version}
                </li>
              )),
            )}
          </ul>
        ) : (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            No inter-step or scoped-reference values are bound into this proposal.
          </p>
        )}
        <p className="mt-2 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Bound content remains data, never instruction authority. Scoped credentials are shown by
          digest only.
        </p>
      </section>

      <section aria-labelledby="proposal-governance-heading">
        <h4
          id="proposal-governance-heading"
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Policy and critic outcome
        </h4>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text)' }}>
          Policy checks: {policy?.checks?.length ? policy.checks.join(', ') : 'No checks reported'}
        </p>
        {policy?.violations?.length ? (
          <ul className="mt-1 space-y-1">
            {policy.violations.map((violation) => (
              <li
                key={`${violation.code}:${violation.stepKey ?? ''}`}
                className="text-[11px]"
                style={{ color: 'var(--aurora-danger-text)' }}
              >
                {violation.code}: {violation.message}
              </li>
            ))}
          </ul>
        ) : null}
        {critique?.issues?.length ? (
          <ul className="mt-2 space-y-1" aria-label="Critic findings">
            {critique.issues.map((issue) => (
              <li
                key={`${issue.code}:${issue.stepKey ?? ''}`}
                className="text-[11px]"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                {statusLabel(issue.severity)} · {issue.code}: {issue.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            The critic reported no findings.
          </p>
        )}
      </section>
    </section>
  );
}

function MsaidiziTaskPlanner({
  draftTask,
  onTaskChanged,
  onDraftArtifactUploaded,
}: MsaidiziTaskPlannerProps) {
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [mode, setMode] = useState<MsaidiziTaskMode>('COLLABORATIVE');
  const [mandateId, setMandateId] = useState('');
  const [stepsJson, setStepsJson] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposalNotice, setProposalNotice] = useState<string | null>(null);
  const [generatedProposal, setGeneratedProposal] = useState<MsaidiziTaskProposal | null>(null);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [draftArtifacts, setDraftArtifacts] = useState<MsaidiziArtifact[]>([]);
  const hydratedDraftIdRef = useRef<string | null>(null);

  const discardGeneratedProposal = () => {
    setGeneratedProposal(null);
    setProposalNotice(null);
  };

  useEffect(() => {
    if (!draftTask) {
      hydratedDraftIdRef.current = null;
      setDraftArtifacts([]);
      setSelectedArtifactIds([]);
      return;
    }
    const artifacts = draftTask.artifacts ?? [];
    setDraftArtifacts(artifacts);
    setSelectedArtifactIds((current) => {
      const available = new Set(artifacts.map((artifact) => artifact.id));
      const retained = current.filter((id) => available.has(id));
      return retained.length > 0 ? retained : artifacts.map((artifact) => artifact.id);
    });
    if (hydratedDraftIdRef.current === draftTask.id) return;
    hydratedDraftIdRef.current = draftTask.id;
    setTitle(draftTask.title);
    setObjective(draftTask.objective);
    setMode(draftTask.mode);
    setMandateId(draftTask.mandateId ?? '');
    setGeneratedProposal(null);
    setProposalNotice(null);
    setStepsJson('[]');
  }, [draftTask]);

  const persistDraft = async (): Promise<MsaidiziTask> => {
    if (!objective.trim()) {
      throw new Error('Enter an objective before starting a governed draft.');
    }
    const created = await createMsaidiziTaskDraft({
      objective: objective.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
      mode,
      ...(mandateId.trim() ? { mandateId: mandateId.trim() } : {}),
    });
    if (created.status !== 'PLANNING' || created.activePlanVersion !== 0) {
      throw new Error('The server did not return a non-executable PLANNING draft.');
    }
    setTitle(created.title);
    setObjective(created.objective);
    setMode(created.mode);
    setMandateId(created.mandateId ?? '');
    setDraftArtifacts(created.artifacts ?? []);
    setSelectedArtifactIds((created.artifacts ?? []).map((artifact) => artifact.id));
    onTaskChanged(created);
    return created;
  };

  const startDraft = async () => {
    if (draftTask) return;
    setBusy(true);
    setError(null);
    try {
      await persistDraft();
      setProposalNotice(
        'Governed draft created. Attachments now belong to this exact task and remain untrusted data.',
      );
    } catch (draftError) {
      setError(asError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    if (!objective.trim()) {
      setError('Enter an objective before generating a governed proposal.');
      return;
    }
    setBusy(true);
    setError(null);
    setProposalNotice(null);
    try {
      const draft = draftTask ?? (await persistDraft());
      const proposal = await proposeMsaidiziTask({
        taskId: draft.id,
        objective: draft.objective,
        mode: draft.mode,
        ...(title.trim() ? { titleHint: title.trim() } : {}),
        ...(draft.companyId ? { companyId: draft.companyId } : {}),
        ...(draft.mandateId ? { mandateId: draft.mandateId } : {}),
        ...(selectedArtifactIds.length > 0 ? { artifactIds: selectedArtifactIds } : {}),
        inputs: {},
        stopConditions: {},
      });
      if (
        proposal.draftTaskId !== draft.id ||
        proposal.plan.taskId !== draft.id ||
        proposal.plan.mode !== draft.mode
      ) {
        throw new Error('The proposal did not preserve the explicitly selected execution mode.');
      }
      setTitle(proposal.plan.title);
      setStepsJson(JSON.stringify(proposal.plan.steps, null, 2));
      setGeneratedProposal(proposal);
      setProposalNotice(
        `Governed proposal ${proposal.proposalDigest.slice(0, 12)}… generated for draft ${draft.id.slice(0, 8)}. Its model usage is reserved in a one-use receipt until ${new Date(proposal.proposalUsageReceipt.expiresAt).toLocaleString()}; the plan is not attached, queued, or executed.`,
      );
    } catch (proposalError) {
      setError(asError(proposalError));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setProposalNotice(null);
    const taskId = generatedProposal?.draftTaskId ?? draftTask?.id ?? null;
    if (!taskId) {
      setError('Start a governed draft before attaching a reviewed plan.');
      return;
    }
    let steps: MsaidiziTaskPlanStepInput[];
    try {
      const parsed: unknown = JSON.parse(stepsJson);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Add at least one typed plan step before saving this plan.');
      }
      steps = parsed as MsaidiziTaskPlanStepInput[];
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Plan steps must be valid JSON.');
      return;
    }

    const requestCompanyId = generatedProposal?.plan.companyId ?? draftTask?.companyId ?? null;
    const requestMandateId = generatedProposal?.plan.mandateId ?? draftTask?.mandateId ?? null;
    const request: PlanMsaidiziTaskRequest = {
      taskId,
      title: title.trim(),
      objective: generatedProposal?.plan.objective ?? draftTask?.objective ?? objective.trim(),
      mode: generatedProposal?.plan.mode ?? draftTask?.mode ?? mode,
      ...(generatedProposal?.plan.summary ? { summary: generatedProposal.plan.summary } : {}),
      ...(requestCompanyId ? { companyId: requestCompanyId } : {}),
      ...(requestMandateId ? { mandateId: requestMandateId } : {}),
      ...(generatedProposal
        ? {
            proposalUsageId: generatedProposal.proposalUsageReceipt.id,
            proposalDigest: generatedProposal.proposalDigest,
            inputs: generatedProposal.plan.inputs ?? {},
            stopConditions: generatedProposal.plan.stopConditions ?? {},
            budgets: generatedProposal.plan.budgets,
          }
        : {}),
      steps,
    };

    setBusy(true);
    try {
      const task = await planMsaidiziTask(request);
      if (task.id !== taskId || task.status !== 'READY' || task.activePlanVersion !== 1) {
        throw new Error('The reviewed plan was not attached to the exact task draft.');
      }
      onTaskChanged(task);
      setTitle('');
      setObjective('');
      setMandateId('');
      setStepsJson('[]');
      setGeneratedProposal(null);
      setDraftArtifacts([]);
      setSelectedArtifactIds([]);
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label="Create durable task plan"
      onSubmit={submit}
      className="space-y-3 rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
    >
      <div>
        <h2 className="text-[14px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Review a task plan
        </h2>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Saving creates an immutable plan. Queuing it is a separate action; neither choice is
          inferred from the objective.
        </p>
      </div>

      <label
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        Task title
        <input
          required
          value={title}
          onChange={(event) => {
            discardGeneratedProposal();
            setTitle(event.target.value);
          }}
          maxLength={160}
          className="mt-1 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{
            background: 'var(--aurora-bg)',
            border: '1px solid var(--aurora-border)',
            color: 'var(--aurora-text)',
          }}
        />
      </label>

      <label
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        Objective
        <textarea
          required
          disabled={Boolean(draftTask)}
          value={objective}
          onChange={(event) => {
            discardGeneratedProposal();
            setObjective(event.target.value);
          }}
          maxLength={8000}
          rows={3}
          className="mt-1 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{
            background: 'var(--aurora-bg)',
            border: '1px solid var(--aurora-border)',
            color: 'var(--aurora-text)',
          }}
        />
      </label>
      <MsaidiziLocalDictationButton
        disabled={busy || Boolean(draftTask)}
        onTranscript={(transcript) => {
          discardGeneratedProposal();
          setObjective((current) =>
            current.trim() ? `${current.trim()} ${transcript}` : transcript,
          );
        }}
      />

      {draftTask ? (
        <div
          role="status"
          className="rounded-lg p-3 text-[11px]"
          style={{ color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' }}
        >
          Draft {draftTask.id.slice(0, 8)} is the durable owner for this text, local dictation, and
          every attachment. It has no executable plan yet.
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || !objective.trim()}
          onClick={() => void startDraft()}
          className="cursor-pointer rounded-lg px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          Start governed draft for attachments
        </button>
      )}

      {draftTask ? (
        <MsaidiziTaskCapture
          taskId={draftTask.id}
          spokenSummary={`${draftTask.title}. Status planning. ${draftTask.objective}`}
          onUploaded={(artifact) => {
            discardGeneratedProposal();
            setDraftArtifacts((current) => [...current, artifact]);
            setSelectedArtifactIds((current) => [...current, artifact.id]);
            onDraftArtifactUploaded(draftTask.id);
          }}
        />
      ) : null}

      {draftArtifacts.length > 0 ? (
        <fieldset
          className="rounded-lg p-3"
          style={{ background: 'var(--aurora-bg)', border: '1px solid var(--aurora-border)' }}
        >
          <legend
            className="px-1 text-[12px] font-medium"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            Untrusted multimodal context owned by this draft
          </legend>
          <p className="mb-2 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Artifacts remain untrusted and can feed only pre-reviewed typed bindings when the target
            capability schema and mandate allow that effect. They never create or authorize task
            steps.
          </p>
          <div className="space-y-2">
            {draftArtifacts.map((artifact) => (
              <label
                key={artifact.id}
                className="flex items-center gap-2 text-[11px]"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedArtifactIds.includes(artifact.id)}
                  onChange={(event) => {
                    discardGeneratedProposal();
                    setSelectedArtifactIds((current) =>
                      event.target.checked
                        ? [...current, artifact.id]
                        : current.filter((id) => id !== artifact.id),
                    );
                  }}
                />
                <span>
                  {artifact.name} · {statusLabel(artifact.kind)} · forced untrusted for reasoning
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset>
        <legend
          className="text-[12px] font-medium"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Execution mode
        </legend>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {(Object.keys(MODE_COPY) as MsaidiziTaskMode[]).map((candidate) => {
            const selected = mode === candidate;
            return (
              <label
                key={candidate}
                className="cursor-pointer rounded-lg p-3"
                style={{
                  background: selected ? 'var(--aurora-accent-subtle)' : 'var(--aurora-bg)',
                  border: `1px solid ${selected ? 'var(--aurora-border-focus)' : 'var(--aurora-border)'}`,
                }}
              >
                <input
                  type="radio"
                  disabled={Boolean(draftTask)}
                  name="msaidizi-task-mode"
                  value={candidate}
                  checked={selected}
                  onChange={() => {
                    discardGeneratedProposal();
                    setMode(candidate);
                  }}
                  className="sr-only"
                />
                <span
                  className="block text-[13px] font-semibold"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  {MODE_COPY[candidate].label}
                </span>
                <span
                  className="mt-1 block text-[11px]"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  {MODE_COPY[candidate].detail}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {mode === 'AUTOPILOT' && (
        <label
          className="block text-[12px] font-medium"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Active mandate ID
          <input
            required
            disabled={Boolean(draftTask)}
            value={mandateId}
            onChange={(event) => {
              discardGeneratedProposal();
              setMandateId(event.target.value);
            }}
            placeholder="Required for Autopilot"
            className="mt-1 w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: 'var(--aurora-bg)',
              border: '1px solid var(--aurora-border)',
              color: 'var(--aurora-text)',
            }}
          />
        </label>
      )}

      <label
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        Typed plan steps (JSON)
        <textarea
          aria-describedby="msaidizi-steps-help"
          value={stepsJson}
          onChange={(event) => {
            discardGeneratedProposal();
            setStepsJson(event.target.value);
          }}
          rows={7}
          spellCheck={false}
          className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-[12px] outline-none"
          style={{
            background: 'var(--aurora-bg)',
            border: '1px solid var(--aurora-border)',
            color: 'var(--aurora-text)',
          }}
        />
        <span
          id="msaidizi-steps-help"
          className="mt-1 block text-[11px]"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          Each step must name a permitted capability, effect, data class, arguments, dependencies
          and recovery plan. This UI never invents host or ERP actions from free text.
        </span>
      </label>

      {generatedProposal ? <MsaidiziProposalReviewCard proposal={generatedProposal} /> : null}

      {error && (
        <p role="alert" className="text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
          {error}
        </p>
      )}
      {proposalNotice ? (
        <p role="status" className="text-[12px]" style={{ color: 'var(--aurora-success-text)' }}>
          {proposalNotice}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton busy={busy} disabled={!objective.trim()} onClick={() => void propose()}>
          Generate governed proposal
        </ActionButton>
        <button
          type="submit"
          disabled={busy || (!draftTask && !generatedProposal)}
          className="cursor-pointer rounded-lg px-3 py-2 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          {busy ? 'Working…' : 'Save reviewed plan'}
        </button>
      </div>
    </form>
  );
}

function MsaidiziTaskChip({ status }: { status: MsaidiziTaskStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={style}>
      {statusLabel(status)}
    </span>
  );
}

function MsaidiziTaskList({
  tasks,
  selectedId,
  onSelect,
  loading,
  error,
  onRetry,
}: {
  tasks: MsaidiziTask[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && tasks.length === 0) {
    return (
      <div className="space-y-3 p-3" aria-busy="true">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No durable tasks"
        description="Save a reviewed plan to create a task. Queuing is always a separate, deliberate action."
      />
    );
  }
  return (
    <ul className="space-y-1 p-2" aria-label="Durable tasks">
      {tasks.map((task) => {
        const selected = task.id === selectedId;
        return (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => onSelect(task.id)}
              aria-current={selected ? 'true' : undefined}
              className="w-full cursor-pointer rounded-lg px-3 py-2 text-left"
              style={{
                background: selected ? 'var(--aurora-accent-subtle)' : 'transparent',
                border: `1px solid ${selected ? 'var(--aurora-border-focus)' : 'transparent'}`,
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-[13px] font-medium"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  {task.title}
                </span>
                <MsaidiziTaskChip status={task.status} />
              </span>
              <span
                className="mt-1 block truncate text-[11px]"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                {MODE_COPY[task.mode].label} · {formatWhen(task.updatedAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Meter({
  label,
  used,
  limit,
}: {
  label: string;
  used: string | number;
  limit: string | number;
}) {
  return (
    <div>
      <dt className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </dt>
      <dd className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
        {String(used)} / {String(limit)}
      </dd>
    </div>
  );
}

function shortIdentifier(value: string | null, length = 12): string {
  if (!value) return 'Not recorded';
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function auditHref(input: { taskId?: string; stepId?: string; deviceId?: string }): string {
  const query = new URLSearchParams();
  if (input.taskId) query.set('taskId', input.taskId);
  if (input.stepId) query.set('stepId', input.stepId);
  if (input.deviceId) query.set('deviceId', input.deviceId);
  return `/audit-logs?${query.toString()}`;
}

function journalReconciliation(actions: MsaidiziHostAction[], action: MsaidiziHostAction): string {
  if (!action.journalHash) return 'No terminal device journal receipt yet.';
  if (
    !action.journalPrepareHash ||
    !action.journalPreparePreviousHash ||
    !action.journalPreviousHash
  ) {
    return 'Journal receipt is incomplete; central/device ledger review is required.';
  }
  if (action.journalPreviousHash !== action.journalPrepareHash) {
    return 'Terminal receipt does not follow its prepared record; central/device ledger review is required.';
  }
  const predecessor = actions.find(
    (candidate) =>
      candidate.deviceId === action.deviceId &&
      candidate.journalHash === action.journalPreparePreviousHash,
  );
  return predecessor
    ? 'Prepared and terminal journal links reconcile with the prior action in this task.'
    : 'Prepared → terminal is linked; its earlier device head is outside this task evidence.';
}

function MsaidiziTaskOperationalEvidence({ task }: { task: MsaidiziTask }) {
  const attempts = task.toolAttempts ?? [];
  const artifacts = task.artifacts ?? [];
  const leases = task.deviceLeases ?? [];
  const actions = task.hostActions ?? [];

  return (
    <div className="space-y-4">
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Tool attempts and retries
          </h3>
          <a
            href={auditHref({ taskId: task.id })}
            className="text-[11px] font-medium underline"
            style={{ color: 'var(--aurora-accent-text)' }}
          >
            Open task audit trail
          </a>
        </div>
        {attempts.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            No tool dispatch has been attempted.
          </p>
        ) : (
          <ol className="mt-3 space-y-2" aria-label="Tool attempts">
            {attempts.map((attempt) => (
              <li
                key={attempt.id}
                className="rounded-lg p-3"
                style={{ background: 'var(--aurora-bg-muted)' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                    Attempt {attempt.attemptNumber}
                    {attempt.attemptNumber > 1 ? ' · retry' : ''} · {attempt.toolName}
                  </p>
                  <ControlPlaneStatus status={attempt.status} />
                </div>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  Started {formatWhen(attempt.startedAt)} · ended {formatWhen(attempt.endedAt)}
                </p>
                {attempt.rejectionReason || attempt.errorCode || attempt.errorMessage ? (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-danger-text)' }}>
                    {attempt.rejectionReason ?? attempt.errorCode ?? attempt.errorMessage}
                  </p>
                ) : null}
                {attempt.uncertainOutcome ? (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-warning-text)' }}>
                    Outcome uncertain — no automatic retry is safe.
                  </p>
                ) : null}
                <a
                  href={auditHref({ taskId: task.id, stepId: attempt.stepId })}
                  className="mt-1 inline-block text-[10px] underline"
                  style={{ color: 'var(--aurora-accent-text)' }}
                >
                  Step audit evidence
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Artifacts
        </h3>
        {artifacts.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            No file, screenshot, report, audio, or document artifact is attached.
          </p>
        ) : (
          <ul className="mt-3 space-y-2" aria-label="Task artifacts">
            {artifacts.map((artifact) => (
              <li
                key={artifact.id}
                className="rounded-lg p-3"
                style={{ background: 'var(--aurora-bg-muted)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                      {artifact.name}
                    </p>
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                      {statusLabel(artifact.kind)} · {artifact.mimeType} ·{' '}
                      {formatBytes(artifact.byteSize)} · {artifact.dataClass} ·{' '}
                      {statusLabel(artifact.trustLevel)}
                    </p>
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                      SHA-256 {shortIdentifier(artifact.sha256, 18)} · provenance fields:{' '}
                      {Object.keys(artifact.provenance).join(', ') || 'none'}
                    </p>
                  </div>
                  <a
                    href={msaidiziArtifactDownloadUrl(artifact.id)}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium underline"
                    style={{ color: 'var(--aurora-accent-text)' }}
                  >
                    Download artifact
                  </a>
                </div>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  Download is authenticated and counts against this task&apos;s I/O and egress
                  budgets.
                </p>
                {artifact.stepId ? (
                  <a
                    href={auditHref({ taskId: task.id, stepId: artifact.stepId })}
                    className="mt-1 inline-block text-[10px] underline"
                    style={{ color: 'var(--aurora-accent-text)' }}
                  >
                    Artifact step audit evidence
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Device leases and host journal
        </h3>
        {leases.length === 0 && actions.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            No device lease or host action has been created. No device action is implied by opening
            this task.
          </p>
        ) : null}
        {leases.length > 0 ? (
          <ul className="mt-3 space-y-2" aria-label="Device leases">
            {leases.map((lease) => (
              <li
                key={lease.id}
                className="rounded-lg p-3"
                style={{ background: 'var(--aurora-bg-muted)' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                    {lease.device.name} · fence {lease.fencingToken}
                  </p>
                  <ControlPlaneStatus status={lease.status} />
                </div>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  Device {statusLabel(lease.device.status)} · heartbeat{' '}
                  {formatWhen(lease.heartbeatAt)} · expires {formatWhen(lease.expiresAt)}
                </p>
                <a
                  href={auditHref({
                    taskId: task.id,
                    stepId: lease.stepId ?? undefined,
                    deviceId: lease.deviceId,
                  })}
                  className="mt-1 inline-block text-[10px] underline"
                  style={{ color: 'var(--aurora-accent-text)' }}
                >
                  Device/task audit evidence
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {actions.length > 0 ? (
          <ol className="mt-3 space-y-2" aria-label="Host actions">
            {actions.map((action) => (
              <li
                key={action.id}
                className="rounded-lg p-3"
                style={{ background: 'var(--aurora-bg-muted)' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                    {action.capability} v{action.capabilityVersion}
                  </p>
                  <ControlPlaneStatus status={action.status} />
                </div>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  {action.effect} · {action.dataClass} · consent {action.consent} · recovery{' '}
                  {action.recovery}
                </p>
                <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  Action {shortIdentifier(action.actionId)} · args{' '}
                  {shortIdentifier(action.argsDigest)}
                  {' · '}idempotency {shortIdentifier(action.idempotencyKey)}
                </p>
                <p
                  className="mt-1 text-[11px]"
                  style={{
                    color: action.uncertainOutcome
                      ? 'var(--aurora-danger-text)'
                      : 'var(--aurora-text-secondary)',
                  }}
                >
                  {journalReconciliation(actions, action)}
                </p>
                {action.errorCode ? (
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-danger-text)' }}>
                    {action.errorCode}
                  </p>
                ) : null}
                <a
                  href={auditHref({
                    taskId: task.id,
                    stepId: action.stepId,
                    deviceId: action.deviceId,
                  })}
                  className="mt-1 inline-block text-[10px] underline"
                  style={{ color: 'var(--aurora-accent-text)' }}
                >
                  Reconcile in audit trail
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </div>
  );
}

function MsaidiziTaskReplanForm({
  task,
  plan,
  busy,
  onReplan,
  onClose,
}: {
  task: MsaidiziTask;
  plan: MsaidiziPlanVersion;
  busy: boolean;
  onReplan: (request: ReplanMsaidiziTaskRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState(plan.summary);
  const [objective, setObjective] = useState(plan.objective || task.objective);
  const [inputsJson, setInputsJson] = useState(JSON.stringify(plan.inputs ?? {}, null, 2));
  const [stopConditionsJson, setStopConditionsJson] = useState(
    JSON.stringify(plan.stopConditions ?? {}, null, 2),
  );
  const [stepsJson, setStepsJson] = useState(
    JSON.stringify(plan.steps.map(replanStepInput), null, 2),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const parsedSteps: unknown = JSON.parse(stepsJson);
      if (!Array.isArray(parsedSteps) || parsedSteps.length === 0) {
        throw new Error('A replan must contain at least one typed step.');
      }
      const saved = await onReplan({
        summary: summary.trim(),
        objective: objective.trim(),
        inputs: parseJsonObject(inputsJson, 'Replan inputs'),
        stopConditions: parseJsonObject(stopConditionsJson, 'Replan stop conditions'),
        steps: parsedSteps as MsaidiziTaskPlanStepInput[],
      });
      if (saved) onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'The replacement plan is invalid.',
      );
    }
  };

  return (
    <form
      aria-label="Replan durable task"
      onSubmit={submit}
      className="space-y-3 rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border-focus)' }}
    >
      <div>
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Create plan version {task.activePlanVersion + 1}
        </h3>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Replanning keeps the explicit {MODE_COPY[task.mode].label} mode and the task&apos;s hard
          ceilings. Saving returns the task to Ready; it does not queue or execute work.
        </p>
      </div>

      <label
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        Replan summary
        <input
          required
          maxLength={2000}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          className="mt-1 w-full rounded-lg px-3 py-2 text-[12px] outline-none"
          style={CONTROL_INPUT_STYLE}
        />
      </label>
      <label
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        Replan objective
        <textarea
          required
          maxLength={8000}
          rows={3}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          className="mt-1 w-full rounded-lg px-3 py-2 text-[12px] outline-none"
          style={CONTROL_INPUT_STYLE}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label
          className="block text-[12px] font-medium"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Replan inputs (JSON)
          <textarea
            rows={4}
            spellCheck={false}
            value={inputsJson}
            onChange={(event) => setInputsJson(event.target.value)}
            className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-[11px] outline-none"
            style={CONTROL_INPUT_STYLE}
          />
        </label>
        <label
          className="block text-[12px] font-medium"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          Replan stop conditions (JSON)
          <textarea
            rows={4}
            spellCheck={false}
            value={stopConditionsJson}
            onChange={(event) => setStopConditionsJson(event.target.value)}
            className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-[11px] outline-none"
            style={CONTROL_INPUT_STYLE}
          />
        </label>
      </div>
      <label
        className="block text-[12px] font-medium"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        Replan typed steps (JSON)
        <textarea
          rows={9}
          spellCheck={false}
          value={stepsJson}
          onChange={(event) => setStepsJson(event.target.value)}
          className="mt-1 w-full rounded-lg px-3 py-2 font-mono text-[11px] outline-none"
          style={CONTROL_INPUT_STYLE}
        />
      </label>
      {error ? (
        <p role="alert" className="text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton type="submit" busy={busy} disabled={!summary.trim() || !objective.trim()}>
          Save new plan version
        </ActionButton>
        <ActionButton busy={false} disabled={busy} onClick={onClose}>
          Keep current plan
        </ActionButton>
      </div>
    </form>
  );
}

function useTaskWallTime(task: MsaidiziTask) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (task.wallTimeCheckpointAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [task.id, task.wallTimeCheckpointAt]);
  return displayTaskWallTime(task, now);
}

function MsaidiziTaskDetail({
  task,
  events,
  eventTransport,
  eventCursor,
  actionBusy,
  actionError,
  onAction,
  onReplan,
  onArtifactUploaded,
}: {
  task: MsaidiziTask;
  events: MsaidiziTaskEvent[];
  eventTransport: MsaidiziTaskEventTransport | 'connecting' | null;
  eventCursor: string;
  actionBusy: string | null;
  actionError: string | null;
  onAction: (
    action: 'create' | 'pause' | 'resume' | 'cancel',
    oneShotConsentStepIds?: string[],
  ) => void;
  onReplan: (request: ReplanMsaidiziTaskRequest) => Promise<boolean>;
  onArtifactUploaded: () => void;
}) {
  const [replanOpen, setReplanOpen] = useState(false);
  const wallTime = useTaskWallTime(task);
  const elapsedWallTime =
    wallTime.valid && wallTime.elapsedMs !== null
      ? formatTaskWallTime(wallTime.elapsedMs)
      : 'Unavailable';
  const wallTimeCeiling = formatTaskWallTime(wallTime.ceilingMs);
  const plan =
    task.planVersions?.find((version) => version.version === task.activePlanVersion) ?? null;
  const currentStep =
    plan?.steps.find((step) => ['LEASED', 'RUNNING', 'NEEDS_ATTENTION'].includes(step.status)) ??
    null;
  const timelineConnection = isTerminalTask(task)
    ? `Recorded timeline · latest cursor ${eventCursor}`
    : eventTransport === 'stream'
      ? `Live stream · cursor ${eventCursor}`
      : eventTransport === 'polling'
        ? `Polling fallback · cursor ${eventCursor}`
        : `Connecting · resume after cursor ${eventCursor}`;
  const localSpeechSteps =
    plan?.steps.filter(
      (step) => step.target === 'HOST' && step.capability === 'speech.audio.transcribe',
    ) ?? [];
  const [localSpeechConsent, setLocalSpeechConsent] = useState<Set<string>>(new Set());
  useEffect(() => setLocalSpeechConsent(new Set()), [plan?.id]);
  const allLocalSpeechConsented = localSpeechSteps.every((step) => localSpeechConsent.has(step.id));
  const canQueue = task.status === 'READY';
  const canPause = task.status === 'QUEUED' || task.status === 'RUNNING';
  const canResume = task.status === 'PAUSED';
  const canReplan = Boolean(plan) && isReplannableTask(task);
  const canCancel = [
    'PLANNING',
    'READY',
    'QUEUED',
    'RUNNING',
    'PAUSING',
    'PAUSED',
    'NEEDS_ATTENTION',
  ].includes(task.status);

  return (
    <section aria-label="Task detail" className="min-w-0 space-y-4">
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {task.title}
              </h2>
              <MsaidiziTaskChip status={task.status} />
            </div>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--aurora-text-secondary)' }}>
              {task.objective}
            </p>
          </div>
          <span
            className="rounded-full px-2 py-1 text-[11px] font-medium"
            style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text-secondary)' }}
          >
            {MODE_COPY[task.mode].label}
          </span>
        </div>
        {task.statusDetail && (
          <p className="mt-3 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {task.statusDetail}
          </p>
        )}
        {task.failureCode && (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
            Failure code: {task.failureCode}
          </p>
        )}

        <dl className="mt-3 grid gap-1 text-[11px] sm:grid-cols-[7rem_minmax(0,1fr)]">
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Current step</dt>
          <dd style={{ color: 'var(--aurora-text-secondary)' }}>
            {currentStep
              ? `${currentStep.sequence}. ${currentStep.name} · ${statusLabel(currentStep.status)}`
              : `No active step reported · task ${statusLabel(task.status)}`}
          </dd>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Last checkpoint</dt>
          <dd style={{ color: 'var(--aurora-text-secondary)' }}>
            {formatWhen(task.lastCheckpointAt)}
          </dd>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Elapsed wall time</dt>
          <dd style={{ color: 'var(--aurora-text-secondary)' }}>
            {elapsedWallTime} of {wallTimeCeiling}
          </dd>
        </dl>

        {canQueue && localSpeechSteps.length > 0 ? (
          <fieldset
            className="mt-4 rounded-lg p-3"
            style={{ border: '1px solid var(--aurora-warning-border)' }}
          >
            <legend
              className="px-1 text-[12px] font-semibold"
              style={{ color: 'var(--aurora-warning-text)' }}
            >
              One-use microphone consent
            </legend>
            <p className="mb-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              Audio stays on this device. Only a secret-scrubbed, untrusted transcript and bound
              digests may leave it; transcript text cannot authorize any side effect.
            </p>
            <div className="space-y-2">
              {localSpeechSteps.map((step) => (
                <label
                  key={step.id}
                  className="flex items-start gap-2 text-[12px]"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  <input
                    type="checkbox"
                    checked={localSpeechConsent.has(step.id)}
                    disabled={actionBusy !== null}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setLocalSpeechConsent((current) => {
                        const next = new Set(current);
                        if (checked) next.add(step.id);
                        else next.delete(step.id);
                        return next;
                      });
                    }}
                  />
                  <span>Allow one local microphone capture for “{step.name}”</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {canQueue && (
            <ActionButton
              busy={actionBusy === 'create'}
              disabled={!allLocalSpeechConsented}
              onClick={() =>
                onAction(
                  'create',
                  localSpeechSteps.map((step) => step.id),
                )
              }
            >
              Queue reviewed plan
            </ActionButton>
          )}
          {canReplan && (
            <ActionButton
              busy={actionBusy === 'replan'}
              onClick={() => setReplanOpen((current) => !current)}
            >
              {replanOpen ? 'Close replan editor' : 'Replan reviewed task'}
            </ActionButton>
          )}
          {canPause && (
            <ActionButton busy={actionBusy === 'pause'} onClick={() => onAction('pause')}>
              {task.status === 'RUNNING' ? 'Pause after current step' : 'Pause queued work'}
            </ActionButton>
          )}
          {canResume && (
            <ActionButton busy={actionBusy === 'resume'} onClick={() => onAction('resume')}>
              Resume at next step
            </ActionButton>
          )}
          {canCancel && (
            <ActionButton danger busy={actionBusy === 'cancel'} onClick={() => onAction('cancel')}>
              Cancel remaining work
            </ActionButton>
          )}
        </div>
        {(task.status === 'RUNNING' ||
          task.status === 'PAUSING' ||
          task.status === 'CANCELLING') && (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Controls are cooperative: an in-flight step is recorded and settles before later work is
            stopped.
          </p>
        )}
        {actionError && (
          <p
            role="alert"
            className="mt-2 text-[12px]"
            style={{ color: 'var(--aurora-danger-text)' }}
          >
            {actionError}
          </p>
        )}
      </div>

      {replanOpen && plan ? (
        <MsaidiziTaskReplanForm
          key={`${task.id}:${plan.version}`}
          task={task}
          plan={plan}
          busy={actionBusy === 'replan'}
          onReplan={onReplan}
          onClose={() => setReplanOpen(false)}
        />
      ) : null}

      {task.status !== 'PLANNING' ? (
        <MsaidiziTaskCapture
          taskId={task.id}
          spokenSummary={`${task.title}. Status ${statusLabel(task.status)}. ${task.objective}`}
          onUploaded={() => onArtifactUploaded()}
        />
      ) : null}

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Plan and recovery
        </h3>
        {plan ? (
          <>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
              Version {plan.version} · {plan.summary}
            </p>
            {plan.sourceProposalDigest && (
              <p
                className="mt-1 font-mono text-[10px]"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                Reviewed AI proposal {plan.sourceProposalDigest.slice(0, 16)}…
              </p>
            )}
            <ol className="mt-3 space-y-2">
              {plan.steps.map((step) => (
                <li
                  key={step.id}
                  className="rounded-lg p-3"
                  style={{ background: 'var(--aurora-bg-muted)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="text-[12px] font-medium"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      {step.sequence}. {step.name}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                      {statusLabel(step.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                    {step.target} · {step.expectedEffect} · {step.dataClass} · {step.capability}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
                    {step.recovery ? 'Recovery declared' : 'No recovery action declared'} ·{' '}
                    {step.idempotent ? 'idempotent' : 'not automatically retryable'}
                  </p>
                  {step.inputBindings?.length ? (
                    <ul
                      className="mt-2 space-y-1"
                      aria-label={`${step.name} immutable input bindings`}
                    >
                      {step.inputBindings.map((binding) => (
                        <li
                          key={binding.targetPath}
                          className="text-[10px]"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          {binding.targetPath} ← {bindingSourceLabel(binding)} ·{' '}
                          {binding.expectedType} · {binding.transform.name} v
                          {binding.transform.version}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {task.status === 'PLANNING'
              ? 'This draft has no plan. Its text and untrusted attachments are waiting for one reviewed plan to be attached.'
              : 'Loading the active immutable plan…'}
          </p>
        )}
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Hard budget ledger
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Meter label="Model turns" used={task.modelTurns} limit={task.maxModelTurns} />
          <Meter
            label="Tool attempts"
            used={task.attemptedToolCalls}
            limit={task.maxAttemptedToolCalls}
          />
          <Meter
            label="Executed tools"
            used={task.executedToolCalls}
            limit={task.maxAttemptedToolCalls}
          />
          <Meter label="Mutations" used={task.mutations} limit={task.maxMutations} />
          <Meter label="Wall time" used={elapsedWallTime} limit={wallTimeCeiling} />
          <Meter
            label="Local I/O"
            used={`${formatBytes(task.bytesRead)} read / ${formatBytes(task.bytesWritten)} written`}
            limit={formatBytes(task.maxLocalBytes)}
          />
          <Meter
            label="External egress"
            used={formatBytes(task.externalEgressBytes)}
            limit={formatBytes(task.maxExternalEgressBytes)}
          />
          <Meter
            label="Model spend"
            used={`$${task.modelCostUsd}`}
            limit={`$${task.maxModelCostUsd}`}
          />
        </dl>
        {task.proposalUsageId && (
          <p className="mt-3 font-mono text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Pre-task model usage receipt {task.proposalUsageId}; its settled usage is included in
            this ledger.
          </p>
        )}
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Timeline
          </h3>
          <p
            role="status"
            aria-label="Task timeline connection"
            className="rounded-full px-2 py-1 text-[10px] font-medium"
            style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text-muted)' }}
          >
            {timelineConnection}
          </p>
        </div>
        {events.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
            No event has been recorded yet.
          </p>
        ) : (
          <ol className="mt-3 space-y-2" aria-label="Task timeline">
            {events.map((event) => (
              <li
                key={event.cursor}
                className="border-l-2 pl-3 text-[12px]"
                style={{ borderColor: 'var(--aurora-border)' }}
              >
                <p style={{ color: 'var(--aurora-text)' }}>{event.type.replaceAll('.', ' · ')}</p>
                <p className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
                  {formatWhen(event.createdAt)} · {event.actorType.toLowerCase()}
                </p>
                <p
                  className="font-mono text-[10px]"
                  style={{ color: 'var(--aurora-text-muted)' }}
                  title={`Ledger SHA-256 ${event.eventHash}; previous ${event.previousHash}`}
                >
                  ledger {event.eventHash.slice(0, 12)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <MsaidiziTaskOperationalEvidence task={task} />
    </section>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  disabled = false,
  danger = false,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  busy: boolean;
  disabled?: boolean;
  danger?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={busy || disabled}
      onClick={onClick}
      className="cursor-pointer rounded-lg px-3 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
      style={
        danger
          ? { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' }
          : { color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }
      }
    >
      {busy ? 'Working…' : children}
    </button>
  );
}

function MsaidiziAutopilotSafety() {
  const [safety, setSafety] = useState<MsaidiziSafetyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'disable' | 'enable' | null>(null);
  const [phrase, setPhrase] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSafety(await getMsaidiziSafetyStatus());
    } catch (loadError) {
      setError(asError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const expectedPhrase = confirmation === 'disable' ? 'DISABLE AUTOPILOT' : 'ENABLE AUTOPILOT';

  const apply = async () => {
    if (!confirmation || phrase !== expectedPhrase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result =
        confirmation === 'disable'
          ? await disableMsaidiziAutopilot()
          : await enableMsaidiziAutopilot();
      setNotice(result.message);
      setConfirmation(null);
      setPhrase('');
      await load();
    } catch (actionError) {
      setError(asError(actionError));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setConfirmation(null);
    setPhrase('');
  };

  return (
    <section
      aria-label="Global Autopilot safety"
      className="rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Global Autopilot safety
            </h2>
            {safety ? (
              <ControlPlaneStatus
                status={safety.effectiveAutopilotEnabled ? 'ACTIVE' : 'DISABLED'}
              />
            ) : null}
          </div>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            This human-only latch blocks new durable task and device dispatch. Conversations remain
            available. Re-enabling never resumes paused tasks or routines.
          </p>
        </div>
        {safety ? (
          <ActionButton
            danger={safety.operatorLatch === 'ACTIVE'}
            busy={busy}
            disabled={loading}
            onClick={() => {
              setNotice(null);
              setConfirmation(safety.operatorLatch === 'ACTIVE' ? 'disable' : 'enable');
            }}
          >
            {safety.operatorLatch === 'ACTIVE' ? 'Disable Autopilot' : 'Enable Autopilot latch'}
          </ActionButton>
        ) : null}
      </div>

      {loading && !safety ? <Skeleton className="mt-3 h-12" /> : null}
      {safety ? (
        <p className="mt-3 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
          Operator latch: {statusLabel(safety.operatorLatch)} · running {safety.runningTasks} ·
          pausing {safety.pausingTasks} · queued {safety.queuedTasks} · paused {safety.pausedTasks}{' '}
          · active routines {safety.activeSchedules}
          {safety.externalKillSwitchActive ? ' · external emergency kill is active' : ''}
          {!safety.deploymentAutopilotEnabled ? ' · deployment policy also disables Autopilot' : ''}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-3 text-[12px]"
          style={{ color: 'var(--aurora-success-text)' }}
        >
          {notice}
        </p>
      ) : null}

      {confirmation ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="msaidizi-autopilot-safety-title"
          className="mt-4 rounded-xl p-4"
          style={{
            background:
              confirmation === 'disable' ? 'var(--aurora-danger-bg)' : 'var(--aurora-warning-bg)',
            border: '1px solid var(--aurora-border)',
          }}
        >
          <h3
            id="msaidizi-autopilot-safety-title"
            className="text-[13px] font-semibold"
            style={{ color: 'var(--aurora-text)' }}
          >
            {confirmation === 'disable'
              ? 'Confirm global Autopilot disable'
              : 'Confirm operator latch release'}
          </h3>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            {confirmation === 'disable'
              ? 'Queued tasks will pause, running tasks will pause after their current step, and active routines will pause.'
              : 'This only permits future explicit queue, resume, and routine-activation actions. Nothing resumes now.'}
          </p>
          <CompactField label={`Type ${expectedPhrase} to continue`}>
            <input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              className={CONTROL_INPUT_CLASS}
              style={CONTROL_INPUT_STYLE}
              autoComplete="off"
            />
          </CompactField>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              danger={confirmation === 'disable'}
              busy={busy}
              disabled={phrase !== expectedPhrase}
              onClick={() => void apply()}
            >
              {confirmation === 'disable' ? 'Confirm disable' : 'Confirm enable'}
            </ActionButton>
            <ActionButton busy={false} disabled={busy} onClick={close}>
              Go back
            </ActionButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function MsaidiziTaskCenter({
  initialTaskId = null,
}: { initialTaskId?: string | null } = {}) {
  const [tasks, setTasks] = useState<MsaidiziTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId);
  const [selected, setSelected] = useState<MsaidiziTask | null>(null);
  const [events, setEvents] = useState<MsaidiziTaskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [eventWatch, setEventWatch] = useState<{ taskId: string; generation: number } | null>(null);
  const [eventTransport, setEventTransport] = useState<
    MsaidiziTaskEventTransport | 'connecting' | null
  >(null);
  const [eventCursor, setEventCursor] = useState('0');
  const eventTaskIdRef = useRef<string | null>(null);
  const eventCursorRef = useRef('0');
  const eventControllerRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef(0);
  const snapshotRefreshRef = useRef<TaskSnapshotRefresh | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const page = await listMsaidiziTasks({ limit: 30 });
      setTasks((current) => {
        const exact = initialTaskId
          ? (current.find((task) => task.id === initialTaskId) ?? null)
          : null;
        return exact && !page.data.some((task) => task.id === exact.id)
          ? [exact, ...page.data]
          : page.data;
      });
      setSelectedId((current) => current ?? page.data[0]?.id ?? null);
    } catch (error) {
      setListError(asError(error));
    } finally {
      setLoading(false);
    }
  }, [initialTaskId]);

  useEffect(() => {
    if (initialTaskId) setSelectedId(initialTaskId);
  }, [initialTaskId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const refreshTaskSnapshot = useCallback(async (id: string) => {
    const active = snapshotRefreshRef.current;
    if (active?.taskId === id) {
      active.pending = true;
      return;
    }

    const token = Symbol(id);
    snapshotRefreshRef.current = { taskId: id, token, pending: false };
    try {
      do {
        const currentRefresh: TaskSnapshotRefresh | null = snapshotRefreshRef.current;
        if (!currentRefresh || currentRefresh.token !== token) return;
        currentRefresh.pending = false;

        const task = await fetchMsaidiziTask(id);
        if (eventTaskIdRef.current !== id || snapshotRefreshRef.current?.token !== token) return;
        setSelected(task);
        setTasks((current) => replaceTask(current, task));
        if (isTerminalTask(task)) {
          eventControllerRef.current?.abort();
          setEventWatch(null);
          setEventTransport(null);
          return;
        }
      } while (snapshotRefreshRef.current?.token === token && snapshotRefreshRef.current.pending);
    } catch (error) {
      if (eventTaskIdRef.current === id && snapshotRefreshRef.current?.token === token) {
        setDetailError(asError(error));
      }
    } finally {
      if (snapshotRefreshRef.current?.token === token) snapshotRefreshRef.current = null;
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const request = ++detailRequestRef.current;
    setDetailError(null);
    try {
      const [task, eventPage] = await Promise.all([
        fetchMsaidiziTask(id),
        fetchMsaidiziTaskEvents(id),
      ]);
      if (request !== detailRequestRef.current || eventTaskIdRef.current !== id) return;
      setSelected(task);
      setEvents((current) => mergeTaskEvents(id, current, eventPage.data));
      for (const event of eventPage.data) {
        if (event.taskId === id && TASK_EVENT_CURSOR.test(event.cursor)) {
          eventCursorRef.current = laterCursor(eventCursorRef.current, event.cursor);
        }
      }
      setEventCursor(eventCursorRef.current);
      setTasks((current) => replaceTask(current, task));
      setEventTransport(isTerminalTask(task) ? null : 'connecting');
      setEventWatch((current) =>
        isTerminalTask(task)
          ? null
          : {
              taskId: id,
              generation: (current?.generation ?? 0) + 1,
            },
      );
    } catch (error) {
      if (request === detailRequestRef.current && eventTaskIdRef.current === id) {
        setDetailError(asError(error));
      }
    }
  }, []);

  useEffect(() => {
    detailRequestRef.current += 1;
    eventTaskIdRef.current = selectedId;
    eventCursorRef.current = '0';
    setEventCursor('0');
    setEventTransport(null);
    snapshotRefreshRef.current = null;
    setEventWatch(null);
    setSelected(null);
    setEvents([]);
    if (!selectedId) {
      return;
    }
    void loadDetail(selectedId);
    return () => {
      detailRequestRef.current += 1;
    };
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!eventWatch || eventWatch.taskId !== selectedId) return;
    const controller = new AbortController();
    eventControllerRef.current = controller;
    const taskId = eventWatch.taskId;
    void watchMsaidiziTaskEvents(taskId, {
      signal: controller.signal,
      after: eventCursorRef.current,
      onCursor: (cursor) => {
        if (eventTaskIdRef.current === taskId) {
          eventCursorRef.current = laterCursor(eventCursorRef.current, cursor);
          setEventCursor(eventCursorRef.current);
        }
      },
      onTransportChange: (transport) => {
        if (eventTaskIdRef.current === taskId) setEventTransport(transport);
      },
      onEvents: (next) => {
        if (eventTaskIdRef.current === taskId) {
          setEvents((current) => mergeTaskEvents(taskId, current, next));
          void refreshTaskSnapshot(taskId);
        }
      },
    }).catch((error) => {
      if (!controller.signal.aborted && eventTaskIdRef.current === taskId) {
        setEventTransport(null);
        setDetailError(asError(error));
      }
    });
    return () => {
      controller.abort();
      if (eventControllerRef.current === controller) eventControllerRef.current = null;
    };
  }, [eventWatch, refreshTaskSnapshot, selectedId]);

  const onPlanned = useCallback((task: MsaidiziTask) => {
    setTasks((current) => replaceTask(current, task));
    setSelected(task);
    setSelectedId(task.id);
  }, []);

  const runAction = useCallback(
    async (
      action: 'create' | 'pause' | 'resume' | 'cancel',
      oneShotConsentStepIds: string[] = [],
    ) => {
      if (!selected) return;
      setActionBusy(action);
      setActionError(null);
      try {
        const next =
          action === 'create'
            ? await createMsaidiziTask(selected.id, oneShotConsentStepIds)
            : await {
                pause: pauseMsaidiziTask,
                resume: resumeMsaidiziTask,
                cancel: cancelMsaidiziTask,
              }[action](selected.id);
        setSelected(next);
        setTasks((current) => replaceTask(current, next));
        if (isTerminalTask(next)) {
          eventControllerRef.current?.abort();
          setEventWatch(null);
        }
      } catch (error) {
        setActionError(asError(error));
      } finally {
        setActionBusy(null);
      }
    },
    [selected],
  );

  const runReplan = useCallback(
    async (request: ReplanMsaidiziTaskRequest): Promise<boolean> => {
      if (!selected || !isReplannableTask(selected)) return false;
      setActionBusy('replan');
      setActionError(null);
      try {
        const next = await replanMsaidiziTask(selected.id, request);
        setSelected(next);
        setTasks((current) => replaceTask(current, next));
        setEventWatch((current) => ({
          taskId: next.id,
          generation: (current?.generation ?? 0) + 1,
        }));
        return true;
      } catch (error) {
        setActionError(asError(error));
        return false;
      } finally {
        setActionBusy(null);
      }
    },
    [selected],
  );

  const content = useMemo(() => {
    if (detailError)
      return (
        <ErrorState
          message={detailError}
          onRetry={() => selectedId && void loadDetail(selectedId)}
        />
      );
    if (!selected)
      return (
        <EmptyState
          title="Select a task"
          description="Choose a task to inspect its reviewed plan, durable timeline and budget ledger."
        />
      );
    return (
      <MsaidiziTaskDetail
        key={selected.id}
        task={selected}
        events={events}
        eventTransport={eventTransport}
        eventCursor={eventCursor}
        actionBusy={actionBusy}
        actionError={actionError}
        onAction={(action, oneShotConsentStepIds) => void runAction(action, oneShotConsentStepIds)}
        onReplan={runReplan}
        onArtifactUploaded={() => void loadDetail(selected.id)}
      />
    );
  }, [
    actionBusy,
    actionError,
    detailError,
    eventCursor,
    eventTransport,
    events,
    loadDetail,
    runAction,
    runReplan,
    selected,
    selectedId,
  ]);

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside
        className="flex min-h-0 flex-col overflow-hidden rounded-xl"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="border-b px-3 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Durable tasks
          </h2>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Plans, progress and evidence survive a conversation or browser restart.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MsaidiziTaskList
            tasks={tasks}
            selectedId={selectedId}
            onSelect={setSelectedId}
            loading={loading}
            error={listError}
            onRetry={() => void loadTasks()}
          />
        </div>
      </aside>
      <div className="min-w-0 space-y-4 overflow-y-auto">
        <MsaidiziAutopilotSafety />
        <MsaidiziTaskPlanner
          draftTask={
            selected?.status === 'PLANNING' && selected.activePlanVersion === 0 ? selected : null
          }
          onTaskChanged={onPlanned}
          onDraftArtifactUploaded={(taskId) => void loadDetail(taskId)}
        />
        {content}
      </div>
    </div>
  );
}

function replaceControlPlaneItem<T extends { id: string }>(items: T[], next: T): T[] {
  return items.some((item) => item.id === next.id)
    ? items.map((item) => (item.id === next.id ? next : item))
    : [next, ...items];
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function ControlPlaneStatus({ status }: { status: string }) {
  const active = status === 'ACTIVE' || status === 'TRUSTED';
  const terminal = status === 'REVOKED' || status === 'ARCHIVED' || status === 'EXPIRED';
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
      style={
        active
          ? { color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' }
          : terminal
            ? { color: 'var(--aurora-text-muted)', background: 'var(--aurora-bg-muted)' }
            : { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' }
      }
    >
      {statusLabel(status)}
    </span>
  );
}

function CompactField({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label
      className="block text-[12px] font-medium"
      style={{ color: 'var(--aurora-text-secondary)' }}
    >
      {label}
      {children}
      {hint ? (
        <span
          className="mt-1 block text-[10px] font-normal"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const CONTROL_INPUT_CLASS = 'mt-1 w-full rounded-lg px-3 py-2 text-[12px] outline-none';
const CONTROL_INPUT_STYLE = {
  background: 'var(--aurora-bg)',
  border: '1px solid var(--aurora-border)',
  color: 'var(--aurora-text)',
};

function MsaidiziRoutinesWorkspace() {
  const [mandates, setMandates] = useState<MsaidiziMandate[]>([]);
  const [schedules, setSchedules] = useState<MsaidiziSchedule[]>([]);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [mandateName, setMandateName] = useState('');
  const [mandateDescription, setMandateDescription] = useState('');
  const [capability, setCapability] = useState('');
  const [effect, setEffect] = useState<MsaidiziTaskEffect>('READ');
  const [dataClass, setDataClass] = useState('internal');
  const [emergencyOperatorConsent, setEmergencyOperatorConsent] = useState(false);

  const [scheduleName, setScheduleName] = useState('');
  const [scheduleMandateId, setScheduleMandateId] = useState('');
  const [cronExpression, setCronExpression] = useState('0 8 * * *');
  const [timezone, setTimezone] = useState('Africa/Nairobi');
  const [scheduleConcurrency, setScheduleConcurrency] = useState<'SKIP' | 'QUEUE'>('SKIP');
  const [taskTemplate, setTaskTemplate] = useState(
    '{\n  "title": "",\n  "objective": "",\n  "steps": []\n}',
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mandatePage, schedulePage] = await Promise.all([
        listMsaidiziMandates({ limit: 100 }),
        listMsaidiziSchedules({ limit: 100 }),
      ]);
      setMandates(mandatePage.items);
      setSchedules(schedulePage.items);
    } catch (loadError) {
      setError(asError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableMandates = mandates.filter(
    (mandate) => mandate.status !== 'REVOKED' && mandate.status !== 'EXPIRED',
  );
  const selectedMandateId = scheduleMandateId || availableMandates[0]?.id || '';

  const submitMandate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('create-mandate');
    setError(null);
    setNotice(null);
    try {
      const created = await createMsaidiziMandate({
        name: mandateName.trim(),
        description: mandateDescription.trim(),
        capabilities: [
          {
            capability: capability.trim(),
            effects: [effect],
            dataClasses: [dataClass.trim()],
            ...(effect === 'IRREVERSIBLE' && emergencyOperatorConsent
              ? { consentGrants: ['emergency_operator' as const] }
              : {}),
          },
        ],
        deviceIds: [],
        budgets: {},
      });
      setMandates((current) => replaceControlPlaneItem(current, created));
      setMandateName('');
      setMandateDescription('');
      setCapability('');
      setEmergencyOperatorConsent(false);
      setNotice('Draft mandate created. It has not been activated.');
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(null);
    }
  };

  const runMandateAction = async (
    mandate: MsaidiziMandate,
    action: 'activate' | 'suspend' | 'revoke',
  ) => {
    const key = `${action}-mandate-${mandate.id}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const updated = await {
        activate: activateMsaidiziMandate,
        suspend: suspendMsaidiziMandate,
        revoke: revokeMsaidiziMandate,
      }[action](mandate.id, mandate.version);
      setMandates((current) => replaceControlPlaneItem(current, updated));
      setNotice(
        action === 'activate'
          ? 'Mandate activated. Routines still require their own explicit activation.'
          : `Mandate ${action === 'suspend' ? 'suspended' : 'revoked'}.`,
      );
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(null);
    }
  };

  const submitSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('create-schedule');
    setError(null);
    setNotice(null);
    try {
      const created = await createMsaidiziSchedule({
        mandateId: selectedMandateId,
        name: scheduleName.trim(),
        cronExpression: cronExpression.trim(),
        timezone: timezone.trim(),
        taskTemplate: parseJsonObject(taskTemplate, 'Task template'),
        concurrencyMode: scheduleConcurrency,
      });
      setSchedules((current) => replaceControlPlaneItem(current, created));
      setScheduleName('');
      setNotice('Draft routine created. No scheduled work has been activated.');
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(null);
    }
  };

  const handleScheduleChanged = useCallback((updated: MsaidiziSchedule) => {
    setSchedules((current) => replaceControlPlaneItem(current, updated));
  }, []);

  return (
    <div className="space-y-4">
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Mandates and routines
        </h2>
        <p className="mt-1 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Creating a draft grants nothing. Mandate activation and routine activation are separate,
          explicit actions; objectives never escalate execution mode.
        </p>
        {error ? (
          <p
            role="alert"
            className="mt-2 text-[12px]"
            style={{ color: 'var(--aurora-danger-text)' }}
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="mt-2 text-[12px]"
            style={{ color: 'var(--aurora-success-text)' }}
          >
            {notice}
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
        >
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Create mandate draft
          </h3>
          <form
            onSubmit={submitMandate}
            className="mt-3 space-y-3"
            aria-label="Create mandate draft"
          >
            <CompactField label="Name">
              <input
                required
                maxLength={160}
                value={mandateName}
                onChange={(event) => setMandateName(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </CompactField>
            <CompactField label="Purpose">
              <textarea
                required
                maxLength={4000}
                rows={2}
                value={mandateDescription}
                onChange={(event) => setMandateDescription(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </CompactField>
            <div className="grid gap-2 sm:grid-cols-3">
              <CompactField label="Capability">
                <input
                  required
                  maxLength={240}
                  placeholder="Controller.handler"
                  value={capability}
                  onChange={(event) => setCapability(event.target.value)}
                  className={CONTROL_INPUT_CLASS}
                  style={CONTROL_INPUT_STYLE}
                />
              </CompactField>
              <CompactField label="Allowed effect">
                <select
                  value={effect}
                  onChange={(event) => setEffect(event.target.value as MsaidiziTaskEffect)}
                  className={CONTROL_INPUT_CLASS}
                  style={CONTROL_INPUT_STYLE}
                >
                  <option value="READ">Read</option>
                  <option value="WRITE">Write</option>
                  <option value="EXTERNAL">External</option>
                  <option value="IRREVERSIBLE">Irreversible</option>
                </select>
              </CompactField>
              <CompactField label="Data class">
                <input
                  required
                  maxLength={80}
                  value={dataClass}
                  onChange={(event) => setDataClass(event.target.value)}
                  className={CONTROL_INPUT_CLASS}
                  style={CONTROL_INPUT_STYLE}
                />
              </CompactField>
            </div>
            <label
              className="flex items-start gap-2 rounded-lg p-3 text-[11px]"
              style={{
                color: 'var(--aurora-text-secondary)',
                border: '1px solid var(--aurora-border)',
              }}
            >
              <input
                type="checkbox"
                checked={emergencyOperatorConsent}
                disabled={effect !== 'IRREVERSIBLE'}
                onChange={(event) => setEmergencyOperatorConsent(event.target.checked)}
                aria-label="Authorize emergency operator consent"
              />
              <span>
                Authorize the exact irreversible capability as an emergency-operator action. This is
                signed into device action tokens only after a separate oversight activation; it
                never follows from task prose.
              </span>
            </label>
            <ActionButton type="submit" busy={busy === 'create-mandate'} disabled={busy !== null}>
              Save mandate draft
            </ActionButton>
          </form>
        </section>

        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
        >
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Create routine draft
          </h3>
          <form
            onSubmit={submitSchedule}
            className="mt-3 space-y-3"
            aria-label="Create routine draft"
          >
            <CompactField label="Mandate">
              <select
                required
                value={selectedMandateId}
                onChange={(event) => setScheduleMandateId(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              >
                {availableMandates.length === 0 ? (
                  <option value="">Create a mandate first</option>
                ) : null}
                {availableMandates.map((mandate) => (
                  <option key={mandate.id} value={mandate.id}>
                    {mandate.name} · {statusLabel(mandate.status)}
                  </option>
                ))}
              </select>
            </CompactField>
            <div className="grid gap-2 sm:grid-cols-2">
              <CompactField label="Name">
                <input
                  required
                  maxLength={160}
                  value={scheduleName}
                  onChange={(event) => setScheduleName(event.target.value)}
                  className={CONTROL_INPUT_CLASS}
                  style={CONTROL_INPUT_STYLE}
                />
              </CompactField>
              <CompactField label="IANA time zone">
                <input
                  required
                  maxLength={80}
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className={CONTROL_INPUT_CLASS}
                  style={CONTROL_INPUT_STYLE}
                />
              </CompactField>
            </div>
            <CompactField
              label="Cron expression"
              hint="Five or six fields. Overlap behavior is selected separately."
            >
              <input
                required
                maxLength={120}
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </CompactField>
            <CompactField label="Concurrency mode">
              <select
                value={scheduleConcurrency}
                onChange={(event) => setScheduleConcurrency(event.target.value as 'SKIP' | 'QUEUE')}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              >
                <option value="SKIP">Skip overlapping run</option>
                <option value="QUEUE">Queue overlapping run</option>
              </select>
            </CompactField>
            <CompactField
              label="Task template JSON"
              hint="Stored as data. It is not planned or run by saving this form."
            >
              <textarea
                required
                rows={5}
                spellCheck={false}
                value={taskTemplate}
                onChange={(event) => setTaskTemplate(event.target.value)}
                className={`${CONTROL_INPUT_CLASS} font-mono`}
                style={CONTROL_INPUT_STYLE}
              />
            </CompactField>
            <ActionButton
              type="submit"
              busy={busy === 'create-schedule'}
              disabled={busy !== null || !selectedMandateId}
            >
              Save routine draft
            </ActionButton>
          </form>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
        >
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Mandates
          </h3>
          {loading ? <Skeleton className="mt-3 h-16" /> : null}
          {!loading && mandates.length === 0 ? (
            <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
              No mandate drafts yet.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2" aria-label="Msaidizi mandates">
            {mandates.map((mandate) => (
              <li
                key={mandate.id}
                className="rounded-lg p-3"
                style={{ background: 'var(--aurora-bg-muted)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                      {mandate.name}
                    </p>
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                      Version {mandate.version} · {mandate.capabilities.length} capability grant(s)
                    </p>
                  </div>
                  <ControlPlaneStatus status={mandate.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {mandate.status === 'DRAFT' || mandate.status === 'SUSPENDED' ? (
                    <ActionButton
                      busy={busy === `activate-mandate-${mandate.id}`}
                      disabled={busy !== null}
                      onClick={() => void runMandateAction(mandate, 'activate')}
                    >
                      Activate mandate
                    </ActionButton>
                  ) : null}
                  {mandate.status === 'ACTIVE' ? (
                    <ActionButton
                      busy={busy === `suspend-mandate-${mandate.id}`}
                      disabled={busy !== null}
                      onClick={() => void runMandateAction(mandate, 'suspend')}
                    >
                      Suspend mandate
                    </ActionButton>
                  ) : null}
                  {mandate.status !== 'REVOKED' ? (
                    <ActionButton
                      danger
                      busy={busy === `revoke-mandate-${mandate.id}`}
                      disabled={busy !== null}
                      onClick={() => void runMandateAction(mandate, 'revoke')}
                    >
                      Revoke authority
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="rounded-xl p-4"
          style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
        >
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Routines
          </h3>
          {loading ? <Skeleton className="mt-3 h-16" /> : null}
          {!loading && schedules.length === 0 ? (
            <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-muted)' }}>
              No routine drafts yet.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2" aria-label="Msaidizi routines">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="rounded-lg p-3"
                style={{ background: 'var(--aurora-bg-muted)' }}
                aria-current={selectedScheduleId === schedule.id ? 'true' : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                      {schedule.name}
                    </p>
                    <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                      {schedule.cronExpression} · {schedule.timezone} · {schedule.concurrencyMode}
                    </p>
                  </div>
                  <ControlPlaneStatus status={schedule.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton
                    busy={false}
                    disabled={busy !== null}
                    onClick={() => setSelectedScheduleId(schedule.id)}
                  >
                    Open routine
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {selectedScheduleId ? (
        <MsaidiziRoutineDetail routineId={selectedScheduleId} onChanged={handleScheduleChanged} />
      ) : null}
    </div>
  );
}

function MsaidiziMemoryWorkspace() {
  const [memories, setMemories] = useState<MsaidiziMemory[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<MsaidiziMemoryKind>('SEMANTIC');
  const [scopeKey, setScopeKey] = useState('');
  const [content, setContent] = useState('');
  const [metadata, setMetadata] = useState('{}');
  const [memoryExpiresAt, setMemoryExpiresAt] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listMsaidiziMemories({ limit: 100 });
      setMemories(page.items);
    } catch (loadError) {
      setError(asError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('create-memory');
    setError(null);
    setNotice(null);
    try {
      const created = await createMsaidiziMemory({
        kind,
        scopeKey: scopeKey.trim(),
        content,
        metadata: parseJsonObject(metadata, 'Metadata'),
        ...(memoryExpiresAt ? { expiresAt: new Date(memoryExpiresAt).toISOString() } : {}),
      });
      const summary: MsaidiziMemory = { ...created };
      delete summary.content;
      setMemories((current) => replaceControlPlaneItem(current, summary));
      setScopeKey('');
      setContent('');
      setMemoryExpiresAt('');
      setNotice(
        created.redactionsApplied
          ? 'Memory stored after detected credentials were removed.'
          : 'Memory encrypted and stored. It grants no authority to create a side effect.',
      );
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(null);
    }
  };

  const handleMemoryChanged = useCallback((updated: MsaidiziMemory) => {
    setMemories((current) => replaceControlPlaneItem(current, updated));
  }, []);

  const handleMemoryDeleted = useCallback((memoryId: string) => {
    setMemories((current) => current.filter((item) => item.id !== memoryId));
    setSelectedMemoryId(null);
    setNotice('Memory soft-deleted and removed from retrieval.');
  }, []);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(22rem,1.2fr)]">
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Store governed memory
        </h2>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Detected credentials are removed before encryption. The server records this as
          user-supplied, untrusted data; task and system provenance cannot be selected here.
        </p>
        <form onSubmit={submit} className="mt-3 space-y-3" aria-label="Create governed memory">
          <div className="grid gap-2 sm:grid-cols-2">
            <CompactField label="Kind">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as MsaidiziMemoryKind)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              >
                <option value="SEMANTIC">Semantic</option>
                <option value="EPISODIC">Episodic</option>
                <option value="PROCEDURAL">Procedural</option>
              </select>
            </CompactField>
            <CompactField label="Scope key">
              <input
                required
                maxLength={240}
                value={scopeKey}
                onChange={(event) => setScopeKey(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </CompactField>
          </div>
          <CompactField label="Content">
            <textarea
              required
              maxLength={250000}
              rows={5}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className={CONTROL_INPUT_CLASS}
              style={CONTROL_INPUT_STYLE}
            />
          </CompactField>
          <CompactField label="Metadata JSON">
            <textarea
              required
              rows={3}
              spellCheck={false}
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
              className={`${CONTROL_INPUT_CLASS} font-mono`}
              style={CONTROL_INPUT_STYLE}
            />
          </CompactField>
          <CompactField
            label="Expiry"
            hint="Optional. Leave blank to retain the memory indefinitely."
          >
            <input
              type="datetime-local"
              value={memoryExpiresAt}
              onChange={(event) => setMemoryExpiresAt(event.target.value)}
              className={CONTROL_INPUT_CLASS}
              style={CONTROL_INPUT_STYLE}
            />
          </CompactField>
          <p className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Provenance: User supplied · Trust: Untrusted data (server enforced)
          </p>
          {error ? (
            <p role="alert" className="text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
              {error}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="text-[12px]"
              style={{ color: 'var(--aurora-success-text)' }}
            >
              {notice}
            </p>
          ) : null}
          <ActionButton type="submit" busy={busy === 'create-memory'} disabled={busy !== null}>
            Encrypt and store memory
          </ActionButton>
        </form>
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Scoped memory
        </h2>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          This list fetches metadata and provenance only; encrypted content is not decrypted in
          bulk.
        </p>
        {loading ? <Skeleton className="mt-3 h-20" /> : null}
        {!loading && memories.length === 0 ? (
          <EmptyState
            title="No stored memory"
            description="Store a scoped record; the server will attach immutable user provenance."
          />
        ) : null}
        <ul className="mt-3 space-y-2" aria-label="Msaidizi memory records">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="rounded-lg p-3"
              style={{ background: 'var(--aurora-bg-muted)' }}
              aria-current={selectedMemoryId === memory.id ? 'true' : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[12px] font-medium" style={{ color: 'var(--aurora-text)' }}>
                    {memory.scopeKey}
                  </p>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
                    {statusLabel(memory.kind)} · {statusLabel(memory.sourceProvenance.sourceType)} ·
                    updated {formatWhen(memory.updatedAt)}
                  </p>
                </div>
                <ControlPlaneStatus status={memory.trustLevel ?? 'UNTRUSTED'} />
              </div>
              <div className="mt-2">
                <ActionButton
                  busy={false}
                  disabled={busy !== null}
                  onClick={() => setSelectedMemoryId(memory.id)}
                >
                  Open memory
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
        {selectedMemoryId ? (
          <div className="mt-4">
            <MsaidiziMemoryDetailPanel
              memoryId={selectedMemoryId}
              onChanged={handleMemoryChanged}
              onDeleted={handleMemoryDeleted}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}

type DeviceHealth = {
  label: string;
  tone: 'healthy' | 'attention' | 'neutral' | 'danger';
  detail: string;
};

type DeviceConfirmation =
  | { kind: 'revoke' | 'kill'; device: MsaidiziDevice }
  | { kind: 'killAll' }
  | null;

type RecoveryKind = 'QUARANTINE' | 'ADMINISTRATIVE';

const RECOVERY_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;

function deviceHealth(device: MsaidiziDevice): DeviceHealth {
  if (device.status === 'KILLED') {
    return {
      label: 'Killed',
      tone: 'danger',
      detail: 'Emergency kill has disabled this enrollment.',
    };
  }
  if (device.status === 'REVOKED') {
    return {
      label: 'Revoked',
      tone: 'neutral',
      detail: 'The enrollment credential is no longer accepted.',
    };
  }
  if (device.status === 'PENDING') {
    return {
      label: 'Awaiting pairing',
      tone: 'attention',
      detail: 'No companion has completed this one-time enrollment yet.',
    };
  }
  if (device.status === 'OFFLINE') {
    return {
      label: 'Offline',
      tone: 'attention',
      detail: 'The broker currently marks this companion offline.',
    };
  }

  const runtime = device.capabilityManifest?.runtime;
  if (!runtime) {
    return {
      label: 'Awaiting heartbeat',
      tone: 'attention',
      detail: 'The enrollment is active, but no runtime health payload is available.',
    };
  }
  if (runtime.killSwitchEngaged) {
    return {
      label: 'Local kill engaged',
      tone: 'danger',
      detail: 'The companion reports its local kill switch is engaged.',
    };
  }
  if (
    runtime.executionEnabled === false ||
    runtime.centralLedgerConnected === false ||
    runtime.manifestMatches === false
  ) {
    return {
      label: 'Attention required',
      tone: 'attention',
      detail: 'At least one companion execution, ledger, or capability check is unhealthy.',
    };
  }
  if (
    runtime.executionEnabled === true &&
    runtime.centralLedgerConnected === true &&
    runtime.manifestMatches === true
  ) {
    return {
      label: 'Healthy',
      tone: 'healthy',
      detail: 'The latest runtime payload reports execution, ledger, and manifest checks healthy.',
    };
  }
  return {
    label: 'Health incomplete',
    tone: 'attention',
    detail: 'The runtime payload is present but does not contain every health assertion.',
  };
}

function DeviceHealthBadge({ health }: { health: DeviceHealth }) {
  const style =
    health.tone === 'healthy'
      ? { color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' }
      : health.tone === 'danger'
        ? { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' }
        : health.tone === 'neutral'
          ? { color: 'var(--aurora-text-muted)', background: 'var(--aurora-bg-muted)' }
          : { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' };

  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={style}>
      {health.label}
    </span>
  );
}

function MsaidiziDeviceCard({
  device,
  focused,
  busy,
  onConfirm,
}: {
  device: MsaidiziDevice;
  focused: boolean;
  busy: string | null;
  onConfirm: (confirmation: Exclude<DeviceConfirmation, null>) => void;
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const health = deviceHealth(device);
  const manifest = device.capabilityManifest ?? {};
  const runtime = manifest.runtime;
  const capabilities = manifest.capabilities ?? [];
  const canDisable = device.status !== 'REVOKED' && device.status !== 'KILLED';

  useEffect(() => {
    if (!focused) return;
    cardRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);

  return (
    <li
      ref={cardRef}
      tabIndex={focused ? 0 : -1}
      aria-current={focused ? 'true' : undefined}
      data-focused-device={focused ? 'true' : undefined}
      className="rounded-xl p-4"
      style={{
        background: focused ? 'var(--aurora-accent-subtle)' : 'var(--aurora-bg-muted)',
        border: `2px solid ${focused ? 'var(--aurora-border-focus)' : 'var(--aurora-border)'}`,
        outline: focused ? '2px solid var(--aurora-accent-subtle)' : undefined,
        outlineOffset: focused ? '2px' : undefined,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {device.name}
          </p>
          <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {statusLabel(device.status)} · {device.platform}
            {device.osVersion ? ` ${device.osVersion}` : ''}
            {device.architecture ? ` · ${device.architecture}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {focused ? (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                color: 'var(--aurora-accent-text)',
                background: 'var(--aurora-accent-subtle)',
              }}
            >
              Opened incident
            </span>
          ) : null}
          <DeviceHealthBadge health={health} />
        </div>
      </div>

      <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
        {health.detail}
      </p>
      <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Last seen</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{formatWhen(device.lastSeenAt)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Paired</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{formatWhen(device.pairedAt)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Companion version</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>
            {runtime?.component ?? 'Not reported'}
            {runtime?.componentVersion ? ` ${runtime.componentVersion}` : ''}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Capability protocol version</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>
            {manifest.protocolVersion === undefined ? 'Not reported' : manifest.protocolVersion}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Ledger / execution</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>
            {runtime
              ? `${runtime.centralLedgerConnected === true ? 'connected' : runtime.centralLedgerConnected === false ? 'disconnected' : 'unknown'} / ${runtime.executionEnabled === true ? 'enabled' : runtime.executionEnabled === false ? 'disabled' : 'unknown'}`
              : 'Not reported'}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Active actions / journal sequence</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>
            {runtime
              ? `${runtime.runningActionCount ?? 'unknown'} / ${runtime.journalSequence ?? 'unknown'}`
              : 'Not reported'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--aurora-card)' }}>
        <p className="text-[10px] font-semibold" style={{ color: 'var(--aurora-text-muted)' }}>
          DECLARED CAPABILITY VERSIONS
        </p>
        {capabilities.length === 0 ? (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            No typed capability manifest has been reported.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`${device.name} capabilities`}>
            {capabilities.map((capability) => (
              <li
                key={`${capability.id}-${capability.version}`}
                className="rounded px-2 py-1 font-mono text-[10px]"
                style={{ color: 'var(--aurora-text-secondary)', background: 'var(--aurora-bg)' }}
              >
                {capability.id}@{capability.version}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={auditHref({ deviceId: device.id })}
          className="rounded-lg px-3 py-2 text-[12px] font-medium"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          Device audit
        </a>
        {device.certificateThumbprint ? (
          <span className="font-mono text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Certificate {shortIdentifier(device.certificateThumbprint)}
          </span>
        ) : null}
        {canDisable ? (
          <>
            <ActionButton
              busy={busy === `revoke-${device.id}`}
              disabled={busy !== null}
              onClick={() => onConfirm({ kind: 'revoke', device })}
            >
              Revoke enrollment
            </ActionButton>
            <ActionButton
              danger
              busy={busy === `kill-${device.id}`}
              disabled={busy !== null}
              onClick={() => onConfirm({ kind: 'kill', device })}
            >
              Emergency kill
            </ActionButton>
          </>
        ) : null}
      </div>
    </li>
  );
}

function RecoveryStatusBadge({ status }: { status: MsaidiziRecoveryCommand['status'] }) {
  const style =
    status === 'SUCCEEDED'
      ? { color: 'var(--aurora-success-text)', background: 'var(--aurora-success-bg)' }
      : status === 'FAILED' || status === 'NEEDS_ATTENTION'
        ? { color: 'var(--aurora-danger-text)', background: 'var(--aurora-danger-bg)' }
        : { color: 'var(--aurora-warning-text)', background: 'var(--aurora-warning-bg)' };

  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={style}>
      {statusLabel(status)}
    </span>
  );
}

function RecoveryDigest({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold" style={{ color: 'var(--aurora-text-muted)' }}>
        {label}
      </dt>
      <dd
        className="mt-1 break-all font-mono text-[10px]"
        style={{ color: 'var(--aurora-text-secondary)' }}
      >
        {value ?? 'Not recorded'}
      </dd>
    </div>
  );
}

function MsaidiziRecoveryCommandCard({
  command,
  focused,
}: {
  command: MsaidiziRecoveryCommand;
  focused: boolean;
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const result = command.resultSummary;

  useEffect(() => {
    if (!focused) return;
    cardRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);

  return (
    <li
      ref={cardRef}
      tabIndex={focused ? 0 : -1}
      aria-current={focused ? 'true' : undefined}
      data-focused-recovery={focused ? 'true' : undefined}
      className="rounded-xl p-4"
      style={{
        background: focused ? 'var(--aurora-accent-subtle)' : 'var(--aurora-bg-muted)',
        border: `2px solid ${focused ? 'var(--aurora-border-focus)' : 'var(--aurora-border)'}`,
        outline: focused ? '2px solid var(--aurora-accent-subtle)' : undefined,
        outlineOffset: focused ? '2px' : undefined,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Recovery {shortIdentifier(command.id)}
          </p>
          <p className="mt-1 text-[10px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Original action {command.originalActionId} · device {command.deviceId}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {focused ? (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                color: 'var(--aurora-accent-text)',
                background: 'var(--aurora-accent-subtle)',
              }}
            >
              Opened recovery record
            </span>
          ) : null}
          <RecoveryStatusBadge status={command.status} />
        </div>
      </div>

      <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Recovery command ID</dt>
          <dd className="break-all font-mono" style={{ color: 'var(--aurora-text)' }}>
            {command.id}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Host action record</dt>
          <dd className="break-all font-mono" style={{ color: 'var(--aurora-text)' }}>
            {command.hostActionId}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Requested by human</dt>
          <dd className="break-all font-mono" style={{ color: 'var(--aurora-text)' }}>
            {command.requestedByUserId}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Manifest signing key</dt>
          <dd className="break-all font-mono" style={{ color: 'var(--aurora-text)' }}>
            {command.signingKeyId}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Dispatch attempts</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{command.dispatchCount}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Queued</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{formatWhen(command.queuedAt)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Dispatched</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{formatWhen(command.dispatchedAt)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Recovery started</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{formatWhen(command.startedAt)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Completed</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>{formatWhen(command.completedAt)}</dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Record created / updated</dt>
          <dd style={{ color: 'var(--aurora-text)' }}>
            {formatWhen(command.createdAt)} / {formatWhen(command.updatedAt)}
          </dd>
        </div>
      </dl>

      <dl
        className="mt-3 grid gap-3 rounded-lg p-3 sm:grid-cols-2"
        style={{ background: 'var(--aurora-card)' }}
      >
        <RecoveryDigest label="RECOVERY RECORD SHA-256" value={command.recoveryRecordSha256} />
        <RecoveryDigest
          label="EXPECTED CURRENT STATE SHA-256"
          value={command.expectedCurrentStateSha256}
        />
        <RecoveryDigest label="SIGNED MANIFEST SHA-256" value={command.manifestSha256} />
        <RecoveryDigest
          label="SUPERVISOR JOURNAL HEAD SHA-256"
          value={command.supervisorJournalHead}
        />
      </dl>

      <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--aurora-card)' }}>
        <p className="text-[10px] font-semibold" style={{ color: 'var(--aurora-text-muted)' }}>
          TERMINAL RESULT
        </p>
        {result ? (
          <>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
              {result.outcome ? statusLabel(result.outcome) : command.status}
              {result.reason ? ` · ${result.reason}` : ''}
              {result.receivedAt ? ` · received ${formatWhen(result.receivedAt)}` : ''}
            </p>
            <dl className="mt-2 grid gap-3 sm:grid-cols-2">
              <RecoveryDigest label="RESULT MANIFEST SHA-256" value={result.manifestSha256} />
              <RecoveryDigest
                label="RESULT JOURNAL HEAD SHA-256"
                value={result.journalHeadSha256}
              />
              <RecoveryDigest label="RESTORED STATE SHA-256" value={result.restoredStateSha256} />
              <RecoveryDigest label="RESULT DEVICE" value={result.deviceId} />
            </dl>
          </>
        ) : (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            No terminal supervisor result has been recorded.
          </p>
        )}
      </div>

      <div
        className="mt-3 rounded-lg p-3 text-[11px]"
        style={{ background: 'var(--aurora-card)', color: 'var(--aurora-text-secondary)' }}
      >
        <p>
          This command was authorized by the recorded human and is executed by the separately
          installed trusted supervisor. It is not a task step or a model-addressable capability. The
          central audit ledger attributes authorization to the human and terminal execution to
          <span className="font-mono"> TRUSTED_SUPERVISOR</span>.
        </p>
        <a
          href={auditHref({ deviceId: command.deviceId })}
          className="mt-2 inline-block rounded-lg px-3 py-2 text-[12px] font-medium"
          style={{ color: 'var(--aurora-accent-text)', background: 'var(--aurora-accent-subtle)' }}
        >
          Recovery audit trail
        </a>
      </div>
    </li>
  );
}

function MsaidiziRecoveryRequestForm({
  onRequested,
}: {
  onRequested: (command: MsaidiziRecoveryCommand) => void;
}) {
  const [kind, setKind] = useState<RecoveryKind>('QUARANTINE');
  const [hostActionId, setHostActionId] = useState('');
  const [originalActionId, setOriginalActionId] = useState('');
  const [expectedCurrentStateSha256, setExpectedCurrentStateSha256] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalizedDigest = expectedCurrentStateSha256.trim().toLowerCase();
  const requiredPhrase =
    kind === 'QUARANTINE'
      ? `RESTORE ${originalActionId.trim()}`
      : `RESTORE ${originalActionId.trim()} AT ${normalizedDigest}`;
  const valid =
    RECOVERY_UUID.test(hostActionId.trim()) &&
    originalActionId.trim().length > 0 &&
    (kind === 'QUARANTINE' || SHA256.test(normalizedDigest)) &&
    confirmationPhrase === requiredPhrase;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const command = await requestMsaidiziRecoveryCommand({
        hostActionId: hostActionId.trim(),
        confirmationPhrase,
        ...(kind === 'ADMINISTRATIVE' ? { expectedCurrentStateSha256: normalizedDigest } : {}),
      });
      onRequested(command);
      setConfirmationPhrase('');
      setNotice(`Recovery ${command.id} was authorized and queued for its trusted supervisor.`);
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
    >
      <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
        Authorize an exact trusted recovery
      </h3>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
        Nothing is inferred from a task, device, or recovery link. Enter the persisted host action
        and original action identifiers yourself, then type the exact phrase. Administrative
        recovery also binds the current-state digest into the signed command.
      </p>
      <form
        className="mt-3 grid gap-3 lg:grid-cols-2"
        aria-label="Authorize trusted recovery"
        onSubmit={submit}
      >
        <CompactField label="Recovery kind">
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as RecoveryKind);
              setConfirmationPhrase('');
            }}
            className={CONTROL_INPUT_CLASS}
            style={CONTROL_INPUT_STYLE}
          >
            <option value="QUARANTINE">Quarantined file or folder</option>
            <option value="ADMINISTRATIVE">Administrative state</option>
          </select>
        </CompactField>
        <CompactField label="Host action record ID" hint="The database UUID, not the action token.">
          <input
            required
            value={hostActionId}
            onChange={(event) => setHostActionId(event.target.value)}
            className={`${CONTROL_INPUT_CLASS} font-mono`}
            style={CONTROL_INPUT_STYLE}
            autoComplete="off"
            spellCheck={false}
          />
        </CompactField>
        <CompactField
          label="Original action ID"
          hint="Used only to construct the exact phrase; the server verifies it against the host action."
        >
          <input
            required
            value={originalActionId}
            onChange={(event) => {
              setOriginalActionId(event.target.value);
              setConfirmationPhrase('');
            }}
            className={`${CONTROL_INPUT_CLASS} font-mono`}
            style={CONTROL_INPUT_STYLE}
            autoComplete="off"
            spellCheck={false}
          />
        </CompactField>
        {kind === 'ADMINISTRATIVE' ? (
          <CompactField
            label="Expected current-state SHA-256"
            hint="Exactly 64 hexadecimal characters measured before authorization."
          >
            <input
              required
              value={expectedCurrentStateSha256}
              onChange={(event) => {
                setExpectedCurrentStateSha256(event.target.value);
                setConfirmationPhrase('');
              }}
              className={`${CONTROL_INPUT_CLASS} font-mono`}
              style={CONTROL_INPUT_STYLE}
              autoComplete="off"
              spellCheck={false}
            />
          </CompactField>
        ) : null}
        <div className="lg:col-span-2">
          <p className="text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            Type exactly:{' '}
            <code className="break-all font-mono" style={{ color: 'var(--aurora-text)' }}>
              {requiredPhrase}
            </code>
          </p>
          <CompactField label="Exact confirmation phrase">
            <input
              required
              value={confirmationPhrase}
              onChange={(event) => setConfirmationPhrase(event.target.value)}
              className={`${CONTROL_INPUT_CLASS} font-mono`}
              style={CONTROL_INPUT_STYLE}
              autoComplete="off"
              spellCheck={false}
            />
          </CompactField>
        </div>
        <div className="lg:col-span-2">
          <ActionButton type="submit" danger busy={busy} disabled={busy || !valid}>
            Authorize exact recovery
          </ActionButton>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-[12px]" style={{ color: 'var(--aurora-danger-text)' }}>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-3 text-[12px]"
          style={{ color: 'var(--aurora-success-text)' }}
        >
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function MsaidiziDevicesWorkspace({
  focusedDeviceId = null,
  focusedRecoveryId = null,
}: {
  focusedDeviceId?: string | null;
  focusedRecoveryId?: string | null;
}) {
  const [devices, setDevices] = useState<MsaidiziDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pairingName, setPairingName] = useState('');
  // The raw challenge intentionally lives only in this mounted component's memory.
  const [pairing, setPairing] = useState<MsaidiziPairingCode | null>(null);
  const [confirmation, setConfirmation] = useState<DeviceConfirmation>(null);
  const [globalKillPhrase, setGlobalKillPhrase] = useState('');
  const [recoveries, setRecoveries] = useState<MsaidiziRecoveryCommand[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [selectedRecoveryId, setSelectedRecoveryId] = useState<string | null>(focusedRecoveryId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listMsaidiziDevices();
      setDevices(page.items);
    } catch (loadError) {
      setError(asError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRecoveries = useCallback(async () => {
    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      // The exact fetch keeps a notification target addressable even when it is
      // older than the bounded recent list. Both requests are read-only.
      const [recent, focused] = await Promise.all([
        listMsaidiziRecoveryCommands(),
        focusedRecoveryId ? fetchMsaidiziRecoveryCommand(focusedRecoveryId) : Promise.resolve(null),
      ]);
      setRecoveries(
        focused ? [focused, ...recent.filter((command) => command.id !== focused.id)] : recent,
      );
    } catch (loadError) {
      setRecoveryError(asError(loadError));
    } finally {
      setRecoveryLoading(false);
    }
  }, [focusedRecoveryId]);

  useEffect(() => {
    setSelectedRecoveryId(focusedRecoveryId);
    void loadRecoveries();
  }, [focusedRecoveryId, loadRecoveries]);

  const onRecoveryRequested = useCallback((command: MsaidiziRecoveryCommand) => {
    setRecoveries((current) => [command, ...current.filter((item) => item.id !== command.id)]);
    setSelectedRecoveryId(command.id);
  }, []);

  const pairingExpiry = pairing?.expiresAt ?? null;
  useEffect(() => {
    if (!pairingExpiry) return undefined;
    const remainingMilliseconds = Math.max(0, new Date(pairingExpiry).getTime() - Date.now());
    const timeout = window.setTimeout(
      () => setPairing(null),
      Math.min(remainingMilliseconds, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [pairingExpiry]);

  const createPairingChallenge = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('create-pairing');
    setError(null);
    setNotice(null);
    try {
      const created = await createMsaidiziPairingCode(pairingName.trim());
      setPairing(created);
      setPairingName('');
      setNotice(
        'A one-time pairing challenge was created. It disappears when dismissed or expired.',
      );
      await load();
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(null);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmation) return;
    const actionKey =
      confirmation.kind === 'killAll'
        ? 'kill-all'
        : `${confirmation.kind}-${confirmation.device.id}`;
    setBusy(actionKey);
    setError(null);
    setNotice(null);
    try {
      if (confirmation.kind === 'killAll') {
        const result = await killAllMsaidiziDevices();
        setNotice(`Emergency kill accepted for ${result.killed} device enrollment(s).`);
      } else if (confirmation.kind === 'kill') {
        await killMsaidiziDevice(confirmation.device.id);
        setNotice(`Emergency kill accepted for ${confirmation.device.name}.`);
      } else {
        await revokeMsaidiziDevice(confirmation.device.id);
        setNotice(`Enrollment revoked for ${confirmation.device.name}.`);
      }
      setConfirmation(null);
      setGlobalKillPhrase('');
      await load();
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setBusy(null);
    }
  };

  const closeConfirmation = () => {
    if (busy) return;
    setConfirmation(null);
    setGlobalKillPhrase('');
  };

  return (
    <div className="space-y-4">
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Windows companions
            </h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              Health reflects explicit broker and companion assertions. Opening this page never
              enrolls, revokes, or controls a device.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton busy={loading} disabled={busy !== null} onClick={() => void load()}>
              Refresh devices
            </ActionButton>
            <ActionButton
              danger
              busy={busy === 'kill-all'}
              disabled={busy !== null}
              onClick={() => setConfirmation({ kind: 'killAll' })}
            >
              Emergency stop all devices
            </ActionButton>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 text-[12px]"
            style={{ color: 'var(--aurora-danger-text)' }}
          >
            {error}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="mt-3 text-[12px]"
            style={{ color: 'var(--aurora-success-text)' }}
          >
            {notice}
          </p>
        ) : null}
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
              Trusted recovery ledger
            </h3>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              Opening or refreshing a record only reads the central ledger. It never authorizes,
              dispatches, retries, or acknowledges a recovery command.
            </p>
          </div>
          <ActionButton
            busy={recoveryLoading}
            disabled={recoveryLoading}
            onClick={() => void loadRecoveries()}
          >
            Refresh recovery records
          </ActionButton>
        </div>
        {recoveryError ? (
          <p
            role="alert"
            className="mt-3 text-[12px]"
            style={{ color: 'var(--aurora-danger-text)' }}
          >
            {recoveryError}
          </p>
        ) : null}
        {recoveryLoading && recoveries.length === 0 ? <Skeleton className="mt-3 h-28" /> : null}
        {!recoveryLoading && recoveries.length === 0 && !recoveryError ? (
          <EmptyState
            title="No trusted recovery commands"
            description="A human operator must explicitly authorize an eligible recorded host action."
          />
        ) : null}
        {!recoveryLoading &&
        focusedRecoveryId &&
        !recoveries.some((command) => command.id === focusedRecoveryId) ? (
          <p
            role="status"
            className="mt-3 text-[12px]"
            style={{ color: 'var(--aurora-warning-text)' }}
          >
            The linked recovery record could not be found in the trusted recovery ledger.
          </p>
        ) : null}
        <ul className="mt-3 space-y-3" aria-label="Trusted recovery commands">
          {recoveries.map((command) => (
            <MsaidiziRecoveryCommandCard
              key={command.id}
              command={command}
              focused={command.id === selectedRecoveryId}
            />
          ))}
        </ul>
      </section>

      <MsaidiziRecoveryRequestForm onRequested={onRecoveryRequested} />

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
          Create one-time pairing code
        </h3>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          The code is shown once and is never placed in browser storage, a URL, or the device list.
        </p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={createPairingChallenge}
          aria-label="Create device pairing code"
        >
          <div className="min-w-0 flex-1">
            <CompactField label="Device name">
              <input
                required
                maxLength={120}
                value={pairingName}
                onChange={(event) => setPairingName(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
                autoComplete="off"
              />
            </CompactField>
          </div>
          <ActionButton type="submit" busy={busy === 'create-pairing'} disabled={busy !== null}>
            Create pairing code
          </ActionButton>
        </form>

        {pairing ? (
          <div
            className="mt-4 rounded-xl p-4"
            style={{
              background: 'var(--aurora-warning-bg)',
              border: '1px solid var(--aurora-border)',
            }}
          >
            <p
              className="text-[11px] font-semibold"
              style={{ color: 'var(--aurora-warning-text)' }}
            >
              ONE-TIME PAIRING CODE — SHOWN ONLY IN THIS VIEW
            </p>
            <output
              aria-label="One-time pairing code"
              className="mt-2 block break-all font-mono text-[22px] font-semibold tracking-wider"
              style={{ color: 'var(--aurora-text)' }}
            >
              {pairing.pairingCode}
            </output>
            <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-secondary)' }}>
              {pairing.name} · expires {formatWhen(pairing.expiresAt)}. Dismiss this value after
              entering it in the companion. It cannot be recovered from this page.
            </p>
            <div className="mt-3">
              <ActionButton busy={false} onClick={() => setPairing(null)}>
                Dismiss pairing code
              </ActionButton>
            </div>
          </div>
        ) : null}
      </section>

      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Enrolled devices
          </h3>
          <span className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            {devices.length} shown
          </span>
        </div>
        {loading && devices.length === 0 ? <Skeleton className="mt-3 h-28" /> : null}
        {!loading && devices.length === 0 ? (
          <EmptyState
            title="No device enrollments"
            description="Create a short-lived pairing code to begin an explicit enrollment."
          />
        ) : null}
        {!loading && focusedDeviceId && !devices.some((device) => device.id === focusedDeviceId) ? (
          <p
            role="status"
            className="mt-3 text-[12px]"
            style={{ color: 'var(--aurora-warning-text)' }}
          >
            The linked device is not present in the current enrollment list.
          </p>
        ) : null}
        <ul className="mt-3 space-y-3" aria-label="Msaidizi devices">
          {devices.map((device) => (
            <MsaidiziDeviceCard
              key={device.id}
              device={device}
              focused={device.id === focusedDeviceId && selectedRecoveryId === null}
              busy={busy}
              onConfirm={setConfirmation}
            />
          ))}
        </ul>
      </section>

      {confirmation ? (
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="msaidizi-device-confirmation-title"
          className="rounded-xl p-4"
          style={{
            background: 'var(--aurora-danger-bg)',
            border: '1px solid var(--aurora-border)',
          }}
        >
          <h3
            id="msaidizi-device-confirmation-title"
            className="text-[14px] font-semibold"
            style={{ color: 'var(--aurora-danger-text)' }}
          >
            {confirmation.kind === 'killAll'
              ? 'Confirm emergency stop for all devices'
              : confirmation.kind === 'kill'
                ? `Confirm emergency kill for ${confirmation.device.name}`
                : `Confirm enrollment revocation for ${confirmation.device.name}`}
          </h3>
          <p className="mt-2 text-[12px]" style={{ color: 'var(--aurora-text-secondary)' }}>
            {confirmation.kind === 'killAll'
              ? 'This requests the backend kill every pending, active, or offline enrollment. The API does not currently expose a readable global kill-latch state.'
              : confirmation.kind === 'kill'
                ? 'This is an emergency control action. It disables this enrollment and is recorded for audit.'
                : 'This invalidates the enrollment credential. Pair the companion again to restore access.'}
          </p>
          {confirmation.kind === 'killAll' ? (
            <CompactField label="Type KILL ALL to continue">
              <input
                value={globalKillPhrase}
                onChange={(event) => setGlobalKillPhrase(event.target.value)}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
                autoComplete="off"
              />
            </CompactField>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              danger
              busy={
                confirmation.kind === 'killAll'
                  ? busy === 'kill-all'
                  : busy === `${confirmation.kind}-${confirmation.device.id}`
              }
              disabled={
                busy !== null ||
                (confirmation.kind === 'killAll' && globalKillPhrase !== 'KILL ALL')
              }
              onClick={() => void runConfirmedAction()}
            >
              {confirmation.kind === 'revoke' ? 'Confirm revoke' : 'Confirm emergency kill'}
            </ActionButton>
            <ActionButton busy={false} disabled={busy !== null} onClick={closeConfirmation}>
              Go back
            </ActionButton>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Dispatches the non-chat, non-task workspaces to their real implementations.
 *
 * Named `MsaidiziWorkspacePlaceholder` until it had cost a reader an hour: every
 * branch here is live, and the name advertised the opposite. It is a panel.
 */
export function MsaidiziWorkspacePanel({
  workspace,
  focusedDeviceId = null,
  focusedRecoveryId = null,
  focusedCandidateId = null,
  onOpenTask,
}: {
  workspace: Exclude<MsaidiziWorkspace, 'conversations' | 'tasks'>;
  focusedDeviceId?: string | null;
  focusedRecoveryId?: string | null;
  focusedCandidateId?: string | null;
  onOpenTask?: (taskId: string) => void;
}) {
  if (workspace === 'routines') return <MsaidiziRoutinesWorkspace />;
  if (workspace === 'procedures') return <MsaidiziProceduresWorkspace />;
  if (workspace === 'devices')
    return (
      <MsaidiziDevicesWorkspace
        focusedDeviceId={focusedDeviceId}
        focusedRecoveryId={focusedRecoveryId}
      />
    );
  if (workspace === 'memory') return <MsaidiziMemoryWorkspace />;
  if (workspace === 'rollout')
    return (
      <MsaidiziUpdatesWorkspace focusedCandidateId={focusedCandidateId} onOpenTask={onOpenTask} />
    );
  if (workspace === 'coverage') return <MsaidiziCoverageWorkspace />;
  return null;
}
