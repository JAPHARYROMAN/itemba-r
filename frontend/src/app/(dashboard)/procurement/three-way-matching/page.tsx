'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  EmptyState,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  SkeletonTable,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendList, backendPost } from '@/lib/api-client';
import { downloadTablePdf } from '@/lib/export-download';
import { downloadTextFile, rowsToCsv } from '@/lib/report-export';

interface Company { id: string; name: string; code?: string | null }
interface PurchaseOrder {
  id: string;
  purchaseOrderNumber?: string | null;
  supplierName?: string | null;
  companyId: string;
  totalAmount?: number | string | null;
  status?: string | null;
}
interface GoodsReceivedNote {
  id: string;
  grnNumber?: string | null;
  goodsReceivedNoteNumber?: string | null;
  purchaseOrderId?: string | null;
  companyId: string;
  status?: string | null;
}
interface SupplierInvoice {
  id: string;
  invoiceNumber?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceNo?: string | null;
  purchaseOrderId?: string | null;
  companyId: string;
  totalAmount?: number | string | null;
  status?: string | null;
}
interface ThreeWayMatch {
  id: string;
  matchNumber: string;
  companyId: string;
  purchaseOrderId: string;
  goodsReceivedNoteId?: string | null;
  supplierInvoiceId?: string | null;
  matchDate: string;
  matchStatus: string;
  quantityVariance: number;
  amountVariance: number;
  notes?: string | null;
  approvedAt?: string | null;
}

const today = new Date().toISOString().slice(0, 10);
// Only statuses the server actually computes — there is no manual-override action.
const MATCH_STATUSES = ['MATCHED', 'PARTIAL_MATCH', 'VARIANCE', 'FAILED'];

function optionLabel(row: { name?: string; code?: string | null }) {
  return row.code ? `${row.code} - ${row.name}` : (row.name ?? '');
}

function poLabel(row: PurchaseOrder) {
  return `${row.purchaseOrderNumber ?? row.id.slice(0, 8)}${row.supplierName ? ` - ${row.supplierName}` : ''}`;
}

function grnLabel(row: GoodsReceivedNote) {
  return `${row.goodsReceivedNoteNumber ?? row.grnNumber ?? row.id.slice(0, 8)}${row.status ? ` (${row.status})` : ''}`;
}

function invoiceLabel(row: SupplierInvoice) {
  return `${row.supplierInvoiceNumber ?? row.invoiceNumber ?? row.supplierInvoiceNo ?? row.id.slice(0, 8)}${row.status ? ` (${row.status})` : ''}`;
}

