'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Copy, ExternalLink, Pencil, Send, Share2 } from 'lucide-react';
import { DocumentArtifactButton } from '@/components/documents';
import { Btn, Card, ConfirmDialog, PageHeader, SkeletonTable, StatusBadge, showToast } from '@/components/ui';
import { backendGet, backendList, backendPatch, backendPost } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { PurchaseOrderTabs } from '../../_components/PurchaseOrderTabs';
import { SupplierOrderDraftForm } from '../../_components/SupplierOrderDraftForm';
import type { CompanyOption, SupplierOrderDraft } from '../../_components/supplier-order-draft-types';
import { dateOnly, money } from '../../_components/supplier-order-draft-types';
import { shareSupplierOrderDraftPdf } from '../../_components/share-supplier-order-draft-pdf';

type Action = 'send' | 'accept' | 'decline' | 'reopen' | 'cancel';

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--aurora-text-muted)' }}>{label}</div><div className="mt-1 break-words text-[13px]">{value || '-'}</div></div>;
}

export default function SupplierOrderDraftDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [draft, setDraft] = useState<SupplierOrderDraft | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setDraft(await backendGet<SupplierOrderDraft>(`/supplier-order-drafts/${params.id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load supplier order draft'); }
    finally { setLoading(false); }
  }, [params.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (editing && !companies.length) backendList<CompanyOption>('/companies', { query: { limit: 500 } }).then(setCompanies).catch(() => setCompanies([])); }, [editing, companies.length]);

  async function transition() {
    if (!draft || !pending) return;
    setActing(true);
    try {
      await backendPatch(`/supplier-order-drafts/${draft.id}/${pending}`, {});
      showToast('success', `Draft ${pending === 'send' ? 'marked as sent' : `${pending}d`}`);
      setPending(null);
      await load();
    } catch (cause) { showToast('error', `Could not ${pending} draft`, cause instanceof Error ? cause.message : undefined); }
    finally { setActing(false); }
  }

  async function duplicate() {
    if (!draft) return;
    try {
      const copy = await backendPost<SupplierOrderDraft>(`/supplier-order-drafts/${draft.id}/duplicate`);
      showToast('success', `Created ${copy.draftNumber}`);
      router.push(`/operations/purchase-orders/order-drafts/${copy.id}`);
    } catch (cause) { showToast('error', 'Could not duplicate draft', cause instanceof Error ? cause.message : undefined); }
  }

  async function share() {
    if (!draft) return;
    try {
      const result = await shareSupplierOrderDraftPdf({
        id: draft.id,
        draftNumber: draft.draftNumber,
        supplierName: draft.supplierName,
      });
      if (result === 'downloaded') showToast('success', 'PDF downloaded for external sharing');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      showToast(
        'error',
        'Could not share supplier order draft',
        cause instanceof Error ? cause.message : undefined,
      );
    }
  }

  if (loading) return <div className="space-y-5 p-6"><PageHeader title="Supplier Order Draft" subtitle="Loading planning document" /><SkeletonTable rows={7} cols={5} /></div>;
  if (!draft) return <div className="p-6"><PageHeader title="Supplier Order Draft" subtitle={error || 'Document not found'} /><Link href="/operations/purchase-orders/order-drafts" className="mt-5 inline-block text-sm text-brand-600">Back to drafts</Link></div>;

  const canUpdate = draft.status === 'DRAFT' && hasPermission('supplier_order_drafts.update');
  const canManage = hasPermission('supplier_order_drafts.manage');
  const canSend = draft.status === 'DRAFT' && hasPermission('supplier_order_drafts.send');

  return (
    <div className="space-y-5 p-6">
      {editing && <SupplierOrderDraftForm open companies={companies.length ? companies : [draft.company!]} initial={draft} onClose={() => setEditing(false)} onSaved={(updated) => { setDraft(updated); setEditing(false); }} />}
      <ConfirmDialog open={Boolean(pending)} title={`${pending ? pending[0].toUpperCase() + pending.slice(1) : ''} supplier order draft`} message={`Confirm that you want to ${pending} ${draft.draftNumber}. This changes only the planning document lifecycle.`} confirmLabel={pending === 'send' ? 'Mark Sent' : 'Confirm'} variant={pending === 'decline' || pending === 'cancel' ? 'danger' : 'default'} loading={acting} onConfirm={transition} onClose={() => setPending(null)} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={draft.draftNumber} subtitle="Independent supplier planning document" />
        <div className="flex flex-wrap gap-2">
          {canUpdate && <Btn size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>Edit</Btn>}
          {hasPermission('supplier_order_drafts.create') && <Btn size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={duplicate}>Duplicate</Btn>}
          <Link href={`/operations/purchase-orders/order-drafts/${draft.id}/print`}><Btn size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />}>Print View</Btn></Link>
          {hasPermission('supplier_order_drafts.export') && <DocumentArtifactButton entityType="SUPPLIER_ORDER_DRAFT" entityId={draft.id} compact />}
          <Btn size="sm" variant="secondary" icon={<Share2 className="h-3.5 w-3.5" />} onClick={share}>Share</Btn>
          {canSend && <Btn size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setPending('send')}>Mark Sent</Btn>}
          {draft.status === 'DRAFT' && canManage && <Btn size="sm" variant="warning" onClick={() => setPending('cancel')}>Cancel</Btn>}
          {draft.status === 'SENT' && canManage && <><Btn size="sm" variant="success" onClick={() => setPending('accept')}>Accept</Btn><Btn size="sm" variant="danger" onClick={() => setPending('decline')}>Decline</Btn><Btn size="sm" variant="warning" onClick={() => setPending('cancel')}>Cancel</Btn></>}
          {draft.status !== 'DRAFT' && canManage && <Btn size="sm" variant="secondary" onClick={() => setPending('reopen')}>Reopen</Btn>}
        </div>
      </div>
      <PurchaseOrderTabs />

      <div className="flex flex-wrap items-center gap-3"><StatusBadge status={draft.status} />{draft.hasUnpricedLines && <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Partial pricing</span>}<span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Created {dateOnly(draft.createdAt)} by {draft.createdBy?.fullName || 'System user'}</span></div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card><h2 className="mb-4 text-sm font-semibold">Document Overview</h2><div className="grid grid-cols-2 gap-4"><Field label="Draft Date" value={dateOnly(draft.draftDate)} /><Field label="Needed By" value={dateOnly(draft.neededBy)} /><Field label="Currency" value={draft.currency} /><Field label="Title" value={draft.title} /><Field label="Company" value={draft.company?.name} /><Field label="Division" value={draft.division?.name} /><Field label="Branch" value={draft.branch?.name} /><Field label="Updated" value={dateOnly(draft.updatedAt)} /></div></Card>
        <Card><h2 className="mb-4 text-sm font-semibold">Frozen Supplier Details</h2><div className="grid grid-cols-2 gap-4"><Field label="Supplier" value={draft.supplierName} /><Field label="Source" value={draft.supplierId ? 'Saved supplier snapshot' : 'One-off supplier'} /><Field label="Contact" value={draft.supplierContact} /><Field label="Phone" value={draft.supplierPhone} /><Field label="Email" value={draft.supplierEmail} /><Field label="TIN" value={draft.supplierTin} /><Field label="VRN" value={draft.supplierVrn} /><Field label="Address" value={draft.supplierAddress} /></div></Card>
        <Card><h2 className="mb-4 text-sm font-semibold">Pricing Summary</h2><div className="space-y-3 text-sm"><div className="flex justify-between"><span>Priced subtotal</span><b>{money(draft.subtotal, draft.currency)}</b></div><div className="flex justify-between"><span>Discount</span><b>-{money(draft.discountAmount, draft.currency)}</b></div><div className="flex justify-between"><span>Tax</span><b>{money(draft.taxAmount, draft.currency)}</b></div><div className="flex justify-between border-t pt-3" style={{ borderColor: 'var(--aurora-border)' }}><span className="font-semibold">{draft.hasUnpricedLines ? 'Partial total' : 'Total'}</span><b className="text-base">{money(draft.totalAmount, draft.currency)}</b></div></div>{draft.hasUnpricedLines && <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">The total includes priced lines only. Unpriced lines remain “Price to be confirmed”.</p>}</Card>
      </div>

      <Card padding="none" className="overflow-hidden"><div className="border-b px-5 py-4" style={{ borderColor: 'var(--aurora-border)' }}><h2 className="text-sm font-semibold">Requested Items</h2><p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Manual planning lines; no inventory or product records are linked.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-[13px]"><thead style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-muted)' }}><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">Item</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3 text-right">Unit Price</th><th className="px-4 py-3 text-right">Discount</th><th className="px-4 py-3 text-right">Tax</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody>{draft.lines.map((line) => <tr key={line.id ?? line.lineNumber} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}><td className="px-4 py-3">{line.lineNumber}</td><td className="px-4 py-3"><div className="font-medium">{line.description}</div>{line.itemCode && <div className="text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>{line.itemCode}</div>}{line.notes && <div className="mt-1 text-[11px]" style={{ color: 'var(--aurora-text-muted)' }}>{line.notes}</div>}</td><td className="px-4 py-3 text-right">{Number(line.quantity).toLocaleString()}</td><td className="px-4 py-3">{line.unitLabel}</td><td className="px-4 py-3 text-right">{line.unitPrice === null ? <span className="text-amber-600">Price to be confirmed</span> : money(line.unitPrice, draft.currency)}</td><td className="px-4 py-3 text-right">{line.unitPrice === null ? '-' : money(line.discountAmount, draft.currency)}</td><td className="px-4 py-3 text-right">{line.unitPrice === null ? '-' : money(line.taxAmount, draft.currency)}</td><td className="px-4 py-3 text-right font-semibold">{line.lineTotal === null ? <span className="text-amber-600">Pending</span> : money(line.lineTotal, draft.currency)}</td></tr>)}</tbody></table></div></Card>

      <div className="grid gap-4 lg:grid-cols-3"><Card><h2 className="mb-2 text-sm font-semibold">Delivery Instructions</h2><p className="whitespace-pre-wrap text-sm">{draft.deliveryInstructions || '-'}</p></Card><Card><h2 className="mb-2 text-sm font-semibold">Terms</h2><p className="whitespace-pre-wrap text-sm">{draft.terms || '-'}</p></Card><Card><h2 className="mb-2 text-sm font-semibold">Notes</h2><p className="whitespace-pre-wrap text-sm">{draft.notes || '-'}</p></Card></div>
    </div>
  );
}
