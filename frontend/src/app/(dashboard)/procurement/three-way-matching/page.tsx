'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageSpinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';

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
const MATCH_STATUSES = ['MATCHED', 'PARTIAL_MATCH', 'VARIANCE', 'FAILED', 'MANUAL_OVERRIDE'];

function unwrapList<T>(json: any): T[] {
  const payload = json?.data ?? json;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

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
  return `${currency} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(amount ?? 0))}`;
}

function matchCode() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `TWM-${stamp}-${Date.now().toString(36).toUpperCase()}`;
}

export default function ThreeWayMatchingPage() {
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
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    matchNumber: '',
    companyId: '',
    purchaseOrderId: '',
    goodsReceivedNoteId: '',
    supplierInvoiceId: '',
    matchDate: today,
    matchStatus: 'MATCHED',
    quantityVariance: '0',
    amountVariance: '0',
    notes: '',
  });

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(unwrapList<Company>(j)))
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    const id = form.companyId || companyId;
    if (!id) {
      setPurchaseOrders([]);
      setGrns([]);
      setInvoices([]);
      return;
    }

    Promise.allSettled([
      fetch(`/api/backend/purchase-orders?companyId=${id}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/goods-received-notes?companyId=${id}&limit=200`).then((r) => r.json()),
      fetch(`/api/backend/supplier-invoices?companyId=${id}&limit=200`).then((r) => r.json()),
    ]).then(([poResult, grnResult, invoiceResult]) => {
      setPurchaseOrders(poResult.status === 'fulfilled' ? unwrapList<PurchaseOrder>(poResult.value) : []);
      setGrns(grnResult.status === 'fulfilled' ? unwrapList<GoodsReceivedNote>(grnResult.value) : []);
      setInvoices(invoiceResult.status === 'fulfilled' ? unwrapList<SupplierInvoice>(invoiceResult.value) : []);
    });
  }, [companyId, form.companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const json = await fetch(`/api/backend/three-way-matching?${params}`).then((r) => r.json());
      setRows(unwrapList<ThreeWayMatch>(json));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [companyId, status]);

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
      matchNumber: matchCode(),
      companyId,
      purchaseOrderId: '',
      goodsReceivedNoteId: '',
      supplierInvoiceId: '',
      matchDate: today,
      matchStatus: 'MATCHED',
      quantityVariance: '0',
      amountVariance: '0',
      notes: '',
    });
    setCreating(true);
  };

  const filteredGrns = form.purchaseOrderId
    ? grns.filter((grn) => !grn.purchaseOrderId || grn.purchaseOrderId === form.purchaseOrderId)
    : grns;
  const filteredInvoices = form.purchaseOrderId
    ? invoices.filter((invoice) => !invoice.purchaseOrderId || invoice.purchaseOrderId === form.purchaseOrderId)
    : invoices;

  const saveMatch = async () => {
    if (!form.companyId || !form.purchaseOrderId || !form.matchNumber.trim()) {
      setError('Company, match number, and purchase order are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        matchNumber: form.matchNumber,
        companyId: form.companyId,
        purchaseOrderId: form.purchaseOrderId,
        goodsReceivedNoteId: form.goodsReceivedNoteId || undefined,
        supplierInvoiceId: form.supplierInvoiceId || undefined,
        matchDate: form.matchDate,
        matchStatus: form.matchStatus,
        quantityVariance: Number(form.quantityVariance || 0),
        amountVariance: Number(form.amountVariance || 0),
        notes: form.notes || undefined,
      };
      const response = await fetch('/api/backend/three-way-matching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Create failed');
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
      const response = await fetch(`/api/backend/three-way-matching/${row.id}/approve`, {
        method: 'POST',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.message ?? 'Approve failed');
      setSelected(json.data ?? json);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Three-Way Matching" subtitle="Reconcile purchase orders, goods received notes, and supplier invoices before approval" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Matches" value={rows.length} />
        <StatCard label="Approved" value={approved} />
        <StatCard label="With Variance" value={variances} />
        <StatCard label="Variance Value" value={fmtMoney(totalVariance)} />
      </div>

      <Card className="p-4">
        <div className="grid md:grid-cols-[1fr_190px_auto] gap-3 items-end">
          <FormSelect label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="All companies">
            {companies.map((company) => <option key={company.id} value={company.id}>{optionLabel(company)}</option>)}
          </FormSelect>
          <FormSelect label="Match Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses">
            {MATCH_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </FormSelect>
          <Btn onClick={openCreate}>New Match</Btn>
        </div>
      </Card>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_440px] gap-5">
        <Card className="overflow-hidden">
          {loading ? <PageSpinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-3">Match</th>
                    <th className="px-4 py-3">Purchase Order</th>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3 text-right">Qty Var.</th>
                    <th className="px-4 py-3 text-right">Amount Var.</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No matches</td></tr>
                  ) : rows.map((row) => (
                    <tr key={row.id} onClick={() => setSelected(row)} className="border-t cursor-pointer hover:bg-slate-50" style={{ borderColor: 'var(--aurora-border)' }}>
                      <td className="px-4 py-3">
                        <div className="font-mono text-xs">{row.matchNumber}</div>
                        <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{new Date(row.matchDate).toLocaleDateString('en-GB')}</div>
                      </td>
                      <td className="px-4 py-3">{poById.get(row.purchaseOrderId)?.purchaseOrderNumber ?? row.purchaseOrderId}</td>
                      <td className="px-4 py-3">{row.supplierInvoiceId ? invoiceLabel(invoiceById.get(row.supplierInvoiceId) ?? { id: row.supplierInvoiceId, companyId: row.companyId }) : '-'}</td>
                      <td className={`px-4 py-3 text-right font-mono ${Number(row.quantityVariance) ? 'text-red-600' : 'text-emerald-600'}`}>{Number(row.quantityVariance ?? 0).toLocaleString()}</td>
                      <td className={`px-4 py-3 text-right font-mono ${Number(row.amountVariance) ? 'text-red-600' : 'text-emerald-600'}`}>{fmtMoney(row.amountVariance)}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.matchStatus} /></td>
                    </tr>
                  ))}
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
                <ReferenceRow label="Quantity Variance" value={Number(selected.quantityVariance ?? 0).toLocaleString()} danger={Number(selected.quantityVariance) !== 0} />
                <ReferenceRow label="Amount Variance" value={fmtMoney(selected.amountVariance)} danger={Number(selected.amountVariance) !== 0} />
              </div>
              {selected.notes && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--aurora-border)' }}>
                  {selected.notes}
                </div>
              )}
              <div className="flex items-center gap-2">
                <StatusBadge status={selected.approvedAt ? 'APPROVED' : 'PENDING'} />
                <Btn variant="success" size="sm" loading={saving} disabled={Boolean(selected.approvedAt)} onClick={() => approve(selected)}>Approve</Btn>
              </div>
            </>
          )}
        </Card>
      </div>

      {creating && (
        <Modal open title="Create Three-Way Match" onClose={() => setCreating(false)} size="xl" footer={<><Btn variant="secondary" onClick={() => setCreating(false)}>Cancel</Btn><Btn loading={saving} onClick={saveMatch}>Create</Btn></>}>
          <div className="grid md:grid-cols-2 gap-3">
            <FormInput label="Match Number" required value={form.matchNumber} onChange={(e) => setForm((f) => ({ ...f, matchNumber: e.target.value }))} />
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
            <FormSelect label="Supplier Invoice" value={form.supplierInvoiceId} onChange={(e) => setForm((f) => ({ ...f, supplierInvoiceId: e.target.value }))} placeholder="Optional invoice" disabled={!form.purchaseOrderId}>
              {filteredInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoiceLabel(invoice)}</option>)}
            </FormSelect>
            <FormSelect label="Match Status" value={form.matchStatus} onChange={(e) => setForm((f) => ({ ...f, matchStatus: e.target.value }))}>
              {MATCH_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </FormSelect>
            <div />
            <FormInput label="Quantity Variance" type="number" value={form.quantityVariance} onChange={(e) => setForm((f) => ({ ...f, quantityVariance: e.target.value }))} />
            <FormInput label="Amount Variance" type="number" value={form.amountVariance} onChange={(e) => setForm((f) => ({ ...f, amountVariance: e.target.value }))} />
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
