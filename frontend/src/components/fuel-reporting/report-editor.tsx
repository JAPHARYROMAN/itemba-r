'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError, backendGet, backendPost, backendUpload } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import {
  Collections,
  Expenses,
  Field,
  FuelReceived,
  PumpReadings,
  Section,
  TankDips,
} from './report-fields';
import { Discrepancies, SummaryCards, downloadCsv } from './report-summary';
import { recoverDraft } from './report-recovery';
import {
  editablePayload,
  newPayload,
  type Branch,
  type Payload,
  type Report,
  type Revision,
  type Workspace,
} from './types';

type Operation = 'draft' | 'close' | 'upload' | 'reopen' | 'recover';

export function ReportEditor({
  branch,
  date,
  shift,
  workspace,
  canManage,
  mode,
  onSaved,
  onLock,
  apiBase = '/fuel-reporting',
}: {
  branch: Branch;
  date: string;
  shift: string;
  workspace: Workspace;
  canManage: boolean;
  mode: 'report' | 'receive';
  onSaved: (report: Report) => void;
  onLock: (locked: boolean) => void;
  /** Where reports are saved, reopened and listed. PetroDollar passes its company-pinned base. */
  apiBase?: string;
}) {
  const { hasPermission } = useAuth();
  const [report, setReport] = useState(workspace.report);
  const [payload, setPayload] = useState<Payload>(() =>
    workspace.report
      ? editablePayload(workspace.report.payload)
      : newPayload(workspace.catalog, workspace.previous),
  );
  const [saved, setSaved] = useState(payload);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ latest: Report | null } | null>(null);
  const [reviewRecovered, setReviewRecovered] = useState(false);
  const [notice, setNotice] = useState('');
  const [correction, setCorrection] = useState('');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [closing, setClosing] = useState(false);
  const closeHeadingId = useId();
  const closeHeading = useRef<HTMLHeadingElement>(null);
  const closeConfirmation = useRef<HTMLDivElement>(null);
  const closeTrigger = useRef<HTMLButtonElement>(null);
  const requestInFlight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const busy = operation !== null;
  const closed = report?.status === 'CLOSED';
  const dirty = payload !== saved && JSON.stringify(payload) !== JSON.stringify(saved);
  const locked = busy || dirty;
  const readOnly = !canManage || closed || !!revision;
  const catalog = revision?.payload.catalog ?? report?.payload.catalog ?? workspace.catalog;
  const displayed = revision?.payload ?? payload;
  const summary = revision?.summary ?? report?.summary;
  const latest = conflict?.latest;
  const recovery = latest?.status === 'DRAFT' ? recoverDraft(saved, payload, latest.payload) : null;
  const draftStatus = reviewRecovered ? 'Review and save' : 'Unsaved changes';
  const status = busy
    ? operation === 'recover'
      ? 'Loading revision…'
      : 'Saving…'
    : conflict || (error && dirty)
      ? 'Not saved'
      : dirty
        ? draftStatus
        : report
          ? `Saved · revision ${report.version}`
          : 'New shift report';

  useEffect(() => {
    onLock(locked);
  }, [locked, onLock]);
  useEffect(() => () => onLock(false), [onLock]);
  useEffect(() => {
    if (closing && !readOnly) {
      closeHeading.current?.focus({ preventScroll: true });
      closeConfirmation.current?.scrollIntoView?.({ block: 'center' });
    }
  }, [closing, readOnly]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || requestInFlight.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(
    async (close = false) => {
      if (requestInFlight.current || readOnly || conflict) return;
      requestInFlight.current = true;
      setOperation(close ? 'close' : 'draft');
      setError('');
      setNotice('');
      try {
        const result = await backendPost<Report>(`${apiBase}/reports`, {
          branchId: branch.id,
          businessDate: date,
          shift,
          version: report?.version ?? 0,
          payload: editablePayload(payload),
          close,
        });
        setReport(result);
        setSaved(payload);
        setReviewRecovered(false);
        onSaved(result);
        if (close) {
          setClosing(false);
          setNotice('Shift closed. Its figures are now included in the daily summary.');
        }
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.status === 409 &&
          e.message.startsWith('This report changed in another window.')
        ) {
          setConflict({ latest: null });
          setClosing(false);
          return;
        }
        setError(
          e instanceof Error ? e.message : 'Could not save. Your entries are still on this screen.',
        );
      } finally {
        requestInFlight.current = false;
        setOperation(null);
      }
    },
    [readOnly, conflict, payload, branch.id, date, shift, report, onSaved, apiBase],
  );

  useEffect(() => {
    if (!dirty || busy || readOnly || error || conflict || reviewRecovered) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, readOnly, error, conflict, reviewRecovered, save]);

  async function loadLatest() {
    if (requestInFlight.current || !conflict) return;
    requestInFlight.current = true;
    setOperation('recover');
    setError('');
    try {
      const current = await backendGet<Workspace>(`${apiBase}/workspace`, {
        query: { branchId: branch.id, businessDate: date, shift },
      });
      if (!current.report) throw new Error('The latest saved shift could not be found.');
      setConflict({ latest: current.report });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the latest revision.');
    } finally {
      requestInFlight.current = false;
      setOperation(null);
    }
  }

  function applyRecovery() {
    if (!latest || !recovery || requestInFlight.current) return;
    setPayload(recovery.payload);
    setSaved(recovery.base);
    setReport(latest);
    setConflict(null);
    setError('');
    setRevisions([]);
    setReviewRecovered(recovery.changed);
    setNotice(
      recovery.changed
        ? 'Your entries are ready to review. Select Save draft to save them.'
        : 'The latest revision already contains your entries.',
    );
    onSaved(latest);
  }

  function cancelClose() {
    if (requestInFlight.current) return;
    setClosing(false);
    closeTrigger.current?.focus();
  }

  const change = (value: Payload) => {
    setPayload(value);
    setError('');
    if (!reviewRecovered) setNotice('');
    setClosing(false);
  };
  async function upload(file: File) {
    if (requestInFlight.current) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose an image or PDF smaller than 10 MB.');
      return;
    }
    setOperation('upload');
    requestInFlight.current = true;
    setError('');
    try {
      const data = new FormData();
      data.append('file', file);
      data.append('title', `${date} ${shift} · ${file.name}`);
      data.append('ownerType', 'BRANCH');
      data.append('ownerId', branch.id);
      data.append('companyId', branch.companyId);
      data.append('branchId', branch.id);
      const doc = await backendUpload<{ id: string }>('/documents/upload', data);
      setPayload((current) => ({ ...current, documentIds: [...current.documentIds, doc.id] }));
      setNotice('Document uploaded. Saving its reference to this shift.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the document.');
    } finally {
      requestInFlight.current = false;
      setOperation(null);
    }
  }
  async function reopen() {
    if (requestInFlight.current || !report || !correction.trim()) return;
    requestInFlight.current = true;
    setOperation('reopen');
    setError('');
    try {
      const result = await backendPost<Report>(`${apiBase}/reports/${report.id}/reopen`, {
        version: report.version,
        reason: correction,
      });
      setReport(result);
      onSaved(result);
      setCorrection('');
      setNotice('Report reopened. Previous submissions remain in the revision history.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reopen.');
    } finally {
      requestInFlight.current = false;
      setOperation(null);
    }
  }
  async function loadRevisions() {
    if (!report) return;
    try {
      setRevisions(await backendGet<Revision[]>(`${apiBase}/reports/${report.id}/revisions`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load revisions.');
    }
  }
  return (
    <>
      <div className="fr-report-heading">
        <div>
          <span className={`fr-badge ${closed ? 'fr-badge-closed' : ''}`}>
            {closed ? 'Closed shift' : 'Draft shift'}
          </span>
          <h2>
            {shift === 'DAY' ? 'Day' : 'Night'} shift · {date}
          </h2>
          <p>
            {workspace.previous
              ? `Opening values carried from ${workspace.previous.businessDate.slice(0, 10)} ${workspace.previous.shift.toLowerCase()}. Check against your paper records.`
              : 'First report: enter opening meter and tank dip volumes as the starting baseline.'}
          </p>
        </div>
        <div className="fr-save-state">
          <span role="status">{status}</span>
          {conflict || error ? (
            <button
              type="button"
              className="fr-text-button"
              onClick={() => feedback.current?.focus()}
            >
              Details
            </button>
          ) : null}
        </div>
      </div>
      {!canManage && (
        <p className="fr-notice">You have read-only access to shift reports at this station.</p>
      )}
      <SummaryCards summary={summary} />
      <div className="fr-revisions">
        <button
          type="button"
          className="fr-text-button"
          disabled={!report || dirty || busy || !!conflict}
          onClick={() => void loadRevisions()}
        >
          View revision history
        </button>
        {revisions.length ? (
          <select
            aria-label="Report revision"
            disabled={dirty || busy || !!conflict}
            value={revision?.id ?? ''}
            onChange={(e) => setRevision(revisions.find((r) => r.id === e.target.value) ?? null)}
          >
            <option value="">Current report</option>
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                Revision {r.version} · {r.action.toLowerCase()} · {r.authorName} ·{' '}
                {new Date(r.createdAt).toLocaleString('en-TZ', {
                  timeZone: 'Africa/Dar_es_Salaam',
                })}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {revision ? (
        <p className="fr-notice">
          Viewing a preserved revision by {revision.authorName}.
          {revision.reason ? ` Correction reason: ${revision.reason}` : ''}
        </p>
      ) : null}
      <fieldset disabled={readOnly || (busy && operation !== 'draft')} className="fr-report-fields">
        {mode === 'report' ? (
          <>
            <PumpReadings payload={displayed} catalog={catalog} change={change} />
            <Collections payload={displayed} change={change} />
          </>
        ) : null}
        <FuelReceived payload={displayed} catalog={catalog} change={change} />
        {mode === 'report' ? (
          <>
            <Expenses payload={displayed} change={change} />
            <TankDips payload={displayed} catalog={catalog} change={change} />
          </>
        ) : null}
        <Section number={mode === 'report' ? '06' : undefined} title="Paper records & notes">
          <Field label="Shift notes">
            <textarea
              rows={3}
              maxLength={4000}
              value={displayed.notes}
              onChange={(e) => change({ ...payload, notes: e.target.value })}
              placeholder="Record handovers, delivery references or anything management should know."
            />
          </Field>
          <div className="fr-attachments">
            {displayed.documentIds.map((id, i) => (
              <div key={id}>
                <a href={`/api/backend/documents/${id}/download`} target="_blank" rel="noreferrer">
                  Paper record {i + 1} ↗
                </a>
                {!readOnly ? (
                  <button
                    type="button"
                    className="fr-text-button"
                    aria-label={`Remove paper record ${i + 1}`}
                    onClick={() =>
                      change({
                        ...payload,
                        documentIds: payload.documentIds.filter((x) => x !== id),
                      })
                    }
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {!readOnly && hasPermission('documents.manage') ? (
            <Field label="Attach paper shift sheet, receipt or delivery note · image / PDF, up to 10 MB">
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void upload(file);
                }}
              />
            </Field>
          ) : null}
          <Field label="Explanation of discrepancies">
            <textarea
              rows={3}
              maxLength={4000}
              value={displayed.discrepancyReason}
              onChange={(e) => change({ ...payload, discrepancyReason: e.target.value })}
              placeholder="Required when any stock, meter, sales or cash difference is recorded."
            />
          </Field>
        </Section>
      </fieldset>
      {conflict || error ? (
        <div className="fr-error" ref={feedback} tabIndex={-1}>
          {conflict ? (
            <>
              <p role="alert">This shift changed in another window. Your entries are still here.</p>
              {latest?.status === 'CLOSED' ? (
                <p>
                  Revision {latest.version} is closed. Reopen the shift in another window, then load
                  the latest revision again here.
                </p>
              ) : null}
              {recovery ? (
                <>
                  {recovery.overlaps.length ? (
                    <p>
                      Both drafts changed {recovery.overlaps.join(', ')}. Applying your entries
                      keeps your version of these sections. The other version remains in revision
                      history.
                    </p>
                  ) : (
                    <p>
                      Your entries can be combined with the changes in revision {latest?.version}.
                    </p>
                  )}
                  <button type="button" className="fr-secondary" onClick={applyRecovery}>
                    Apply my entries to revision {latest?.version}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="fr-secondary"
                  disabled={busy}
                  onClick={() => void loadLatest()}
                >
                  Load latest revision
                </button>
              )}
            </>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
      {notice ? (
        <div className="fr-success" role="status">
          {notice}
        </div>
      ) : null}
      {summary ? (
        <>
          <Discrepancies summary={summary} />
          {!closed && summary.issues.length && !revision ? (
            <div className="fr-notice">
              <h3>Before this shift can close</h3>
              <ul>
                {summary.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
      {!readOnly ? (
        <div className="fr-save-bar">
          <div>
            <strong>{status}</strong>
            <small>Closing dip readings and attendant names are required.</small>
          </div>
          <div className="fr-actions">
            <button
              type="button"
              className="fr-secondary"
              disabled={busy || !!conflict}
              onClick={() => void save()}
            >
              Save draft
            </button>
            <button
              ref={closeTrigger}
              type="button"
              className="fr-primary"
              disabled={busy || dirty || !!conflict || !report || !!summary?.issues.length}
              aria-expanded={closing}
              onClick={() => setClosing(true)}
            >
              Review & close shift
            </button>
          </div>
        </div>
      ) : null}
      {closing && !readOnly ? (
        <div
          ref={closeConfirmation}
          className="fr-close-confirm"
          role="region"
          aria-labelledby={closeHeadingId}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            cancelClose();
          }}
        >
          <h3 ref={closeHeading} id={closeHeadingId} tabIndex={-1}>
            Close the {shift.toLowerCase()} shift?
          </h3>
          <p>
            The submitted readings, attendant names and {summary?.flagged ?? 0} discrepancies will
            be preserved. This shift will count toward the daily report.
          </p>
          <div className="fr-actions">
            <button type="button" className="fr-secondary" disabled={busy} onClick={cancelClose}>
              Keep editing
            </button>
            <button
              type="button"
              className="fr-primary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Submit & close shift
            </button>
          </div>
        </div>
      ) : null}
      {closed && canManage && !revision ? (
        <Section
          title="Correct this report"
          detail="A reason is required. Later closed shifts must be reopened first to preserve stock continuity."
        >
          <Field label="Correction reason">
            <input
              value={correction}
              maxLength={1000}
              onChange={(e) => setCorrection(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="fr-secondary"
            disabled={busy || !correction.trim()}
            onClick={() => void reopen()}
          >
            Reopen for correction
          </button>
        </Section>
      ) : null}
      {report && !dirty ? (
        <button
          type="button"
          className="fr-text-button"
          onClick={() =>
            downloadCsv(`fuel-shift-${date}-${shift.toLowerCase()}.csv`, [
              [
                'Branch',
                'Date',
                'Shift',
                'Pump',
                'Nozzle',
                'Fuel',
                'Attendant',
                'Opening meter',
                'Closing meter',
                'Price TZS/L',
              ],
              ...displayed.readings.map((r) => {
                const n = catalog.nozzles.find((n) => n.id === r.nozzleId);
                return [
                  branch.name,
                  date,
                  shift,
                  n?.pumpName,
                  n?.nozzleCode,
                  n?.productName,
                  r.attendantName,
                  r.opening,
                  r.closing,
                  r.price,
                ];
              }),
            ])
          }
        >
          Export pump & attendant records · CSV
        </button>
      ) : null}
    </>
  );
}
