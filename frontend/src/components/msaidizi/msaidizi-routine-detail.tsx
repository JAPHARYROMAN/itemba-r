'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  activateMsaidiziSchedule,
  archiveMsaidiziSchedule,
  fetchMsaidiziSchedule,
  fetchMsaidiziScheduleVersion,
  listMsaidiziScheduleVersions,
  pauseMsaidiziSchedule,
  updateMsaidiziSchedule,
} from '@/lib/msaidizi-tasks-client';
import type {
  MsaidiziSchedule,
  MsaidiziScheduleConcurrencyMode,
  MsaidiziScheduleVersion,
} from '@/lib/msaidizi-task-types';
import {
  CONTROL_INPUT_CLASS,
  CONTROL_INPUT_STYLE,
  ControlButton,
  ControlField,
  ControlStatus,
  InlineMessage,
  controlPlaneError,
  formatWhen,
  parseJsonObject,
  statusLabel,
  toIsoDateTime,
  toLocalDateTime,
} from './msaidizi-control-plane-detail-ui';

interface RoutineDraft {
  name: string;
  cronExpression: string;
  timezone: string;
  taskTemplate: string;
  concurrencyMode: MsaidiziScheduleConcurrencyMode;
  nextRunAt: string;
}

function draftFromRoutine(routine: MsaidiziSchedule): RoutineDraft {
  return {
    name: routine.name,
    cronExpression: routine.cronExpression,
    timezone: routine.timezone,
    taskTemplate: JSON.stringify(routine.taskTemplate, null, 2),
    concurrencyMode: routine.concurrencyMode,
    nextRunAt: toLocalDateTime(routine.nextRunAt),
  };
}

function changeLabel(changeType: string): string {
  return statusLabel(changeType.replace(/^MSAIDIZI_SCHEDULE_/, ''));
}

