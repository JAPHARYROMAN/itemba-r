'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from '@/components/ui';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { FormSection } from '@/components/aurora';
import type { WorkspaceDraft } from '@/components/workspace/workspace-drafts';
import { backendPost } from '@/lib/api-client';
import { downloadTextFile } from '@/lib/report-export';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { parseStatementCsv, type StatementRow } from './statement-csv';
import {
  AccountingAcknowledgement,
  AccountingReviewShell,
  useAccountingReview,
} from './accounting-review-form';
import {
  reconciliationVersion,
  statementPreview,
  type Reconciliation,
  type ReconciliationEvidence,
} from './reconciliation-types';

export function StatementChecks({ id, revision }: { id: string; revision: string }) {
  const { hasPermission } = useAuth();
  const evidence = useWorkspaceResource<ReconciliationEvidence>(
    `/bank-reconciliations/${encodeURIComponent(id)}/evidence`,
    {},
    hasPermission('bank_reconciliations.view'),
  );
  const seen = useRef(revision),
    reload = evidence.reload;
  useEffect(() => {
    if (seen.current !== revision) {
      seen.current = revision;
      reload();
    }
  }, [revision, reload]);
  return (
    <section className="reconciliation-checks" aria-label="Statement approval checks">
      <header>
        <h3>Approval checks</h3>
        <Btn type="button" variant="ghost" onClick={evidence.reload}>
          Refresh checks
        </Btn>
      </header>
      {evidence.loading ? (
        <p role="status">Checking statement and journal matches…</p>
      ) : evidence.error ? (
        <p role="alert">{evidence.error}</p>
      ) : (
        evidence.data && (
          <>
            <strong>
              {evidence.data.ready
                ? 'Statement and matching checks passed'
                : 'Resolve before approval'}
            </strong>
            {!!evidence.data.issues.length && (
              <ul>
                {evidence.data.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <p>{evidence.data.note}</p>
          </>
        )
      )}
    </section>
  );
}
export function StatementImport({
  id,
  source,
  close,
  done,
}: {
  id: string;
  source?: WorkspaceDraft;
  close: () => void;
  done: (message: string) => void;
}) {
  const { hasPermission } = useAuth();
  const [reading, setReading] = useState(false),
    [fileError, setFileError] = useState(''),
    [page, setPage] = useState(1);
  const fileRequest = useRef({ sequence: 0 }),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const requests = fileRequest.current;
    return () => {
      mounted.current = false;
      requests.sequence++;
    };
  }, []);
  const form = useAccountingReview<Reconciliation, { filename: string; rows: StatementRow[] }>({
    path: `/bank-reconciliations/${encodeURIComponent(id)}`,
    readAllowed: hasPermission('bank_reconciliations.view'),
    writeAllowed: hasPermission('bank_reconciliations.update'),
    busy: reading,
    allowChangedRetry: true,
    initial: { filename: '', rows: [] },
    title: 'Statement CSV import',
    summary: (row) => row?.reconciliationNumber || '',
    context: { kind: 'reconciliation-import', recordId: id },
    version: reconciliationVersion,
    source,
    close,
    done,
  });
  const { filename, rows } = form.draft.form;
  const summary = useMemo(() => statementPreview(rows), [rows]);
  const outside = rows.filter(
    (row) =>
      form.data &&
      (row.transactionDate < form.data.statementStartDate.slice(0, 10) ||
        row.transactionDate > form.data.statementEndDate.slice(0, 10)),
  ).length;
  const pages = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pages);
  async function choose(file?: File) {
    if (!file) return;
    const request = ++fileRequest.current.sequence;
    setReading(true);
    setFileError('');
    form.setAck(false);
    try {
      if (file.size > 2_000_000) throw new Error('Choose a CSV smaller than 2 MB.');
      const parsed = parseStatementCsv(await file.text());
      if (!mounted.current || request !== fileRequest.current.sequence) return;
      form.draft.guard.change(() => form.draft.setForm({ filename: file.name, rows: parsed }));
      setPage(1);
      form.setAck(false);
    } catch (error) {
      if (mounted.current && request === fileRequest.current.sequence)
        setFileError(error instanceof Error ? error.message : 'Unable to read this CSV.');
    } finally {
      if (mounted.current && request === fileRequest.current.sequence) setReading(false);
    }
  }
  return (
    <AccountingReviewShell
      form={form}
      title="Import statement CSV"
      subtitle={form.data?.reconciliationNumber || source?.summary}
      action={`Import ${rows.length} lines`}
      disabled={!rows.length || !!outside || form.data?.status !== 'DRAFT'}
      onSubmit={() =>
        void form.submit(
          (row) => {
            if (row.id !== id || row.status !== 'DRAFT')
              throw new Error('Only a current draft reconciliation can receive statement lines.');
            if (!rows.length || outside)
              throw new Error('Choose a valid CSV with dates inside this statement period.');
          },
          async () => {
            const result = await backendPost<{ imported: number; skipped: number }>(
              `/bank-reconciliations/${encodeURIComponent(id)}/import`,
              { rows },
            );
            return `${result.imported} lines imported; ${result.skipped} exact duplicate lines skipped.`;
          },
        )
      }
    >
      {form.data && (
        <>
          <FormSection title="Statement file">
            <p>
              {form.data.statementStartDate.slice(0, 10)} –{' '}
              {form.data.statementEndDate.slice(0, 10)} · {form.data.currency}
            </p>
            <p>
              CSV columns: date,description,reference,debit,credit. Use YYYY-MM-DD dates. Debit
              means money out; credit means money in.
            </p>
            <label className="reconciliation-file">
              Choose statement CSV
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={form.busy || !form.writeAllowed || form.data.status !== 'DRAFT'}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void choose(file);
                }}
              />
            </label>
            <Btn
              type="button"
              variant="secondary"
              onClick={() =>
                downloadTextFile(
                  'statement-template.csv',
                  'text/csv;charset=utf-8',
                  'date,description,reference,debit,credit\n',
                )
              }
            >
              Download CSV template
            </Btn>
            {reading && <p role="status">Reading statement CSV…</p>}
            {fileError && (
              <p role="alert" className="workspace-notice">
                {fileError}
                {rows.length ? ' Your previous valid file is still here.' : ''}
              </p>
            )}
            {form.data.status !== 'DRAFT' && (
              <p role="alert" className="workspace-notice">
                This reconciliation is {form.data.status.toLowerCase()}. Its statement lines cannot
                be changed.
              </p>
            )}
            {!form.writeAllowed && (
              <p role="alert">Your role can review this statement but cannot import lines.</p>
            )}
          </FormSection>
          {!!rows.length && (
            <FormSection title="Review every line">
              <p>
                <strong>{filename}</strong> · {rows.length} lines · {summary.duplicates} repeated
                lines within this file
              </p>
              <p>
                File totals · Debit {summary.debit} · Credit {summary.credit} · {form.data.currency}
              </p>
              {!!outside && (
                <p role="alert" className="workspace-notice">
                  {outside} lines fall outside this statement period. Correct the file before
                  importing.
                </p>
              )}
              <WorkspaceTable label="Statement CSV preview">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Reference</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((currentPage - 1) * 25, currentPage * 25).map((row, index) => (
                    <tr key={index}>
                      <td>{row.transactionDate}</td>
                      <td>{row.description}</td>
                      <td>{row.reference || '—'}</td>
                      <td>{row.debitAmount}</td>
                      <td>{row.creditAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </WorkspaceTable>
              <nav className="reconciliation-pagination" aria-label="CSV preview pages">
                <Btn
                  type="button"
                  variant="secondary"
                  disabled={currentPage === 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Previous lines
                </Btn>
                <span>
                  Page {currentPage} of {pages}
                </span>
                <Btn
                  type="button"
                  variant="secondary"
                  disabled={currentPage === pages}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Next lines
                </Btn>
              </nav>
              <p>
                Exact duplicate dates, descriptions, references and amounts are skipped, including
                rows already on this statement. Separate identical transactions need distinct
                references. File totals include repeated rows and may differ from the totals
                actually imported.
              </p>
              <AccountingAcknowledgement
                label="I reviewed these lines, their debit/credit direction and their statement period."
                checked={form.ack}
                disabled={form.busy}
                onChange={form.setAck}
              />
            </FormSection>
          )}
        </>
      )}
    </AccountingReviewShell>
  );
}
