'use client';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { Btn } from '@/components/ui';
import { money, type Summary } from './types';
import { useRecordBookRefresh } from './record-book-refresh';

type DailySummary = { salesCount: number; expenseCount: number; draftRecords: number };
export function RecordsOverview({
  canBook,
  canNotebook,
}: {
  canBook: boolean;
  canNotebook: boolean;
}) {
  const daily = useWorkspaceResource<DailySummary>('/record-book/summary', {}, canBook);
  const notebook = useWorkspaceResource<Summary[]>('/records/summary', {}, canNotebook);
  useRecordBookRefresh(daily.reload, !canBook);
  return (
    <main className="records-main records-home">
      <header className="records-header">
        <div>
          <span className="records-eyebrow">YOUR RECORDS, TOGETHER</span>
          <h1>A clear place to keep track.</h1>
          <p>Daily activity, people you owe, people who owe you, and useful notes.</p>
        </div>
      </header>
      {canBook && (
        <section className="records-home-panel" aria-labelledby="records-daily-title">
          <div className="records-home-heading">
            <div>
              <h2 id="records-daily-title">Daily records</h2>
              <p>Your existing daily sales, receipt breakdowns and money out from ITEMBA-R.</p>
            </div>
            <Link href="/records/daily-summary">Open daily overview →</Link>
          </div>
          {daily.error ? (
            <div role="alert">
              <p>Daily records could not be loaded.</p>
              <Btn variant="secondary" onClick={daily.reload}>
                Retry daily records
              </Btn>
            </div>
          ) : !daily.data ? (
            <p role="status">Loading daily records…</p>
          ) : (
            <dl className="records-home-counts">
              <div>
                <dt>Daily sales</dt>
                <dd>{daily.data.salesCount}</dd>
              </div>
              <div>
                <dt>Money out</dt>
                <dd>{daily.data.expenseCount}</dd>
              </div>
              <div>
                <dt>Drafts to finish</dt>
                <dd>{daily.data.draftRecords}</dd>
              </div>
            </dl>
          )}
          <div className="records-home-links">
            <Link href="/records/daily-sales">Daily sales</Link>
            <Link href="/records/money-out">Money out</Link>
            <Link href="/records/reports">Reports & exports</Link>
          </div>
        </section>
      )}
      {canNotebook && (
        <section className="records-home-panel" aria-labelledby="records-notebook-title">
          <div className="records-home-heading">
            <div>
              <h2 id="records-notebook-title">Your notebook</h2>
              <p>
                Debts, individual transactions and notes, with their own balances and statements.
              </p>
            </div>
            <Link href="/records/notebook?view=overview">Open notebook →</Link>
          </div>
          {notebook.error ? (
            <div role="alert">
              <p>Your notebook could not be loaded.</p>
              <Btn variant="secondary" onClick={notebook.reload}>
                Retry notebook
              </Btn>
            </div>
          ) : !notebook.data ? (
            <p role="status">Loading notebook…</p>
          ) : (
            <>
              <dl className="records-home-counts">
                <div>
                  <dt>Entries</dt>
                  <dd>{notebook.data.reduce((total, row) => total + row.count, 0)}</dd>
                </div>
                <div>
                  <dt>Debtors</dt>
                  <dd>
                    {notebook.data
                      .filter((row) => row.kind === 'DEBTOR')
                      .reduce((total, row) => total + row.count, 0)}
                  </dd>
                </div>
                <div>
                  <dt>Creditors</dt>
                  <dd>
                    {notebook.data
                      .filter((row) => row.kind === 'CREDITOR')
                      .reduce((total, row) => total + row.count, 0)}
                  </dd>
                </div>
              </dl>
              {notebook.data
                .filter((row) => row.kind === 'DEBTOR' || row.kind === 'CREDITOR')
                .map((row) => (
                  <p className="records-home-balance" key={`${row.kind}:${row.currency}`}>
                    <span>{row.kind === 'DEBTOR' ? 'Owed to you' : 'You owe'}</span>
                    <strong>{money(row.balance, row.currency)}</strong>
                  </p>
                ))}
            </>
          )}
          <div className="records-home-links">
            <Link href="/records?view=debtors">Debtors & statements</Link>
            <Link href="/records?view=creditors">Creditors & payments</Link>
            <Link href="/records?view=notes">Notes</Link>
          </div>
        </section>
      )}
      <p className="records-home-note">
        Daily records and notebook entries keep their own totals. Choose the register that fits the
        record, and enter it once.
      </p>
    </main>
  );
}
