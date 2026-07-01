'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormSelect,
  PageHeader,
  PermissionDeniedState,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendGet, backendList, backendPost } from '@/lib/api-client';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';

interface Company {
  id: string;
  name: string;
  code?: string | null;
}

interface Supplier {
  id: string;
  name: string;
  supplierCode?: string | null;
}

interface Rfq {
  id: string;
  rfqNumber?: string | null;
  title?: string | null;
  companyId: string;
}

interface SupplierQuotationLine {
  id: string;
  supplierQuotationId: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
  deliveryDays?: number | null;
}

interface SupplierQuotation {
  id: string;
  supplierQuotationNumber?: string | null;
  supplierId: string;
  rfqId?: string | null;
  companyId: string;
  totalAmount?: number | string | null;
  currency?: string | null;
  status?: string | null;
  lines?: SupplierQuotationLine[];
}

interface BidComparisonLine {
  id: string;
  bidComparisonId: string;
  supplierQuotationId: string;
  supplierId: string;
  totalAmount: number | string;
  deliveryScore?: number | string | null;
  priceScore?: number | string | null;
  qualityScore?: number | string | null;
  overallScore?: number | string | null;
  remarks?: string | null;
}

interface BidComparison {
  id: string;
  comparisonNumber: string;
  companyId: string;
  rfqId: string;
  title: string;
  comparisonDate: string;
  status: string;
  recommendedSupplierId?: string | null;
  recommendationReason?: string | null;
  approvedById?: string | null;
  approvedAt?: string | null;
  notes?: string | null;
  lines?: BidComparisonLine[];
}

