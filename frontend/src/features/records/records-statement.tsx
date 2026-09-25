'use client';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Btn, FormDateField } from '@/components/ui';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { backendBinaryGet } from '@/lib/api-client';
import { dateLabel, Entry, localToday, money } from './types';

export type Statement = {
  from: string | null;
  to: string;
  startsOn: string | null;
  balanceSide: string;
  openingBalance: string;
  closingBalance: string;
  totalDebit: string;
  totalCredit: string;
  rows: {
    id: string;
    date: string;
    description: string;
    reference: string | null;
    debit: string;
    credit: string;
    balance: string;
  }[];
};
export function RecordsStatement({ entry, canExport }: { entry: Entry; canExport: boolean }) {
  const [from, setFrom] = useState(''),
    [to, setTo] = useState(localToday);
  const [exporting, setExporting] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const invalid = !!from && !!to && from > to;
  const path = `/records/${entry.id}/statement`;
  const statement = useWorkspaceResource<Statement>(
    path,
    { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    !invalid,
  );
  const { reload } = statement;
  useEffect(() => {
    reload();
  }, [entry.version, reload]);
  async function download(format: 'pdf' | 'csv') {
    setExporting(format);
    setError('');
    setNotice('');
    try {
      const query = new URLSearchParams({
        format,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      const { blob } = await backendBinaryGet(`${path}/export?${query}`);
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `records-${entry.kind.toLowerCase()}-statement-${entry.id.slice(0, 8)}-${to || localToday()}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`${format.toUpperCase()} statement export started.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to export statement.');
    } finally {
      setExporting('');
    }
  }
  const s = statement.data;
  const amount = (v: string) =>
    Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section className="records-statement" aria-label="Account statement">
      <div className="records-statement-heading">
        <div>
          <h3>Account statement</h3>
          <p>
            {entry.kind === 'DEBTOR'
              ? 'Debits add debt. Credits record money received or reductions.'
              : 'Credits add debt. Debits record money paid or reductions.'}
          </p>
        </div>
      </div>
      <div className="records-fields">
        <FormDateField label="Statement from" value={from} onChange={setFrom} />
        <FormDateField label="Statement to" value={to} onChange={setTo} />
      </div>
      {canExport && (
        <div className="records-actions">
          <Btn
            variant="secondary"
            disabled={!!exporting || invalid || statement.loading || !!statement.error || !s}
            onClick={() => download('pdf')}
            loading={exporting === 'pdf'}
          >
            <Download size={16} /> Export PDF
          </Btn>
          <Btn
            variant="ghost"
            disabled={!!exporting || invalid || statement.loading || !!statement.error || !s}
            onClick={() => download('csv')}
            loading={exporting === 'csv'}
          >
            Export statement CSV
          </Btn>
        </div>
      )}
      {(invalid || statement.error || error) && (
        <p role="alert" className="records-error">
          {invalid ? 'Start date must be on or before end date.' : statement.error || error}
        </p>
      )}
      {statement.error && !invalid && (
        <Btn variant="ghost" onClick={reload}>
          Retry statement
        </Btn>
      )}
      {notice && <p role="status">{notice}</p>}
      {statement.loading ? (
        <p role="status">Loading statement…</p>
      ) : (
        !invalid &&
        !statement.error &&
        s && (
          <>
            {s.startsOn && (
              <p className="records-callout">
                Opening balance brought forward on {dateLabel(s.startsOn)}. Earlier payments remain
                in payment history below.
              </p>
            )}
            <div className="records-statement-balances">
              <div>
                <span>Opening balance</span>
                <strong>{money(s.openingBalance, entry.currency)}</strong>
              </div>
              <div>
                <span>Closing balance · {s.balanceSide}</span>
                <strong>{money(s.closingBalance, entry.currency)}</strong>
              </div>
            </div>
            <p className="records-scope-note">
              Scroll across the table for debit, credit and balance. You can also focus the table
              and use the arrow keys.
            </p>
            <div
              className="records-statement-scroll"
              tabIndex={0}
              role="region"
              aria-label="Statement transactions, scroll horizontally for amounts"
            >
              <table>
                <caption>
                  {entry.counterparty} · {entry.currency} · {dateLabel(s.to)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Activity</th>
                    <th scope="col">Debit</th>
                    <th scope="col">Credit</th>
                    <th scope="col">Balance ({s.balanceSide})</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{s.from ? dateLabel(s.from) : 'Beginning'}</td>
                    <td>Opening balance</td>
                    <td>—</td>
                    <td>—</td>
                    <td>{amount(s.openingBalance)}</td>
                  </tr>
                  {s.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{dateLabel(r.date)}</td>
                      <td>
                        {r.description}
                        {r.reference && <small>{r.reference}</small>}
                      </td>
                      <td>{r.debit === '0.00' ? '—' : amount(r.debit)}</td>
                      <td>{r.credit === '0.00' ? '—' : amount(r.credit)}</td>
                      <td>{amount(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>
                      Closing balance
                    </th>
                    <td>{amount(s.totalDebit)}</td>
                    <td>{amount(s.totalCredit)}</td>
                    <td>{amount(s.closingBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {!s.rows.length && <p>No movements in this period.</p>}
            <p className="records-scope-note">
              This statement covers this debt and its payments. Export the PDF for a letterhead copy
              you can print or share.
            </p>
          </>
        )
      )}
    </section>
  );
}
