'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DocumentArtifactButton, DocumentPrintButton } from '@/components/documents';
import { backendGet } from '@/lib/api-client';
import { Card, PageSpinner } from '@/components/ui';
import { splitLinesForPrint } from './page-budget';

/**
 * Quotation print sheet.
 *
 * Laid out in absolute print units (mm / pt) rather than through DocumentShell,
 * for the same reason the supplier order draft is: screen pixels and printed
 * millimetres disagree, and a document that must fit a known page cannot be laid
 * out in units that only resolve at print time. Everything here is measurable
 * before it is printed, which is what makes the row budget below a calculation
 * rather than a guess.
 *
 * Page 1 is always a COMPLETE quotation - letterhead, parties, totals, terms and
 * signatures. Only surplus line rows move to a continuation sheet. The customer
 * should never have to turn over to find the price or somewhere to sign.
 */

interface QuotationLine {
  id: string;
  description?: string | null;
  itemName?: string | null;
  unitLabel?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  lineTotal?: number | string | null;
  product?: { name?: string | null; sku?: string | null; productCode?: string | null } | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  validUntil?: string | null;
  quotationType: string;
  customerName?: string | null;
  status: string;
  currency: string;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  notes?: string | null;
  company?: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    logoUrl?: string | null;
    group?: { name?: string | null; address?: string | null; phone?: string | null } | null;
    profile?: {
      registeredName?: string | null;
      tradingName?: string | null;
      tin?: string | null;
      vrn?: string | null;
      registeredAddress?: string | null;
    } | null;
  } | null;
  branch?: { name?: string | null; address?: string | null; phone?: string | null } | null;
  customer?: {
    name?: string | null;
    customerCode?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    contactPerson?: string | null;
  } | null;
  lines?: QuotationLine[];
}