export function MsaidiziRoutineDetail({
  routineId,
  onChanged,
}: {
  routineId: string;
  onChanged: (routine: MsaidiziSchedule) => void;
}) {
  const { hasPermission } = useAuth();
  const canActivate = hasPermission('msaidizi.oversight');
  const [routine, setRoutine] = useState<MsaidiziSchedule | null>(null);
  const [versions, setVersions] = useState<MsaidiziScheduleVersion[]>([]);
  const [versionDetail, setVersionDetail] = useState<MsaidiziScheduleVersion | null>(null);
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const loadToken = useRef(0);
  const versionToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    setVersionDetail(null);
    try {
      const [current, history] = await Promise.all([
        fetchMsaidiziSchedule(routineId),
        listMsaidiziScheduleVersions(routineId),
      ]);
      if (token !== loadToken.current) return;
      setRoutine(current);
      setVersions(history);
      setDraft(draftFromRoutine(current));
      setConflicted(false);
      setConfirmArchive(false);
      onChanged(current);
    } catch (loadError) {
      if (token !== loadToken.current) return;
      setError(controlPlaneError(loadError, 'Refresh the routine before continuing.').message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [onChanged, routineId]);

  useEffect(() => {
    void load();
    return () => {
      loadToken.current += 1;
      versionToken.current += 1;
    };
  }, [load]);

  const refreshVersions = async () => {
    const history = await listMsaidiziScheduleVersions(routineId);
    setVersions(history);
    setVersionDetail((current) =>
      current ? (history.find((version) => version.version === current.version) ?? null) : null,
    );
  };

  const submitUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!routine || !draft || conflicted) return;
    setBusy('update');
    setError(null);
    setNotice(null);
    try {
      const updated = await updateMsaidiziSchedule(routine.id, {
        expectedVersion: routine.version,
        name: draft.name.trim(),
        cronExpression: draft.cronExpression.trim(),
        timezone: draft.timezone.trim(),
        taskTemplate: parseJsonObject(draft.taskTemplate, 'Task template'),
        concurrencyMode: draft.concurrencyMode,
        nextRunAt: toIsoDateTime(draft.nextRunAt),
      });
      setRoutine(updated);
      setDraft(draftFromRoutine(updated));
      setConflicted(false);
      onChanged(updated);
      await refreshVersions();
      setNotice('Routine changes saved as a new immutable version.');
    } catch (requestError) {
      const failure = controlPlaneError(
        requestError,
        'Your draft is preserved. Refresh the current routine before trying again.',
      );
      setError(failure.message);
      setConflicted(failure.conflict);
    } finally {
      setBusy(null);
    }
  };

  const runLifecycle = async (action: 'activate' | 'pause' | 'archive') => {
    if (!routine) return;
    const key = `${action}-${routine.id}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const updated = await {
        activate: activateMsaidiziSchedule,
        pause: pauseMsaidiziSchedule,
        archive: archiveMsaidiziSchedule,
      }[action](routine.id, routine.version);
      setRoutine(updated);
      setDraft(draftFromRoutine(updated));
      setConflicted(false);
      setConfirmArchive(false);
      onChanged(updated);
      await refreshVersions();
      setNotice(
        action === 'activate'
          ? 'Routine activated. Future dispatches remain bounded by its mandate.'
          : action === 'pause'
            ? 'Future routine dispatches paused.'
            : 'Routine archived. Its immutable evidence remains available.',
      );
    } catch (requestError) {
      const failure = controlPlaneError(
        requestError,
        'Refresh the current routine before trying another lifecycle action.',
      );
      setError(failure.message);
      setConflicted(failure.conflict);
    } finally {
      setBusy(null);
    }
  };

  const openVersion = async (version: number) => {
    const token = ++versionToken.current;
    setBusy(`version-${version}`);
    setError(null);
    try {
      const snapshot = await fetchMsaidiziScheduleVersion(routineId, version);
      if (token === versionToken.current) setVersionDetail(snapshot);
    } catch (requestError) {
      if (token === versionToken.current) {
        setError(
          controlPlaneError(requestError, 'Refresh the routine history before retrying.').message,
        );
      }
    } finally {
      if (token === versionToken.current) setBusy(null);
    }
  };

  if (loading) {
    return <Skeleton className="h-48" />;
  }

  if (!routine || !draft) {
    return (
      <section
        className="rounded-xl p-4"
        style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
      >
        {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}
        <ControlButton onClick={() => void load()}>Retry routine detail</ControlButton>
      </section>
    );
  }

  const editable = routine.status === 'DRAFT' || routine.status === 'PAUSED';

  return (
    <section
      aria-label="Routine detail"
      className="space-y-4 rounded-xl p-4"
      style={{ background: 'var(--aurora-card)', border: '1px solid var(--aurora-border)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            {routine.name}
          </h3>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Routine version {routine.version} · mandate version {routine.mandate.version} ·{' '}
            {statusLabel(routine.mandate.status)} mandate
          </p>
        </div>
        <ControlStatus status={routine.status} />
      </div>

      {error ? <InlineMessage kind="error">{error}</InlineMessage> : null}
      {notice ? <InlineMessage kind="notice">{notice}</InlineMessage> : null}

      <dl className="grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Cadence</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {routine.cronExpression} · {routine.timezone}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Concurrency</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {routine.concurrencyMode}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Next run</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {formatWhen(routine.nextRunAt)}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--aurora-text-muted)' }}>Last run</dt>
          <dd className="mt-1" style={{ color: 'var(--aurora-text)' }}>
            {formatWhen(routine.lastRunAt)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2" aria-label="Routine lifecycle controls">
        {(routine.status === 'DRAFT' || routine.status === 'PAUSED') && canActivate ? (
          <ControlButton
            busy={busy === `activate-${routine.id}`}
            disabled={busy !== null || conflicted}
            onClick={() => void runLifecycle('activate')}
          >
            Activate routine
          </ControlButton>
        ) : null}
        {(routine.status === 'DRAFT' || routine.status === 'PAUSED') && !canActivate ? (
          <p className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
            Activation requires Msaidizi oversight permission.
          </p>
        ) : null}
        {routine.status === 'ACTIVE' ? (
          <ControlButton
            busy={busy === `pause-${routine.id}`}
            disabled={busy !== null || conflicted}
            onClick={() => void runLifecycle('pause')}
          >
            Pause future runs
          </ControlButton>
        ) : null}
        {routine.status !== 'ARCHIVED' && !confirmArchive ? (
          <ControlButton
            danger
            disabled={busy !== null || conflicted}
            onClick={() => setConfirmArchive(true)}
          >
            Archive routine
          </ControlButton>
        ) : null}
      </div>

      {confirmArchive ? (
        <div
          role="alertdialog"
          aria-label="Confirm routine archive"
          className="rounded-lg p-3"
          style={{ border: '1px solid var(--aurora-border)', background: 'var(--aurora-bg-muted)' }}
        >
          <p className="text-[12px]" style={{ color: 'var(--aurora-text)' }}>
            Archive {routine.name}? Future dispatches stop, while version and audit evidence remain.
          </p>
          <div className="mt-3 flex gap-2">
            <ControlButton
              danger
              busy={busy === `archive-${routine.id}`}
              disabled={busy !== null || conflicted}
              onClick={() => void runLifecycle('archive')}
            >
              Confirm archive
            </ControlButton>
            <ControlButton disabled={busy !== null} onClick={() => setConfirmArchive(false)}>
              Keep routine
            </ControlButton>
          </div>
        </div>
      ) : null}

      {editable ? (
        <form onSubmit={submitUpdate} className="space-y-3" aria-label="Edit routine">
          <h4 className="text-[12px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Edit current routine
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <ControlField label="Routine name">
              <input
                required
                maxLength={160}
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </ControlField>
            <ControlField label="Routine concurrency">
              <select
                value={draft.concurrencyMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    concurrencyMode: event.target.value as MsaidiziScheduleConcurrencyMode,
                  })
                }
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              >
                <option value="SKIP">Skip overlapping run</option>
                <option value="QUEUE">Queue overlapping run</option>
              </select>
            </ControlField>
            <ControlField label="Routine cron expression">
              <input
                required
                maxLength={120}
                value={draft.cronExpression}
                onChange={(event) => setDraft({ ...draft, cronExpression: event.target.value })}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </ControlField>
            <ControlField label="Routine time zone">
              <input
                required
                maxLength={80}
                value={draft.timezone}
                onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
                className={CONTROL_INPUT_CLASS}
                style={CONTROL_INPUT_STYLE}
              />
            </ControlField>
          </div>
          <ControlField
            label="Next run override"
            hint="Leave blank to clear the override and let activation/cadence choose the next run."
          >
            <input
              type="datetime-local"
              value={draft.nextRunAt}
              onChange={(event) => setDraft({ ...draft, nextRunAt: event.target.value })}
              className={CONTROL_INPUT_CLASS}
              style={CONTROL_INPUT_STYLE}
            />
          </ControlField>
          <ControlField label="Routine task template JSON">
            <textarea
              required
              rows={7}
              spellCheck={false}
              value={draft.taskTemplate}
              onChange={(event) => setDraft({ ...draft, taskTemplate: event.target.value })}
              className={`${CONTROL_INPUT_CLASS} font-mono`}
              style={CONTROL_INPUT_STYLE}
            />
          </ControlField>
          <div className="flex flex-wrap gap-2">
            <ControlButton
              type="submit"
              busy={busy === 'update'}
              disabled={busy !== null || conflicted}
            >
              Save routine changes
            </ControlButton>
            {conflicted ? (
              <ControlButton disabled={busy !== null} onClick={() => void load()}>
                Refresh current routine
              </ControlButton>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
          Active and archived routines are immutable. Pause an active routine before editing it.
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(14rem,0.7fr)_minmax(18rem,1.3fr)]">
        <div>
          <h4 className="text-[12px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Immutable version history
          </h4>
          <ol className="mt-2 space-y-2" aria-label="Routine version history">
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void openVersion(version.version)}
                  className="w-full cursor-pointer rounded-lg p-2 text-left text-[11px] disabled:opacity-60"
                  style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text)' }}
                >
                  <span className="font-medium">Version {version.version}</span> ·{' '}
                  {changeLabel(version.changeType)}
                  <span
                    className="mt-1 block text-[10px]"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {statusLabel(version.status)} · {formatWhen(version.recordedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="text-[12px] font-semibold" style={{ color: 'var(--aurora-text)' }}>
            Version snapshot
          </h4>
          {versionDetail ? (
            <article
              aria-label={`Routine version ${versionDetail.version} snapshot`}
              className="mt-2 rounded-lg p-3 text-[11px]"
              style={{ background: 'var(--aurora-bg-muted)', color: 'var(--aurora-text)' }}
            >
              <p className="font-medium">
                {versionDetail.name} · {statusLabel(versionDetail.status)}
              </p>
              <p className="mt-1" style={{ color: 'var(--aurora-text-muted)' }}>
                {versionDetail.cronExpression} · {versionDetail.timezone} ·{' '}
                {versionDetail.concurrencyMode}
              </p>
              <pre
                className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded p-2 text-[10px]"
                style={{ background: 'var(--aurora-bg)', color: 'var(--aurora-text-secondary)' }}
              >
                {JSON.stringify(versionDetail.taskTemplate, null, 2)}
              </pre>
            </article>
          ) : (
            <p className="mt-2 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>
              Select a version to inspect its read-only snapshot.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
