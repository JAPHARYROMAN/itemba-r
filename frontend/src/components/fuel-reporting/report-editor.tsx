'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backendGet, backendPost, backendUpload } from '@/lib/api-client';
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
import {
  editablePayload,
  newPayload,
  type Branch,
  type Payload,
  type Report,
  type Revision,
  type Workspace,
} from './types';

export function ReportEditor({
  branch,
  date,
  shift,
  workspace,
  canManage,
  mode,
  onSaved,
  onLock,
}: {
  branch: Branch;
  date: string;
  shift: string;
  workspace: Workspace;
  canManage: boolean;
  mode: 'report' | 'receive';
  onSaved: (report: Report) => void;
  onLock: (locked: boolean) => void;
}) {
  const { hasPermission } = useAuth();
  const [report, setReport] = useState(workspace.report);
  const [payload, setPayload] = useState<Payload>(() =>
    workspace.report
      ? editablePayload(workspace.report.payload)
      : newPayload(workspace.catalog, workspace.previous),
  );
  const [saved, setSaved] = useState(() => JSON.stringify(payload));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [correction, setCorrection] = useState('');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [revision, setRevision] = useState<Revision | null>(null);
  const [closing, setClosing] = useState(false);
  const savingRef = useRef(false);
  const closed = report?.status === 'CLOSED';
  const dirty = JSON.stringify(payload) !== saved;
  const readOnly = !canManage || closed || !!revision;
  const catalog = revision?.payload.catalog ?? report?.payload.catalog ?? workspace.catalog;
  const displayed = revision?.payload ?? payload;
  const summary = revision?.summary ?? report?.summary;
  const status = busy
    ? 'Saving…'
    : error && dirty
      ? 'Not saved'
      : dirty
        ? 'Unsaved changes'
        : report
          ? `Saved · revision ${report.version}`
          : 'New shift report';

  useEffect(() => {
    onLock(busy || dirty);
    return () => onLock(false);
  }, [busy, dirty, onLock]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || savingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(
    async (close = false) => {
      if (savingRef.current || readOnly) return;
      savingRef.current = true;
      setBusy(true);
      setError('');
      setNotice('');
      const sent = JSON.stringify(payload);
      try {
        const result = await backendPost<Report>('/fuel-reporting/reports', {
          branchId: branch.id,
          businessDate: date,
          shift,
          version: report?.version ?? 0,
          payload: editablePayload(payload),
          close,
        });
        setReport(result);
        setSaved(sent);
        onSaved(result);
        if (close) {
          setClosing(false);
          setNotice('Shift closed. Its figures are now included in the daily summary.');
        }
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Could not save. Your entries are still on this screen.',
        );
      } finally {
        savingRef.current = false;
        setBusy(false);
      }
    },
    [readOnly, payload, branch.id, date, shift, report, onSaved],
  );

  useEffect(() => {
    if (!dirty || busy || readOnly || error) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [dirty, busy, readOnly, error, save]);

  const change = (value: Payload) => {
    setPayload(value);
    setError('');
    setNotice('');
    setClosing(false);
  };
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose an image or PDF smaller than 10 MB.');
      return;
    }
    setBusy(true);
    savingRef.current = true;
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
      savingRef.current = false;
      setBusy(false);
    }
  }
  async function reopen() {
    if (!report || !correction.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await backendPost<Report>(`/fuel-reporting/reports/${report.id}/reopen`, {
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
      setBusy(false);
    }
  }
  async function loadRevisions() {
    if (!report) return;
    try {
      setRevisions(await backendGet<Revision[]>(`/fuel-reporting/reports/${report.id}/revisions`));
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
        <span className="fr-save-state" role="status">
          {status}
        </span>
      </div>
      {error ? (
        <div className="fr-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="fr-success" role="status">
          {notice}
        </div>
      ) : null}
      {summary && !dirty ? <SummaryCards summary={summary} /> : null}
      {report ? (
        <div className="fr-revisions">
          <button
            type="button"
            className="fr-text-button"
            disabled={dirty || busy}
            onClick={() => void loadRevisions()}
          >
            View revision history
          </button>
          {revisions.length ? (
            <select
              aria-label="Report revision"
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
      ) : null}
      {revision ? (
        <p className="fr-notice">
          Viewing a preserved revision by {revision.authorName}.
          {revision.reason ? ` Correction reason: ${revision.reason}` : ''}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="fr-report-fields">
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
      {summary && !dirty ? (
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
              disabled={busy}
              onClick={() => void save()}
            >
              Save draft
            </button>
            <button
              type="button"
              className="fr-primary"
              disabled={busy || dirty || !report || !!summary?.issues.length}
              onClick={() => setClosing(true)}
            >
              Review & close shift
            </button>
          </div>
        </div>
      ) : null}
      {closing && !readOnly ? (
        <div className="fr-close-confirm" role="region" aria-label="Confirm shift closure">
          <h3>Close the {shift.toLowerCase()} shift?</h3>
          <p>
            The submitted readings, attendant names and {summary?.flagged ?? 0} discrepancies will
            be preserved. This shift will count toward the daily report.
          </p>
          <div className="fr-actions">
            <button type="button" className="fr-secondary" onClick={() => setClosing(false)}>
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