export default function QuotationPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [record, setRecord] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    backendGet<Quotation>(`/westsides/quotations/${id}`)
      .then(setRecord)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (error) return <ErrorCard message={error} />;
  if (!record) return null;

  const lines = record.lines ?? [];
  const currency = record.currency || 'TZS';
  const hasNotes = Boolean(record.notes?.trim());

  // Drop money columns that are zero on every line. Two dead columns cost about a
  // fifth of the table width - width the item name needs, and a wrapped item name
  // is what turns a 6.2mm row into a 12mm one. The totals still state both.
  const showDiscount = lines.some((line) => Number(line.discountAmount ?? 0) !== 0);
  const showTax = lines.some((line) => Number(line.taxAmount ?? 0) !== 0);

  const { capacity, firstPageLines, overflowLines } = splitLinesForPrint(lines, hasNotes);
  const pageCount = overflowLines.length ? 2 : 1;

  const company = record.company;
  const companyName = company?.profile?.registeredName || company?.name || 'Company';
  const customerName = record.customer?.name ?? record.customerName ?? 'N/A';

  const columns = ['#', 'Item', 'Code', 'Qty', 'Unit', 'Unit Price'];
  if (showDiscount) columns.push('Discount');
  if (showTax) columns.push('Tax');
  columns.push('Amount');

  return (
    <div className="document-print-root min-h-full bg-slate-100 px-4 py-5 text-slate-900">
      <div className="document-no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-medium text-slate-700">
          Quotation preview
          <span className="ml-2 text-[12px] font-normal text-slate-500">
            {pageCount === 1
              ? 'Fits one page'
              : `Page 1 is complete; ${overflowLines.length} further item(s) continue overleaf`}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/westsides/quotations"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Back to List
          </Link>
          <DocumentArtifactButton entityType="QUOTATION" entityId={record.id} />
          <DocumentPrintButton />
        </div>
      </div>

      <article className="document-page quotation-sheet mx-auto w-full max-w-[210mm] bg-white px-[12mm] py-[12mm] text-slate-950 shadow-sm ring-1 ring-slate-200">
        <Letterhead company={company} companyName={companyName} branch={record.branch} />

        <div className="mt-[4mm] flex items-end justify-between border-b-2 border-slate-950 pb-[2mm]">
          <div>
            <h1 className="text-[20pt] font-bold uppercase leading-none tracking-tight">
              Quotation
            </h1>
            <div className="mt-[1.5mm] text-[8pt] uppercase tracking-wide text-slate-600">
              {labelise(record.quotationType)}
            </div>
          </div>
          <div className="text-right text-[8pt] leading-snug">
            <div className="text-[12pt] font-bold">{record.quotationNumber}</div>
            <div className="text-slate-600">Date: {formatDate(record.quotationDate)}</div>
            <div className="font-semibold">Valid until: {formatDate(record.validUntil)}</div>
          </div>
        </div>

        <section className="mt-[3mm] grid grid-cols-2 gap-[6mm] text-[8pt] leading-snug">
          <div>
            <div className="mb-[1mm] text-[7pt] font-bold uppercase tracking-wider text-slate-500">
              Quotation For
            </div>
            <div className="text-[10pt] font-bold">{customerName}</div>
            {record.customer?.customerCode && (
              <div className="text-slate-600">Code: {record.customer.customerCode}</div>
            )}
            {record.customer?.address && <div>{record.customer.address}</div>}
            <div className="text-slate-700">
              {[record.customer?.phone, record.customer?.email].filter(Boolean).join('  |  ')}
            </div>
            {record.customer?.contactPerson && (
              <div className="text-slate-600">Attn: {record.customer.contactPerson}</div>
            )}
          </div>
          <div>
            <div className="mb-[1mm] text-[7pt] font-bold uppercase tracking-wider text-slate-500">
              Terms
            </div>
            <DetailRow label="Currency" value={currency} />
            <DetailRow label="Status" value={labelise(record.status)} />
            <DetailRow label="Items" value={String(lines.length)} />
            <DetailRow
              label="Prepared"
              value={generatedAt.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            />
          </div>
        </section>

        {lines.length > 0 ? (
          <>
            <LineTable
              columns={columns}
              lines={firstPageLines}
              startIndex={0}
              currency={currency}
              showDiscount={showDiscount}
              showTax={showTax}
            />

            <div className="mt-[3mm] flex items-start justify-between gap-[6mm]">
              <div className="flex-1 text-[7.5pt] leading-snug text-slate-600">
                {overflowLines.length > 0 && (
                  <div className="mb-[2mm] font-semibold text-slate-900">
                    {overflowLines.length} further item(s) are listed on the continuation sheet. The
                    totals below cover every item quoted.
                  </div>
                )}
                {hasNotes && (
                  <div>
                    <div className="mb-[0.8mm] text-[7pt] font-bold uppercase tracking-wider text-slate-500">
                      Terms &amp; Notes
                    </div>
                    <p className="whitespace-pre-line">{record.notes}</p>
                  </div>
                )}
              </div>
              <div className="w-[68mm] shrink-0 text-[8pt]">
                <TotalRow label="Subtotal" value={money(record.subtotal, currency)} />
                {Number(record.discountAmount ?? 0) !== 0 && (
                  <TotalRow label="Discount" value={money(record.discountAmount, currency)} />
                )}
                {Number(record.taxAmount ?? 0) !== 0 && (
                  <TotalRow label="Tax" value={money(record.taxAmount, currency)} />
                )}
                <div className="mt-[1mm] flex items-center justify-between border-t-2 border-slate-950 bg-slate-100 px-[2mm] py-[1.5mm]">
                  <span className="text-[9pt] font-bold uppercase">Total</span>
                  <span className="text-[11pt] font-bold tabular-nums">
                    {money(record.totalAmount, currency)}
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="mt-[6mm] text-[9pt] italic text-slate-500">
            No line items are attached to this quotation.
          </p>
        )}

        <section className="mt-[6mm] grid grid-cols-2 gap-[10mm] text-[8pt]">
          {['Issued By', 'Customer Acceptance'].map((label) => (
            <div key={label}>
              <div className="h-[9mm] border-b border-slate-500" />
              <div className="mt-[1mm] uppercase tracking-wide text-slate-600">{label}</div>
              <div className="mt-[0.5mm] text-[7pt] text-slate-400">Name, signature and date</div>
            </div>
          ))}
        </section>

        <DocumentFooter company={company} pageNumber={1} pageCount={pageCount} />
      </article>

      {overflowLines.length > 0 && (
        <article className="document-page quotation-sheet quotation-continuation mx-auto mt-4 w-full max-w-[210mm] bg-white px-[12mm] py-[12mm] text-slate-950 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-end justify-between border-b border-slate-950 pb-[2mm]">
            <div className="text-[11pt] font-bold uppercase">Line Items (continued)</div>
            <div className="text-[8pt] text-slate-600">
              {record.quotationNumber} &nbsp;|&nbsp; {customerName}
            </div>
          </div>
          <LineTable
            columns={columns}
            lines={overflowLines}
            startIndex={capacity}
            currency={currency}
            showDiscount={showDiscount}
            showTax={showTax}
          />
          <div className="mt-[3mm] text-[7.5pt] text-slate-600">
            Totals for all {lines.length} items are stated on page 1.
          </div>
          <DocumentFooter company={company} pageNumber={2} pageCount={pageCount} />
        </article>
      )}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Letterhead({
  company,
  companyName,
  branch,
}: {
  company: Quotation['company'];
  companyName: string;
  branch: Quotation['branch'];
}) {
  const profile = company?.profile;
  const address = profile?.registeredAddress || branch?.address || company?.group?.address;
  const contacts = [company?.phone || branch?.phone, company?.email, company?.website]
    .filter(Boolean)
    .join('  |  ');
  const registry = [
    profile?.tin ? `TIN: ${profile.tin}` : null,
    profile?.vrn ? `VRN: ${profile.vrn}` : null,
  ]
    .filter(Boolean)
    .join('  |  ');

  return (
    <header className="flex items-start gap-[4mm]">
      {company?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logoUrl} alt="" className="h-[18mm] w-[18mm] flex-none object-contain" />
      ) : (
        <div className="flex h-[18mm] w-[18mm] flex-none items-center justify-center border border-slate-900 text-[13pt] font-bold">
          {companyName.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1 leading-snug">
        {company?.group?.name && (
          <div className="text-[8pt] font-bold uppercase tracking-[0.18em] text-slate-500">
            {company.group.name}
          </div>
        )}
        <div className="text-[13pt] font-bold uppercase leading-tight">{companyName}</div>
        {branch?.name && (
          <div className="text-[8pt] uppercase tracking-wide text-slate-600">{branch.name}</div>
        )}
        {address && <div className="mt-[0.8mm] text-[7.5pt] text-slate-700">{address}</div>}
        {contacts && <div className="text-[7.5pt] text-slate-700">{contacts}</div>}
        {registry && <div className="text-[7.5pt] font-medium text-slate-700">{registry}</div>}
      </div>
    </header>
  );
}

function LineTable({
  columns,
  lines,
  startIndex,
  currency,
  showDiscount,
  showTax,
}: {
  columns: string[];
  lines: QuotationLine[];
  startIndex: number;
  currency: string;
  showDiscount: boolean;
  showTax: boolean;
}) {
  const numeric = new Set(['Qty', 'Unit Price', 'Discount', 'Tax', 'Amount']);
  return (
    <table className="quotation-table mt-[3mm] w-full border-collapse text-[7.5pt]">
      <thead>
        <tr className="bg-slate-100">
          {columns.map((column) => (
            <th
              key={column}
              className={`border border-slate-400 px-[1.2mm] py-[1.2mm] text-[6.8pt] font-bold uppercase tracking-wide ${
                numeric.has(column) ? 'text-right' : 'text-left'
              } ${column === '#' ? 'w-[6mm]' : ''} ${column === 'Item' ? 'w-[38%]' : ''}`}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={line.id} className="quotation-row">
            <Cell>{startIndex + index + 1}</Cell>
            <Cell align="left">
              {line.itemName || line.product?.name || line.description || 'N/A'}
            </Cell>
            <Cell align="left" muted>
              {line.product?.sku ?? line.product?.productCode ?? '-'}
            </Cell>
            <Cell align="right">{formatQty(line.quantity)}</Cell>
            <Cell align="left">
              {line.unit?.symbol ?? line.unit?.name ?? line.unitLabel ?? '-'}
            </Cell>
            <Cell align="right">{money(line.unitPrice, currency, true)}</Cell>
            {showDiscount && (
              <Cell align="right">{money(line.discountAmount, currency, true)}</Cell>
            )}
            {showTax && <Cell align="right">{money(line.taxAmount, currency, true)}</Cell>}
            <Cell align="right" bold>
              {money(line.lineTotal, currency, true)}
            </Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cell({
  children,
  align = 'center',
  muted,
  bold,
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
  muted?: boolean;
  bold?: boolean;
}) {
  const alignClass =
    align === 'right' ? 'text-right tabular-nums' : align === 'left' ? 'text-left' : 'text-center';
  return (
    <td
      className={`border border-slate-300 px-[1.2mm] py-[1mm] align-top ${alignClass} ${
        muted ? 'text-slate-500' : ''
      } ${bold ? 'font-semibold' : ''}`}
    >
      {children}
    </td>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-dotted border-slate-300 py-[0.6mm]">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-200 px-[2mm] py-[1mm]">
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function DocumentFooter({
  company,
  pageNumber,
  pageCount,
}: {
  company: Quotation['company'];
  pageNumber: number;
  pageCount: number;
}) {
  return (
    <footer className="mt-[4mm] flex justify-between border-t border-slate-300 pt-[1.5mm] text-[6.8pt] text-slate-500">
      <span>{company?.website || company?.email || ''}</span>
      <span>
        Page {pageNumber} of {pageCount}
      </span>
    </footer>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="p-6">
      <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</Card>
    </div>
  );
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function labelise(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatQty(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(
    Number.isFinite(n) ? n : 0,
  );
}

/**
 * `bare` drops the currency code inside the table, where the Terms block and the
 * totals already establish it and repeating it on every row wastes the width the
 * item name needs.
 */
function money(value: number | string | null | undefined, currency: string, bare = false) {
  const n = Number(value ?? 0);
  const amount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return bare ? amount : `${currency} ${amount}`;
}