function fmtMoney(amount: number | string | null | undefined, currency = 'TZS') {
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number.isFinite(Number(amount ?? 0)) ? Number(amount ?? 0) : 0)}`;
}

export default function ThreeWayMatchingPage() {
  const { hasPermission } = useAuth();
  // The list endpoint (three-way-matching.controller.ts findAll) requires
  // three_way_match.list, which is seeded — gate the page on the same code so a
  // user who can open the page can actually load it.
  const canView = hasPermission('three_way_match.list');
  const canCreate = hasPermission('three_way_match.create');
  const canApprove = hasPermission('three_way_match.approve');

  const [rows, setRows] = useState<ThreeWayMatch[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GoodsReceivedNote[]>([]);
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<ThreeWayMatch | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState('');
  // matchNumber and matchStatus are intentionally absent: the number is minted
  // server-side and the status is computed from the PO/GRN/invoice variance.
  const [form, setForm] = useState({
    companyId: '',
    purchaseOrderId: '',
    goodsReceivedNoteId: '',
    supplierInvoiceId: '',
    matchDate: today,
    quantityVariance: '0',
    amountVariance: '0',
    notes: '',
  });

  useEffect(() => {
    if (!canView) return;
    backendList<Company>('/companies', { query: { limit: 100 } })
      .then((items) => setCompanies(items))
      .catch(() => setCompanies([]));
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const id = form.companyId || companyId;
    if (!id) {
      setPurchaseOrders([]);
      setGrns([]);
      setInvoices([]);
      return;
    }

    Promise.allSettled([
      backendList<PurchaseOrder>('/purchase-orders', { query: { companyId: id, limit: 200 } }),
      backendList<GoodsReceivedNote>('/goods-received-notes', { query: { companyId: id, limit: 200 } }),
      backendList<SupplierInvoice>('/supplier-invoices', { query: { companyId: id, limit: 200 } }),
    ]).then(([poResult, grnResult, invoiceResult]) => {
      setPurchaseOrders(poResult.status === 'fulfilled' ? poResult.value : []);
      setGrns(grnResult.status === 'fulfilled' ? grnResult.value : []);
      setInvoices(invoiceResult.status === 'fulfilled' ? invoiceResult.value : []);
    });
  }, [canView, companyId, form.companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const query: Record<string, string | number> = { limit: 100 };
      if (companyId) query.companyId = companyId;
      if (status) query.status = status;
      const items = await backendList<ThreeWayMatch>('/three-way-matching', { query });
      setRows(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [canView, companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const poById = useMemo(() => new Map(purchaseOrders.map((po) => [po.id, po])), [purchaseOrders]);
  const grnById = useMemo(() => new Map(grns.map((grn) => [grn.id, grn])), [grns]);
  const invoiceById = useMemo(() => new Map(invoices.map((invoice) => [invoice.id, invoice])), [invoices]);
  const variances = rows.filter((row) => ['VARIANCE', 'FAILED', 'PARTIAL_MATCH'].includes(row.matchStatus)).length;
  const approved = rows.filter((row) => row.approvedAt).length;
  const totalVariance = rows.reduce((sum, row) => sum + Math.abs(Number(row.amountVariance ?? 0)), 0);

  const openCreate = () => {
    setForm({
      companyId,
      purchaseOrderId: '',
      goodsReceivedNoteId: '',
      supplierInvoiceId: '',
      matchDate: today,
      quantityVariance: '0',
      amountVariance: '0',
      notes: '',
    });
    setCreating(true);
  };

  const buildExportRows = () =>
    rows.map((row) => ({
      'Match Number': row.matchNumber,
      'Match Date': new Date(row.matchDate).toLocaleDateString('en-GB'),
      'Purchase Order': poById.get(row.purchaseOrderId)?.purchaseOrderNumber ?? row.purchaseOrderId,
      Invoice: row.supplierInvoiceId
        ? invoiceLabel(invoiceById.get(row.supplierInvoiceId) ?? { id: row.supplierInvoiceId, companyId: row.companyId })
        : '',
      'Quantity Variance': Number(row.quantityVariance ?? 0),
      'Amount Variance': Number(row.amountVariance ?? 0),
      Status: row.matchStatus,
      Approved: row.approvedAt ? 'Yes' : 'No',
    }));

  const exportCsv = () => {
    const csv = rowsToCsv(buildExportRows());
    if (!csv) return;
    downloadTextFile(`three-way-matching-${today}.csv`, 'text/csv;charset=utf-8', csv);
  };

  const exportPdf = async () => {
    const data = buildExportRows();
    if (data.length === 0) return;
    setExportingPdf(true);
    setError('');
    try {
      const filters = [
        companyId ? (companies.find((company) => company.id === companyId)?.name ?? '') : '',
        status,
      ].filter(Boolean).join(' · ');
      await downloadTablePdf({
        title: 'Three-Way Matching',
        subtitle: filters || undefined,
        companyId: companyId || undefined,
        columns: Object.keys(data[0]),
        rows: data.map((row) => Object.values(row).map(String)),
        numericColumns: [4, 5],
        baseName: 'three-way-matching',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF export failed');
    } finally {
      setExportingPdf(false);
    }
  };

  const filteredGrns = form.purchaseOrderId
    ? grns.filter((grn) => !grn.purchaseOrderId || grn.purchaseOrderId === form.purchaseOrderId)
    : grns;
  const filteredInvoices = form.purchaseOrderId
    ? invoices.filter((invoice) => !invoice.purchaseOrderId || invoice.purchaseOrderId === form.purchaseOrderId)
    : invoices;

  const saveMatch = async () => {
    // The backend rejects a match without a supplier invoice
    // (three-way-matching.service.ts create), so require it up front.
    if (!form.companyId || !form.purchaseOrderId || !form.supplierInvoiceId) {
      setError('Company, purchase order, and supplier invoice are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Match number, status, and variances are all server-minted/computed — do
      // not send client-entered values.
      const body = {
        companyId: form.companyId,
        purchaseOrderId: form.purchaseOrderId,
        goodsReceivedNoteId: form.goodsReceivedNoteId || undefined,
        supplierInvoiceId: form.supplierInvoiceId,
        matchDate: form.matchDate,
        notes: form.notes || undefined,
      };
      await backendPost('/three-way-matching', body);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  const approve = async (row: ThreeWayMatch) => {
    setSaving(true);
    setError('');
    try {
      const updated = await backendPost<ThreeWayMatch>(`/three-way-matching/${row.id}/approve`);
      setSelected(updated ?? row);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Three-Way Matching" subtitle="Reconcile purchase orders, goods received notes, and supplier invoices before approval" />
        <Card className="mt-6">
          <div className="px-6 py-12 text-center">
            <p className="text-[15px] font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
              Access Restricted
            </p>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--aurora-text-muted)' }}>
              You do not have permission to view three-way matches.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Three-Way Matching" subtitle="Reconcile purchase orders, goods received notes, and supplier invoices before approval" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Matches" value={rows.length} />
        <StatCard label="Approved" value={approved} />
        <StatCard label="With Variance" value={variances} />
        <StatCard label="Variance Value" value={fmtMoney(totalVariance)} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_190px_auto_auto_auto] gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="All companies">
            {companies.map((company) => <option key={company.id} value={company.id}>{optionLabel(company)}</option>)}
          </FormSelect>
          <FormSelect label="Match Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {MATCH_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </FormSelect>
          <Btn variant="secondary" onClick={exportCsv} disabled={rows.length === 0} aria-label="Export matches to CSV">Export CSV</Btn>
          <Btn variant="secondary" onClick={exportPdf} disabled={rows.length === 0 || exportingPdf} aria-label="Export matches to PDF">Export PDF</Btn>
          {canCreate && <Btn onClick={openCreate}>New Match</Btn>}
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_440px] gap-5">
        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-4"><SkeletonTable rows={6} cols={6} /></div>
          ) : rows.length === 0 ? (
            <EmptyState title="No matches" description="No three-way matches were found for the current filters." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Three-way matches between purchase orders, goods received notes, and supplier invoices</caption>
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th scope="col" className="px-4 py-3">Match</th>
                    <th scope="col" className="px-4 py-3">Purchase Order</th>
                    <th scope="col" className="px-4 py-3">Invoice</th>
                    <th scope="col" className="px-4 py-3 text-right">Qty Var.</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount Var.</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const qtyVar = Number(row.quantityVariance ?? 0);
                    const amtVar = Number(row.amountVariance ?? 0);
                    return (
                      <tr
                        key={row.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Review match ${row.matchNumber}`}
                        onClick={() => setSelected(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelected(row);
                          }
                        }}
                        className="border-t cursor-pointer hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500"
                        style={{ borderColor: 'var(--aurora-border)' }}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs">{row.matchNumber}</div>
                          <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{new Date(row.matchDate).toLocaleDateString('en-GB')}</div>
                        </td>
                        <td className="px-4 py-3">{poById.get(row.purchaseOrderId)?.purchaseOrderNumber ?? row.purchaseOrderId}</td>
                        <td className="px-4 py-3">{row.supplierInvoiceId ? invoiceLabel(invoiceById.get(row.supplierInvoiceId) ?? { id: row.supplierInvoiceId, companyId: row.companyId }) : '-'}</td>
                        <td className={`px-4 py-3 text-right font-mono ${qtyVar ? 'text-red-600' : 'text-emerald-600'}`}>
                          {qtyVar ? '⚠ ' : '✓ '}{qtyVar.toLocaleString()}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${amtVar ? 'text-red-600' : 'text-emerald-600'}`}>
                          {amtVar ? '⚠ ' : '✓ '}{fmtMoney(row.amountVariance)}
                        </td>
                        <td className="px-4 py-3"><StatusBadge status={row.matchStatus} /></td>
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
            <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Select a match to review procurement references and approve.</div>
          ) : (
            <>
              <div>
                <div className="font-semibold">{selected.matchNumber}</div>
                <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{new Date(selected.matchDate).toLocaleDateString('en-GB')}</div>
              </div>
              <div className="space-y-2 text-sm">
                <ReferenceRow label="Purchase Order" value={poById.get(selected.purchaseOrderId) ? poLabel(poById.get(selected.purchaseOrderId)!) : selected.purchaseOrderId} />
                <ReferenceRow label="GRN" value={selected.goodsReceivedNoteId ? grnLabel(grnById.get(selected.goodsReceivedNoteId) ?? { id: selected.goodsReceivedNoteId, companyId: selected.companyId }) : 'Not linked'} />
                <ReferenceRow label="Supplier Invoice" value={selected.supplierInvoiceId ? invoiceLabel(invoiceById.get(selected.supplierInvoiceId) ?? { id: selected.supplierInvoiceId, companyId: selected.companyId }) : 'Not linked'} />
                <ReferenceRow label="Quantity Variance" value={`${Number(selected.quantityVariance) !== 0 ? '⚠ ' : '✓ '}${Number(selected.quantityVariance ?? 0).toLocaleString()}`} danger={Number(selected.quantityVariance) !== 0} />
                <ReferenceRow label="Amount Variance" value={`${Number(selected.amountVariance) !== 0 ? '⚠ ' : '✓ '}${fmtMoney(selected.amountVariance)}`} danger={Number(selected.amountVariance) !== 0} />
              </div>
              {selected.notes && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                  {selected.notes}
                </div>
              )}
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.approvedAt ? 'APPROVED' : 'PENDING'} />
                {canApprove && (
                  <Btn
                    variant="success"
                    size="sm"
                    loading={saving}
                    disabled={Boolean(selected.approvedAt)}
                    onClick={() => approve(selected)}
                    aria-label={`Approve match ${selected.matchNumber}`}
                  >
                    Approve
                  </Btn>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal open title="Create Three-Way Match" onClose={() => setCreating(false)} size="xl" footer={<><Btn variant="secondary" onClick={() => setCreating(false)}>Cancel</Btn><Btn loading={saving} onClick={saveMatch}>Create</Btn></>}>
          <div className="grid md:grid-cols-2 gap-3">
            <FormSelect label="Company" required value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value, purchaseOrderId: '', goodsReceivedNoteId: '', supplierInvoiceId: '' }))} placeholder="Select company">
              {companies.map((company) => <option key={company.id} value={company.id}>{optionLabel(company)}</option>)}
            </FormSelect>
            <FormSelect label="Purchase Order" required value={form.purchaseOrderId} onChange={(e) => setForm((f) => ({ ...f, purchaseOrderId: e.target.value, goodsReceivedNoteId: '', supplierInvoiceId: '' }))} placeholder={form.companyId ? 'Select PO' : 'Select company first'} disabled={!form.companyId}>
              {purchaseOrders.filter((po) => po.companyId === form.companyId).map((po) => <option key={po.id} value={po.id}>{poLabel(po)}</option>)}
            </FormSelect>
            <FormInput label="Match Date" type="date" value={form.matchDate} onChange={(e) => setForm((f) => ({ ...f, matchDate: e.target.value }))} />
            <FormSelect label="Goods Received Note" value={form.goodsReceivedNoteId} onChange={(e) => setForm((f) => ({ ...f, goodsReceivedNoteId: e.target.value }))} placeholder="Optional GRN" disabled={!form.purchaseOrderId}>
              {filteredGrns.map((grn) => <option key={grn.id} value={grn.id}>{grnLabel(grn)}</option>)}
            </FormSelect>
            <FormSelect label="Supplier Invoice" required value={form.supplierInvoiceId} onChange={(e) => setForm((f) => ({ ...f, supplierInvoiceId: e.target.value }))} placeholder={form.purchaseOrderId ? 'Select invoice' : 'Select purchase order first'} disabled={!form.purchaseOrderId}>
              {filteredInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoiceLabel(invoice)}</option>)}
            </FormSelect>
            <div />
            <FormInput label="Quantity Variance (computed)" type="number" value={form.quantityVariance} readOnly disabled />
            <FormInput label="Amount Variance (computed)" type="number" value={form.amountVariance} readOnly disabled />
            <div className="md:col-span-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              The match number is assigned automatically; variance and match status are calculated
              server-side from the linked PO, GRN, and invoice.
            </div>
            <div className="md:col-span-2"><FormTextarea label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReferenceRow({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--aurora-border)' }}>
      <span style={{ color: 'var(--aurora-text-muted)' }}>{label}</span>
      <span className={`text-right font-medium ${danger ? 'text-red-600' : ''}`}>{value}</span>
    </div>
  );
}
