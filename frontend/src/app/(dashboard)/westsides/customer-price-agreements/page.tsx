'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, Modal, Btn, ConfirmDialog, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { backendPost, backendPatch, backendDelete, ApiError } from '@/lib/api-client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CustomerPriceAgreement {
  id: string;
  companyId: string;
  customerId: string;
  priceListId?: string | null;
  productId?: string | null;
  customerName?: string;
  priceListName?: string;
  productName?: string;
  agreedPrice: number;
  discountPercent: number;
  startDate: string;
  endDate?: string;
  status: string;
  approvedAt?: string | null;
  notes?: string | null;
}

interface Company { id: string; name: string }
interface Customer { id: string; name: string }
interface PriceList { id: string; name: string }
interface Product { id: string; name: string; productCode: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const thCls = 'px-4 py-2 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm text-slate-700';

const STATUS_CLR: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  EXPIRED: 'bg-red-50 text-red-700 border-red-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

function Badge({ status }: { status: string }) {
  const cls = STATUS_CLR[status] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
  return (
    <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function fmtCurrency(n: number | string | null | undefined) { const value = Number(n ?? 0); return `TZS ${new Intl.NumberFormat('en-US').format(Number.isFinite(value) ? value : 0)}`; }
function fmtDate(d: string) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }

function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps { mode: 'create' | 'edit'; item: CustomerPriceAgreement | null; onClose: () => void; onSaved: () => void }

function AgreementModal({ mode, item, onClose, onSaved }: ModalProps) {
  const [companyId, setCompanyId] = useState(item?.companyId ?? '');
  const [customerId, setCustomerId] = useState(item?.customerId ?? '');
  const [priceListId, setPriceListId] = useState(item?.priceListId ?? '');
  const [productId, setProductId] = useState(item?.productId ?? '');
  const [agreedPrice, setAgreedPrice] = useState(item?.agreedPrice != null ? String(item.agreedPrice) : '');
  const [discountPercent, setDiscountPercent] = useState(item?.discountPercent != null ? String(item.discountPercent) : '0');
  const [startDate, setStartDate] = useState(item?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(item?.endDate?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then(r => r.json()).then(j => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])).catch(() => setCompanies([]));
    fetch('/api/backend/westsides/price-lists?limit=100').then(r => r.json()).then(j => setPriceLists(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])).catch(() => setPriceLists([]));
    fetch('/api/backend/products?limit=200').then(r => r.json()).then(j => setProducts(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])).catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    if (!companyId) { setCustomers([]); return; }
    fetch(`/api/backend/customers?companyId=${encodeURIComponent(companyId)}&limit=500`).then(r => r.json()).then(j => setCustomers(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [])).catch(() => setCustomers([]));
  }, [companyId]);

  const submit = async () => {
    if (mode === 'create' && !companyId) { setError('Company is required'); return; }
    if (!customerId) { setError('Customer is required'); return; }
    if (!startDate) { setError('Start date is required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        customerId,
        priceListId: priceListId || undefined,
        productId: productId || undefined,
        agreedPrice: agreedPrice === '' ? undefined : Number(agreedPrice),
        discountPercent: discountPercent === '' ? undefined : Number(discountPercent),
        startDate,
        endDate: endDate || undefined,
        notes: notes || undefined,
      };
      if (mode === 'create') {
        await backendPost('/westsides/customer-price-agreements', { ...body, companyId });
      } else {
        await backendPatch(`/westsides/customer-price-agreements/${item!.id}`, body);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Error saving');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Agreement' : 'Edit Agreement'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>{mode === 'create' ? 'Create' : 'Update'}</Btn></>}>
      {error && <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <FormSelect label="Company" required value={companyId} onChange={(e) => { setCompanyId(e.target.value); setCustomerId(''); }} placeholder="Select…" disabled={mode === 'edit'}>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Customer" required value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Select…" disabled={!companyId}>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Price List" value={priceListId ?? ''} onChange={(e) => setPriceListId(e.target.value)} placeholder="Select…">
          {priceLists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
        </FormSelect>
        <FormSelect label="Product" value={productId ?? ''} onChange={(e) => setProductId(e.target.value)} placeholder="Select…">
          {products.map(p => <option key={p.id} value={p.id}>{p.productCode} – {p.name}</option>)}
        </FormSelect>
        <FormInput label="Agreed Price" type="number" min={0} step="0.01" value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)} placeholder="0.00" />
        <FormInput label="Discount %" type="number" min={0} max={100} step="0.01" value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} placeholder="0" />
        <FormInput label="Start Date" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <FormInput label="End Date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomerPriceAgreementsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('customer_price_agreements.manage');
  const canApprove = hasPermission('customer_price_agreements.approve');

  const [items, setItems] = useState<CustomerPriceAgreement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerPriceAgreement | null>(null);
  const [deleting, setDeleting] = useState<CustomerPriceAgreement | null>(null);
  const [actionLoading, setActionLoading] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/backend/westsides/customer-price-agreements?limit=100');
      if (!res.ok) throw new Error('Failed to load agreements');
      const json = await res.json();
      setItems(json.data?.data ?? json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const doApprove = async (ag: CustomerPriceAgreement) => {
    setActionLoading(`${ag.id}-approve`);
    try {
      await backendPatch(`/westsides/customer-price-agreements/${ag.id}/approve`);
      showToast('success', 'Agreement approved');
      load();
    } catch (err: unknown) {
      showToast('error', 'Approve failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Unknown error');
    } finally { setActionLoading(''); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/westsides/customer-price-agreements/${deleting.id}`);
      showToast('success', 'Agreement deleted');
      setDeleting(null);
      load();
    } catch (err: unknown) {
      showToast('error', 'Delete failed', err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Unknown error');
      setDeleting(null);
    }
  };

  const showActions = canManage || canApprove;

  return (
    <div className="p-6 space-y-5">
      <PageHeader title="Customer Price Agreements" subtitle="Manage customer-specific pricing agreements" />

      <PageToolbar
        actions={canManage ? (
          <Btn variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>+ New Agreement</Btn>
        ) : null}
      />

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <Spinner /> : (
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No agreements found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className={thCls}>Customer</th>
                    <th className={thCls}>Price List</th>
                    <th className={thCls}>Product</th>
                    <th className={`${thCls} text-right`}>Agreed Price</th>
                    <th className={`${thCls} text-right`}>Discount %</th>
                    <th className={thCls}>Start Date</th>
                    <th className={thCls}>End Date</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Approved</th>
                    {showActions && <th className={`${thCls} text-right`}>Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((ag) => {
                    const pending = !ag.approvedAt;
                    return (
                      <tr key={ag.id} className="hover:bg-slate-50">
                        <td className={`${tdCls} font-medium`}>{ag.customerName ?? '—'}</td>
                        <td className={tdCls}>{ag.priceListName ?? '—'}</td>
                        <td className={tdCls}>{ag.productName ?? '—'}</td>
                        <td className={`${tdCls} text-right`}>{fmtCurrency(ag.agreedPrice)}</td>
                        <td className={`${tdCls} text-right`}>{ag.discountPercent}%</td>
                        <td className={tdCls}>{ag.startDate ? fmtDate(ag.startDate) : '—'}</td>
                        <td className={tdCls}>{ag.endDate ? fmtDate(ag.endDate) : '—'}</td>
                        <td className={tdCls}><Badge status={ag.status} /></td>
                        <td className={tdCls}>{ag.approvedAt ? fmtDate(ag.approvedAt) : '—'}</td>
                        {showActions && (
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {canApprove && pending && (
                              <Btn variant="ghost" size="xs" loading={actionLoading === `${ag.id}-approve`} onClick={() => doApprove(ag)}>Approve</Btn>
                            )}
                            {canManage && pending && (
                              <>
                                <Btn variant="ghost" size="xs" onClick={() => { setEditing(ag); setModalOpen(true); }}>Edit</Btn>
                                <Btn variant="ghost" size="xs" onClick={() => setDeleting(ag)}>Delete</Btn>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {modalOpen && (
        <AgreementModal
          mode={editing ? 'edit' : 'create'}
          item={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={() => { setModalOpen(false); setEditing(null); load(); }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open
          title="Delete Agreement"
          message={`Delete the price agreement for ${deleting.customerName ?? 'this customer'}? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