const BID_STATUSES = ['DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const today = new Date().toISOString().slice(0, 10);

interface ListPayload<T> {
  items?: T[];
  data?: T[];
}

/**
 * Backend findAll endpoints for bid-comparisons / rfqs / supplier-quotations
 * return `{ items, total, ... }` (no `data` key). backendList → normalizePaginated
 * only reads `data`, so it yields []. Read `items` (with a `data` fallback) here.
 */
function listItems<T>(payload: ListPayload<T> | T[] | null | undefined): T[] {
  if (Array.isArray(payload)) return payload;
  return payload?.items ?? payload?.data ?? [];
}

function num(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(value: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(num(value))}`;
}

function fmtScore(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  return num(value).toFixed(1);
}

function companyLabel(company: Company | undefined) {
  if (!company) return '';
  return company.code ? `${company.code} - ${company.name}` : company.name;
}

function rfqLabel(rfq: Rfq | undefined, fallback: string) {
  if (!rfq) return fallback;
  const number = rfq.rfqNumber ?? rfq.id.slice(0, 8);
  return rfq.title ? `${number} - ${rfq.title}` : number;
}

function supplierLabel(supplier: Supplier | undefined, fallback: string) {
  if (!supplier) return fallback;
  return supplier.supplierCode ? `${supplier.supplierCode} - ${supplier.name}` : supplier.name;
}

export default function BidComparisonsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('bid_comparisons.list') || hasPermission('bid_comparisons.view');
  const canApprove = hasPermission('bid_comparisons.approve');

  const [rows, setRows] = useState<BidComparison[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [quotations, setQuotations] = useState<SupplierQuotation[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<BidComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canView) return;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then(setCompanies)
      .catch(() => setCompanies([]));
  }, [canView]);

  // Suppliers / RFQs / quotations for name resolution + the comparison matrix.
  useEffect(() => {
    if (!canView) return;
    const query: Record<string, string | number> = { limit: 300 };
    if (companyId) query.companyId = companyId;
    Promise.allSettled([
      backendList<Supplier>('/suppliers', { query }),
      backendGet<ListPayload<Rfq>>('/rfqs', { query }),
      backendGet<ListPayload<SupplierQuotation>>('/supplier-quotations', { query }),
    ]).then(([supplierResult, rfqResult, quotationResult]) => {
      setSuppliers(supplierResult.status === 'fulfilled' ? supplierResult.value : []);
      setRfqs(rfqResult.status === 'fulfilled' ? listItems(rfqResult.value) : []);
      setQuotations(quotationResult.status === 'fulfilled' ? listItems(quotationResult.value) : []);
    });
  }, [canView, companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const query: Record<string, string | number> = { limit: 100 };
      if (companyId) query.companyId = companyId;
      if (status) query.status = status;
      const payload = await backendGet<ListPayload<BidComparison>>('/bid-comparisons', { query });
      const items = listItems(payload);
      setRows(items);
      setSelected((prev) => (prev ? items.find((item) => item.id === prev.id) ?? null : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bid comparisons');
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const rfqById = useMemo(() => new Map(rfqs.map((r) => [r.id, r])), [rfqs]);
  const quotationById = useMemo(() => new Map(quotations.map((q) => [q.id, q])), [quotations]);

  const approvedCount = rows.filter((r) => r.status === 'APPROVED').length;
  const draftCount = rows.filter((r) => r.status === 'DRAFT').length;
  const awardedValue = rows.reduce((sum, r) => {
    if (!r.recommendedSupplierId) return sum;
    const line = (r.lines ?? []).find((l) => l.supplierId === r.recommendedSupplierId);
    return sum + num(line?.totalAmount);
  }, 0);

  // Build the side-by-side matrix for the selected comparison.
  const matrix = useMemo(() => {
    if (!selected) return null;
    const lines = selected.lines ?? [];
    // Columns = the suppliers quoted in this comparison, sorted best (lowest total) first.
    const columns = [...lines]
      .map((line) => {
        const quotation = quotationById.get(line.supplierQuotationId);
        return {
          line,
          quotation,
          supplier: supplierById.get(line.supplierId),
          supplierId: line.supplierId,
          total: num(line.totalAmount) || num(quotation?.totalAmount),
          currency: quotation?.currency ?? 'TZS',
        };
      })
      .sort((a, b) => a.total - b.total);

    const cheapestTotal = columns.reduce(
      (min, col) => (col.total > 0 && col.total < min ? col.total : min),
      Number.POSITIVE_INFINITY,
    );

    // Rows = distinct line-item descriptions across all supplier quotations in the comparison.
    const itemOrder: string[] = [];
    const seen = new Set<string>();
    for (const col of columns) {
      for (const ql of col.quotation?.lines ?? []) {
        const key = (ql.description ?? '').trim() || ql.id;
        if (!seen.has(key)) {
          seen.add(key);
          itemOrder.push(key);
        }
      }
    }

    const itemRows = itemOrder.map((key) => {
      const cells = columns.map((col) => {
        const match = (col.quotation?.lines ?? []).find(
          (ql) => ((ql.description ?? '').trim() || ql.id) === key,
        );
        return match ?? null;
      });
      const prices = cells
        .map((cell) => (cell ? num(cell.unitPrice) : Number.POSITIVE_INFINITY))
        .filter((p) => p > 0 && Number.isFinite(p));
      const lowestUnit = prices.length ? Math.min(...prices) : Number.POSITIVE_INFINITY;
      return { key, cells, lowestUnit };
    });

    return { columns, itemRows, cheapestTotal };
  }, [selected, quotationById, supplierById]);

  const exportCsv = () => {
    const data = rows.map((row) => {
      const recommended = row.recommendedSupplierId
        ? supplierLabel(supplierById.get(row.recommendedSupplierId), row.recommendedSupplierId)
        : '';
      return {
        'Comparison #': row.comparisonNumber,
        Title: row.title,
        Company: companyLabel(companyById.get(row.companyId)) || row.companyId,
        RFQ: rfqLabel(rfqById.get(row.rfqId), row.rfqId),
        Suppliers: (row.lines ?? []).length,
        'Recommended Supplier': recommended,
        Status: row.status,
        'Comparison Date': row.comparisonDate
          ? new Date(row.comparisonDate).toLocaleDateString('en-GB')
          : '',
        Approved: row.approvedAt ? 'Yes' : 'No',
      };
    });
    const csv = rowsToCsv(data);
    if (!csv) {
      showToast('error', 'Nothing to export');
      return;
    }
    downloadTextFile(`bid-comparisons-${today}.csv`, 'text/csv;charset=utf-8', csv);
    showToast('success', 'CSV exported');
  };

  const exportMatrixCsv = () => {
    if (!selected || !matrix || matrix.columns.length === 0) return;
    const header = ['Line Item', ...matrix.columns.map((c) => supplierLabel(c.supplier, c.supplierId))];
    const body: string[][] = [];
    for (const item of matrix.itemRows) {
      const label =
        matrix.columns
          .map((c) => (c.quotation?.lines ?? []).find((ql) => ((ql.description ?? '').trim() || ql.id) === item.key))
          .find(Boolean)?.description ?? item.key;
      body.push([label, ...item.cells.map((cell) => (cell ? String(num(cell.unitPrice)) : '—'))]);
    }
    body.push(['Total', ...matrix.columns.map((c) => String(c.total))]);
    body.push(['Price Score', ...matrix.columns.map((c) => fmtScore(c.line.priceScore))]);
    body.push(['Delivery Score', ...matrix.columns.map((c) => fmtScore(c.line.deliveryScore))]);
    body.push(['Quality Score', ...matrix.columns.map((c) => fmtScore(c.line.qualityScore))]);
    body.push(['Overall Score', ...matrix.columns.map((c) => fmtScore(c.line.overallScore))]);
    const escape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const csv = [header, ...body].map((r) => r.map(escape).join(',')).join('\n');
    downloadTextFile(`bid-comparison-matrix-${selected.comparisonNumber}.csv`, 'text/csv;charset=utf-8', csv);
    showToast('success', 'Matrix exported');
  };

  const approve = async (row: BidComparison) => {
    setApproving(true);
    setError('');
    try {
      const updated = await backendPost<BidComparison>(`/bid-comparisons/${row.id}/approve`);
      if (updated) setSelected(updated);
      showToast('success', 'Comparison approved');
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approve failed';
      setError(message);
      showToast('error', 'Approve failed', message);
    } finally {
      setApproving(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Bid Comparisons" subtitle="Compare supplier quotations and award RFQs" />
        <div className="mt-6">
          <PermissionDeniedState description="You do not have permission to view bid comparisons." />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Bid Comparisons" subtitle="Compare supplier quotations side-by-side and award RFQs" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Comparisons" value={rows.length} />
        <StatCard label="Drafts" value={draftCount} />
        <StatCard label="Approved" value={approvedCount} />
        <StatCard label="Awarded Value" value={fmtMoney(awardedValue)} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_190px_auto] gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="All companies">
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{companyLabel(company)}</option>
            ))}
          </FormSelect>
          <FormSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {BID_STATUSES.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </FormSelect>
          <Btn variant="secondary" onClick={exportCsv} disabled={rows.length === 0} aria-label="Export comparisons to CSV">
            Export CSV
          </Btn>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-4"><SkeletonTable rows={6} cols={5} /></div>
          ) : rows.length === 0 ? (
            <EmptyState title="No comparisons" description="No bid comparisons were found for the current filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Bid comparisons summary</caption>
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th scope="col" className="px-4 py-3">Comparison</th>
                    <th scope="col" className="px-4 py-3">RFQ</th>
                    <th scope="col" className="px-4 py-3 text-right">Bids</th>
                    <th scope="col" className="px-4 py-3">Recommended</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isSelected = selected?.id === row.id;
                    return (
                      <tr
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Review comparison ${row.comparisonNumber}`}
                        aria-pressed={isSelected}
                        onClick={() => setSelected(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(row);
                          }
                        }}
                        className={`border-t cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 ${isSelected ? 'bg-slate-50' : ''}`}
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{row.comparisonNumber}</div>
                          <div className="text-xs font-medium">{row.title}</div>
                          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                            {row.comparisonDate ? new Date(row.comparisonDate).toLocaleDateString('en-GB') : '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3">{rfqLabel(rfqById.get(row.rfqId), row.rfqId)}</td>
                        <td className="px-4 py-3 text-right font-mono">{(row.lines ?? []).length}</td>
                        <td className="px-4 py-3">
                          {row.recommendedSupplierId
                            ? supplierLabel(supplierById.get(row.recommendedSupplierId), row.recommendedSupplierId)
                            : <span style={{ color: 'var(--aurora-text-muted)' }}>—</span>}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              Select a comparison to review the side-by-side supplier matrix and award the RFQ.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{selected.title}</div>
                  <div className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{selected.comparisonNumber}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>
                    {rfqLabel(rfqById.get(selected.rfqId), selected.rfqId)} · {companyLabel(companyById.get(selected.companyId)) || selected.companyId}
                  </div>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              {matrix && matrix.columns.length > 0 ? (
                <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--aurora-border)' }}>
                  <table className="w-full text-sm">
                    <caption className="sr-only">Side-by-side supplier quotation comparison for {selected.title}</caption>
                    <thead>
                      <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                        <th scope="col" className="px-3 py-2">Line Item</th>
                        {matrix.columns.map((col) => {
                          const isRecommended = selected.recommendedSupplierId === col.supplierId;
                          return (
                            <th scope="col" key={col.line.id} className="px-3 py-2 text-right whitespace-nowrap">
                              <span className={isRecommended ? 'text-emerald-700' : ''}>
                                {supplierLabel(col.supplier, col.supplierId)}
                                {isRecommended ? ' ★' : ''}
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.itemRows.map((item) => {
                        const label =
                          matrix.columns
                            .map((c) => (c.quotation?.lines ?? []).find((ql) => ((ql.description ?? '').trim() || ql.id) === item.key))
                            .find(Boolean)?.description ?? item.key;
                        return (
                          <tr key={item.key} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                            <th scope="row" className="px-3 py-2 text-left font-normal">{label}</th>
                            {item.cells.map((cell, idx) => {
                              const unit = cell ? num(cell.unitPrice) : null;
                              const isLowest = unit !== null && unit > 0 && unit === item.lowestUnit;
                              return (
                                <td
                                  key={matrix.columns[idx].line.id}
                                  className={`px-3 py-2 text-right font-mono ${isLowest ? 'text-emerald-700 font-semibold' : ''}`}
                                >
                                  {cell ? fmtMoney(cell.unitPrice, matrix.columns[idx].currency) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 bg-gray-50" style={{ borderColor: 'var(--aurora-border)' }}>
                        <th scope="row" className="px-3 py-2 text-left">Total</th>
                        {matrix.columns.map((col) => {
                          const isLowest = col.total > 0 && col.total === matrix.cheapestTotal;
                          return (
                            <td key={col.line.id} className={`px-3 py-2 text-right font-mono font-semibold ${isLowest ? 'text-emerald-700' : ''}`}>
                              {fmtMoney(col.total, col.currency)}
                            </td>
                          );
                        })}
                      </tr>
                      <ScoreRow label="Price Score" columns={matrix.columns} pick={(l) => l.priceScore} />
                      <ScoreRow label="Delivery Score" columns={matrix.columns} pick={(l) => l.deliveryScore} />
                      <ScoreRow label="Quality Score" columns={matrix.columns} pick={(l) => l.qualityScore} />
                      <ScoreRow label="Overall Score" columns={matrix.columns} pick={(l) => l.overallScore} highlight />
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  title="No bids to compare"
                  description="This comparison has no supplier quotation lines linked yet."
                />
              )}

              {selected.recommendedSupplierId && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                  <div className="text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>Recommendation</div>
                  <div className="font-medium">{supplierLabel(supplierById.get(selected.recommendedSupplierId), selected.recommendedSupplierId)}</div>
                  {selected.recommendationReason && <div className="mt-1">{selected.recommendationReason}</div>}
                </div>
              )}

              {selected.notes && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                  {selected.notes}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.approvedAt ? 'APPROVED' : selected.status} />
                <Btn
                  variant="secondary"
                  size="sm"
                  onClick={exportMatrixCsv}
                  disabled={!matrix || matrix.columns.length === 0}
                  aria-label="Export comparison matrix to CSV"
                >
                  Export Matrix
                </Btn>
                {canApprove && (
                  <Btn
                    variant="success"
                    size="sm"
                    loading={approving}
                    disabled={selected.status !== 'DRAFT'}
                    onClick={() => approve(selected)}
                    aria-label={`Approve and award comparison ${selected.comparisonNumber}`}
                  >
                    {selected.status === 'APPROVED' ? 'Awarded' : 'Approve & Award'}
                  </Btn>
                )}
              </div>
              {canApprove && selected.status !== 'DRAFT' && selected.status !== 'APPROVED' && (
                <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  Only DRAFT comparisons can be approved.
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  columns,
  pick,
  highlight = false,
}: {
  label: string;
  columns: { line: BidComparisonLine }[];
  pick: (line: BidComparisonLine) => number | string | null | undefined;
  highlight?: boolean;
}) {
  const values = columns.map((col) => {
    const raw = pick(col.line);
    return raw === null || raw === undefined || raw === '' ? null : num(raw);
  });
  const best = values.reduce<number>((max, v) => (v !== null && v > max ? v : max), Number.NEGATIVE_INFINITY);
  return (
    <tr className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
      <th scope="row" className={`px-3 py-2 text-left ${highlight ? 'font-semibold' : 'font-normal'}`}>{label}</th>
      {columns.map((col, idx) => {
        const value = values[idx];
        const isBest = value !== null && value === best && best !== Number.NEGATIVE_INFINITY;
        return (
          <td
            key={col.line.id}
            className={`px-3 py-2 text-right font-mono ${isBest ? 'text-emerald-700 font-semibold' : ''} ${highlight ? 'font-semibold' : ''}`}
          >
            {fmtScore(pick(col.line))}
          </td>
        );
      })}
    </tr>
  );
}
