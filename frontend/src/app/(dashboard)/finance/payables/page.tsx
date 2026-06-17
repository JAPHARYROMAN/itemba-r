'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  StatusBadge,
  Modal,
  Btn,
  PageSpinner,
  FormInput,
  FormSelect,
  FormTextarea,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  DetailGrid,
  DetailItem,
  DetailSection,
  DetailTable,
  EmptyDetail,
  InlineStatus,
  MoneyTile,
  fmtDateOnly as fmtDetailDate,
  fmtDateTime,
  fmtMoney,
  fmtQty,
} from '../_components/ar-ap-detail-ui';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface SupplierOption {
  id: string;
  supplierCode?: string | null;
  name: string;
}

interface Payable {
  id: string;
  payableNumber?: string;
  supplierId?: string | null;
  supplierName: string;
  sourceType?: string | null;
  sourceId?: string | null;
  amount: number | string;
  amountPaid?: number | string | null;
  paidAmount?: number | string | null;
  outstandingAmount: number | string;
  currency: string;
  issueDate: string;
  dueDate: string;
  status: 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'WRITTEN_OFF';
  notes?: string | null;
  companyId: string;
  company?: { name: string } | null;
  division?: { name: string; code?: string | null } | null;
  branch?: { name: string; code?: string | null } | null;
  supplier?: SupplierSnapshot | null;
  journalEntry?: JournalEntrySnapshot | null;
  purchaseOrders?: PurchaseOrderSnapshot[];
  fuelDeliveries?: FuelDeliverySnapshot[];
  createdAt: string;
  updatedAt?: string;
}

interface SupplierSnapshot {
  id?: string | null;
  supplierCode?: string | null;
  name?: string | null;
  legalName?: string | null;
  supplierType?: string | null;
  tin?: string | null;
  vrn?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  creditLimit?: number | string | null;
  currentBalance?: number | string | null;
  paymentTerms?: string | null;
  status?: string | null;
}

interface JournalEntrySnapshot {
  journalNumber: string;
  transactionDate: string;
  description: string;
  status: string;
  totalDebit: number | string;
  totalCredit: number | string;
  postedAt?: string | null;
  lines?: Array<{
    id: string;
    description?: string | null;
    debit: number | string;
    credit: number | string;
    account: {
      accountCode: string;
      accountName: string;
      accountType: string;
      accountSubType?: string | null;
    };
  }>;
}

interface PurchaseOrderSnapshot {
  id: string;
  purchaseOrderNumber: string;
  orderDate: string;
  expectedDate?: string | null;
  purchaseType: string;
  status: string;
  paymentStatus: string;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  lines?: PurchaseOrderLineSnapshot[];
}

interface PurchaseOrderLineSnapshot {
  id: string;
  description?: string | null;
  quantity: number | string;
  unitCost: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  lineTotal: number | string;
  batchNumber?: string | null;
  expiryDate?: string | null;
  product?: {
    id?: string | null;
    productCode?: string | null;
    sku?: string | null;
    name?: string | null;
  } | null;
  unit?: {
    id?: string | null;
    name?: string | null;
    symbol?: string | null;
  } | null;
}

interface FuelDeliverySnapshot {
  id: string;
  deliveryNumber: string;
  deliveryDate: string;
  deliveryNoteNumber?: string | null;
  invoiceNumber?: string | null;
  status: string;
  orderedLitres?: number | string | null;
  deliveredLitres: number | string;
  acceptedLitres: number | string;
  rejectedLitres: number | string;
  unitCost?: number | string | null;
  totalCost?: number | string | null;
  product?: { productCode: string; name: string; sku?: string | null } | null;
  tank?: { tankCode: string; tankName: string } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

interface PayableForm {
  companyId: string;
  supplierId: string;
  supplierName: string;
  amount: number | '';
  currency: string;
  issueDate: string;
  dueDate: string;
  notes: string;
}

const BLANK_FORM: PayableForm = {
  companyId: '',
  supplierId: '',
  supplierName: '',
  amount: '',
  currency: 'TZS',
  issueDate: '',
  dueDate: '',
  notes: '',
};

const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

function fmtTZS(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number.isFinite(value) ? value : 0,
    )
  );
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function moneyNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function payablePaidAmount(payable: Payable) {
  const explicit = payable.amountPaid ?? payable.paidAmount;
  if (explicit !== undefined && explicit !== null) return moneyNumber(explicit);
  return Math.max(0, moneyNumber(payable.amount) - moneyNumber(payable.outstandingAmount));
}

function payableOutstandingAmount(payable: Payable) {
  return moneyNumber(payable.outstandingAmount);
}

function agingBucket(dueDate: string): string {
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '90+ days';
}

function scopeLabel(scope?: { name: string; code?: string | null } | null) {
  if (!scope) return '-';
  return scope.code ? `${scope.code} - ${scope.name}` : scope.name;
}

function unitLabel(unit?: { name?: string | null; symbol?: string | null } | null) {
  if (!unit) return '-';
  return unit.symbol ? `${unit.symbol} - ${unit.name ?? ''}`.trim() : (unit.name ?? '-');
}

function PayableDetailModal({ payable, onClose }: { payable: Payable; onClose: () => void }) {
  const [detail, setDetail] = useState<Payable>(payable);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDetail(payable);
    setLoading(true);
    setError('');

    fetch(`/api/backend/payables/${payable.id}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message ?? 'Unable to load payable details');
        return json.data ?? json;
      })
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load details');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [payable]);

  const currency = detail.currency || 'TZS';
  const paid = payablePaidAmount(detail);
  const outstanding = payableOutstandingAmount(detail);
  const supplier = detail.supplier;
  const sourceCount = (detail.purchaseOrders?.length ?? 0) + (detail.fuelDeliveries?.length ?? 0);
  const purchaseOrderProductLines =
    detail.purchaseOrders?.flatMap((order) =>
      (order.lines ?? []).map((line) => ({
        ...line,
        purchaseOrderNumber: order.purchaseOrderNumber,
        orderDate: order.orderDate,
      })),
    ) ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Payable ${detail.payableNumber ?? detail.id.slice(0, 8)}`}
      subtitle={`${detail.supplierName} · ${detail.status}`}
      size="3xl"
      footer={
        <Btn variant="secondary" onClick={onClose}>
          Close
        </Btn>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}
      {loading && (
        <div className="mb-4 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Loading full creditor details...
        </div>
      )}

      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <MoneyTile label="Bill Amount" value={detail.amount} currency={currency} />
          <MoneyTile label="Paid" value={paid} currency={currency} tone="success" />
          <MoneyTile
            label="Outstanding"
            value={outstanding}
            currency={currency}
            tone={outstanding > 0 ? 'danger' : 'success'}
          />
          <div
            className="rounded-xl border px-4 py-3"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
            }}
          >
            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Aging
            </div>
            <div className="mt-2 text-lg font-bold" style={{ color: 'var(--aurora-text)' }}>
              {detail.dueDate ? agingBucket(detail.dueDate) : '-'}
            </div>
          </div>
        </div>

        <DetailSection
          title="Creditor Details"
          description="Supplier identity, contact, and credit posture."
        >
          <DetailGrid>
            <DetailItem label="Supplier Name" value={supplier?.name ?? detail.supplierName} />
            <DetailItem label="Supplier Code" value={supplier?.supplierCode} mono />
            <DetailItem label="Legal Name" value={supplier?.legalName} />
            <DetailItem label="Supplier Type" value={supplier?.supplierType} />
            <DetailItem label="Contact Person" value={supplier?.contactPerson} />
            <DetailItem label="Phone" value={supplier?.phone} />
            <DetailItem label="Email" value={supplier?.email} />
            <DetailItem label="TIN" value={supplier?.tin} mono />
            <DetailItem label="VRN" value={supplier?.vrn} mono />
            <DetailItem label="Payment Terms" value={supplier?.paymentTerms} />
            <DetailItem label="Credit Limit" value={fmtMoney(supplier?.creditLimit, currency)} />
            <DetailItem
              label="Current Balance"
              value={fmtMoney(supplier?.currentBalance, currency)}
            />
            <DetailItem
              label="Supplier Status"
              value={<InlineStatus status={supplier?.status} />}
            />
            <DetailItem label="Address" value={supplier?.address} />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="Payable Details" description="Document scope, source, and dates.">
          <DetailGrid>
            <DetailItem label="AP Number" value={detail.payableNumber} mono />
            <DetailItem label="Source Type" value={detail.sourceType} />
            <DetailItem label="Source ID" value={detail.sourceId} mono />
            <DetailItem label="Company" value={detail.company?.name} />
            <DetailItem label="Division" value={scopeLabel(detail.division)} />
            <DetailItem label="Branch / Location" value={scopeLabel(detail.branch)} />
            <DetailItem label="Issue Date" value={fmtDetailDate(detail.issueDate)} />
            <DetailItem label="Due Date" value={fmtDetailDate(detail.dueDate)} />
            <DetailItem label="Created" value={fmtDateTime(detail.createdAt)} />
            <DetailItem label="Updated" value={fmtDateTime(detail.updatedAt)} />
            <DetailItem label="Status" value={<InlineStatus status={detail.status} />} />
          </DetailGrid>
        </DetailSection>

        <DetailSection
          title="Source Documents"
          description="Operational records that created or support this creditor balance."
        >
          {sourceCount === 0 ? (
            <EmptyDetail>No linked source documents found for this payable.</EmptyDetail>
          ) : (
            <div className="space-y-4">
              {(detail.purchaseOrders?.length ?? 0) > 0 && (
                <DetailTable
                  columns={[
                    'Purchase Order',
                    'Date',
                    'Type',
                    'Status',
                    'Payment',
                    'Total',
                    'Paid',
                    'Outstanding',
                  ]}
                  empty="No purchase orders"
                  rows={detail.purchaseOrders!.map((order) => (
                    <tr key={order.id}>
                      <td className="px-3 py-2 font-mono text-xs">{order.purchaseOrderNumber}</td>
                      <td className="px-3 py-2">{fmtDetailDate(order.orderDate)}</td>
                      <td className="px-3 py-2">{order.purchaseType}</td>
                      <td className="px-3 py-2">
                        <InlineStatus status={order.status} />
                      </td>
                      <td className="px-3 py-2">
                        <InlineStatus status={order.paymentStatus} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(order.totalAmount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(order.paidAmount, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(order.outstandingAmount, currency)}
                      </td>
                    </tr>
                  ))}
                />
              )}
              {(detail.fuelDeliveries?.length ?? 0) > 0 && (
                <DetailTable
                  columns={[
                    'Fuel Delivery',
                    'Date',
                    'Product',
                    'Tank',
                    'Accepted L',
                    'Unit Cost',
                    'Total',
                    'Status',
                  ]}
                  empty="No fuel deliveries"
                  rows={detail.fuelDeliveries!.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{delivery.deliveryNumber}</div>
                        <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {delivery.invoiceNumber || delivery.deliveryNoteNumber || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2">{fmtDetailDate(delivery.deliveryDate)}</td>
                      <td className="px-3 py-2">{delivery.product?.name ?? '-'}</td>
                      <td className="px-3 py-2">{delivery.tank?.tankName ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtQty(delivery.acceptedLitres, 3)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(delivery.unitCost, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(delivery.totalCost, currency)}
                      </td>
                      <td className="px-3 py-2">
                        <InlineStatus status={delivery.status} />
                      </td>
                    </tr>
                  ))}
                />
              )}
            </div>
          )}
        </DetailSection>

        <DetailSection
          title="Product Lines"
          description="Actual products and quantities behind the creditor balance."
        >
          {purchaseOrderProductLines.length > 0 ? (
            <DetailTable
              columns={[
                'Purchase Order',
                'Product',
                'Description',
                'Qty',
                'Unit',
                'Unit Cost',
                'Discount',
                'Tax',
                'Total',
                'Batch / Expiry',
              ]}
              empty="No product lines"
              rows={purchaseOrderProductLines.map((line) => (
                <tr key={`${line.purchaseOrderNumber}-${line.id}`}>
                  <td className="px-3 py-2 font-mono text-xs">{line.purchaseOrderNumber}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{line.product?.name ?? '-'}</div>
                    <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {line.product?.productCode ?? '-'}
                      {line.product?.sku ? ` · ${line.product.sku}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{line.description ?? '-'}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtQty(line.quantity, 2)}</td>
                  <td className="px-3 py-2">{unitLabel(line.unit)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtMoney(line.unitCost, currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtMoney(line.discountAmount, currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtMoney(line.taxAmount, currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {fmtMoney(line.lineTotal, currency)}
                  </td>
                  <td className="px-3 py-2">
                    <div>{line.batchNumber ?? '-'}</div>
                    <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {fmtDetailDate(line.expiryDate)}
                    </div>
                  </td>
                </tr>
              ))}
            />
          ) : (
            <EmptyDetail>No purchase order product lines found for this payable.</EmptyDetail>
          )}
        </DetailSection>

        <DetailSection title="Ledger Posting" description="Journal entry and debit/credit lines.">
          {detail.journalEntry ? (
            <div className="space-y-3">
              <DetailGrid>
                <DetailItem label="Journal Number" value={detail.journalEntry.journalNumber} mono />
                <DetailItem
                  label="Transaction Date"
                  value={fmtDetailDate(detail.journalEntry.transactionDate)}
                />
                <DetailItem
                  label="Status"
                  value={<InlineStatus status={detail.journalEntry.status} />}
                />
                <DetailItem
                  label="Total Debit"
                  value={fmtMoney(detail.journalEntry.totalDebit, currency)}
                />
                <DetailItem
                  label="Total Credit"
                  value={fmtMoney(detail.journalEntry.totalCredit, currency)}
                />
                <DetailItem label="Posted At" value={fmtDateTime(detail.journalEntry.postedAt)} />
              </DetailGrid>
              <DetailTable
                columns={['Account', 'Description', 'Debit', 'Credit']}
                empty="No journal lines"
                rows={
                  detail.journalEntry.lines?.length
                    ? detail.journalEntry.lines.map((line) => (
                        <tr key={line.id}>
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs">{line.account.accountCode}</div>
                            <div>{line.account.accountName}</div>
                          </td>
                          <td className="px-3 py-2">{line.description ?? '-'}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {fmtMoney(line.debit, currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {fmtMoney(line.credit, currency)}
                          </td>
                        </tr>
                      ))
                    : null
                }
              />
            </div>
          ) : (
            <EmptyDetail>No journal entry is linked to this payable.</EmptyDetail>
          )}
        </DetailSection>

        <DetailSection title="Notes">
          <p className="whitespace-pre-wrap text-sm" style={{ color: 'var(--aurora-text)' }}>
            {detail.notes || 'No notes recorded.'}
          </p>
        </DetailSection>
      </div>
    </Modal>
  );
}

function RecordPaymentModal({
  payable,
  onClose,
  onDone,
}: {
  payable: Payable;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError('Valid amount is required');
      return;
    }
    const outstanding = payableOutstandingAmount(payable);
    if (amt > outstanding) {
      setError(`Amount cannot exceed outstanding balance ${fmtTZS(outstanding)}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/payables/${payable.id}/record-payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          paymentDate: paymentDate || undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Payment failed');
      }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record Payment"
      subtitle={`Outstanding: ${fmtTZS(payableOutstandingAmount(payable))}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="success" onClick={handleSubmit} loading={saving}>
            Record Payment
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormInput
          label="Amount"
          required
          type="number"
          min="0.01"
          step="0.01"
          max={payableOutstandingAmount(payable)}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <FormInput
          label="Payment Date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />
        <FormTextarea
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes…"
        />
      </div>
    </Modal>
  );
}

function WriteOffDialog({
  payable,
  onClose,
  onDone,
}: {
  payable: Payable;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reason.trim()) {
      setError('Reason is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/payables/${payable.id}/write-off`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Write-off failed');
      }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Write Off Payable"
      subtitle={`Write off ${payable.payableNumber ?? payable.id.slice(0, 8)}`}
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleSubmit} loading={saving}>
            Write Off
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <FormTextarea
        label="Reason"
        required
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for write-off…"
      />
    </Modal>
  );
}

function PayableModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Payable;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PayableForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          supplierId: initial.supplierId ?? initial.supplier?.id ?? '',
          supplierName: initial.supplierName,
          amount: moneyNumber(initial.amount),
          currency: initial.currency,
          issueDate: initial.issueDate.split('T')[0],
          dueDate: initial.dueDate.split('T')[0],
          notes: initial.notes ?? '',
        }
      : { ...BLANK_FORM },
  );
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof PayableForm, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    const loadSuppliers = async () => {
      if (!form.companyId) {
        setSuppliers([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/backend/suppliers?companyId=${encodeURIComponent(form.companyId)}&limit=500`,
        );
        if (!res.ok) throw new Error('Failed to load suppliers');
        const json = await res.json();
        const rows = Array.isArray(json?.data?.data)
          ? json.data.data
          : Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json)
              ? json
              : [];
        if (!cancelled) setSuppliers(rows);
      } catch {
        if (!cancelled) setSuppliers([]);
      }
    };
    loadSuppliers();
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.supplierName.trim()) {
      setError('Supplier name is required');
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setError('Valid amount is required');
      return;
    }
    if (!form.issueDate || !form.dueDate) {
      setError('Dates are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        ...form,
        supplierId: form.supplierId || null,
        amount: Number(form.amount),
        notes: form.notes || undefined,
      };
      const res = await fetch(
        mode === 'create' ? '/api/backend/payables' : `/api/backend/payables/${initial!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Save failed');
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Payable' : 'Edit Payable'}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormSelect
          label="Company"
          required
          disabled={mode === 'edit'}
          value={form.companyId}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              companyId: e.target.value,
              supplierId: '',
              supplierName: '',
            }))
          }
          placeholder="Select company…"
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Linked Supplier"
          value={form.supplierId}
          onChange={(e) => {
            const supplierId = e.target.value;
            const supplier = suppliers.find((s) => s.id === supplierId);
            setForm((f) => ({
              ...f,
              supplierId,
              supplierName: supplier?.name ?? '',
            }));
          }}
          placeholder="Select an operations supplier…"
        >
          <option value="">Manual / unlinked supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.supplierCode ? ` (${supplier.supplierCode})` : ''}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Supplier Name"
          required
          disabled={Boolean(form.supplierId)}
          value={form.supplierName}
          onChange={(e) => set('supplierName', e.target.value)}
          placeholder="Supplier name"
        />
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Amount"
            required
            type="number"
            min="0.01"
            step="0.01"
            value={form.amount}
            onChange={(e) => set('amount', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="0.00"
          />
          <FormSelect
            label="Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </FormSelect>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormInput
            label="Issue Date"
            required
            type="date"
            value={form.issueDate}
            onChange={(e) => set('issueDate', e.target.value)}
          />
          <FormInput
            label="Due Date"
            required
            type="date"
            value={form.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
          />
        </div>
        <FormTextarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Optional notes…"
        />
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  payable,
  onClose,
  onDeleted,
}: {
  payable: Payable;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    await fetch(`/api/backend/payables/${payable.id}`, { method: 'DELETE' });
    onDeleted();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Payable"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={confirm} loading={deleting}>
            Delete
          </Btn>
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Delete payable{' '}
        <span className="font-medium">{payable.payableNumber ?? payable.id.slice(0, 8)}</span>?
      </p>
    </Modal>
  );
}

export default function PayablesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Payable> | null>(null);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Payable | null>(null);
  const [editing, setEditing] = useState<Payable | null>(null);
  const [deleting, setDeleting] = useState<Payable | null>(null);
  const [recordingPayment, setRecordingPayment] = useState<Payable | null>(null);
  const [writingOff, setWritingOff] = useState<Payable | null>(null);

  const canView = hasPermission('payables.view');
  const canManage = hasPermission('payables.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) =>
        setCompanies(
          Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [],
        ),
      );
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/payables?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const totalOutstanding = data?.data.reduce((s, p) => s + payableOutstandingAmount(p), 0) ?? 0;
  const totalOverdue =
    data?.data
      .filter((p) => p.status === 'OVERDUE')
      .reduce((s, p) => s + payableOutstandingAmount(p), 0) ?? 0;

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Payables" subtitle="Manage accounts payable" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <PayableModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {viewing && <PayableDetailModal payable={viewing} onClose={() => setViewing(null)} />}
      {editing && (
        <PayableModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          payable={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            load();
          }}
        />
      )}
      {recordingPayment && (
        <RecordPaymentModal
          payable={recordingPayment}
          onClose={() => setRecordingPayment(null)}
          onDone={() => {
            setRecordingPayment(null);
            load();
          }}
        />
      )}
      {writingOff && (
        <WriteOffDialog
          payable={writingOff}
          onClose={() => setWritingOff(null)}
          onDone={() => {
            setWritingOff(null);
            load();
          }}
        />
      )}

      <PageHeader title="Payables" subtitle="Accounts payable management (AP)" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Open" value={data?.data.filter((p) => p.status === 'OPEN').length ?? 0} />
        <StatCard label="Outstanding" value={fmtTZS(totalOutstanding)} />
        <StatCard label="Overdue" value={fmtTZS(totalOverdue)} hint="Past due date" />
      </div>

      <PageToolbar
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => reset(setCompanyId)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => reset(setStatus)(e.target.value)}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              <option value="OPEN">Open</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="WRITTEN_OFF">Written Off</option>
            </select>
          </>
        }
        actions={
          canManage ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New AP
            </Btn>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">AP #</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3">Issue Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Aging</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No payables found
                  </td>
                </tr>
              ) : (
                data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">
                      <div className="space-y-1">
                        <div>{p.payableNumber ?? p.id.slice(0, 8)}</div>
                        <button
                          type="button"
                          onClick={() => setViewing(p)}
                          className="font-sans text-[11px] font-semibold hover:underline"
                          style={{ color: 'var(--aurora-primary-text)' }}
                        >
                          View details
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium">{p.supplierName}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtTZS(p.amount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-green-700">
                      {fmtTZS(payablePaidAmount(p))}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {fmtTZS(payableOutstandingAmount(p))}
                    </td>
                    <td className="px-4 py-3">{fmtDate(p.issueDate)}</td>
                    <td className="px-4 py-3">{fmtDate(p.dueDate)}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {agingBucket(p.dueDate)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Btn variant="secondary" size="xs" onClick={() => setViewing(p)}>
                          View
                        </Btn>
                        {canManage && (
                          <>
                            {(p.status === 'OPEN' ||
                              p.status === 'PARTIALLY_PAID' ||
                              p.status === 'OVERDUE') && (
                              <Btn
                                variant="success"
                                size="xs"
                                onClick={() => setRecordingPayment(p)}
                              >
                                Pay
                              </Btn>
                            )}
                            {(p.status === 'OPEN' || p.status === 'OVERDUE') && (
                              <Btn variant="warning" size="xs" onClick={() => setWritingOff(p)}>
                                Write Off
                              </Btn>
                            )}
                            {p.status === 'OPEN' && (
                              <Btn variant="ghost" size="xs" onClick={() => setEditing(p)}>
                                Edit
                              </Btn>
                            )}
                            {p.status === 'OPEN' && (
                              <Btn variant="danger" size="xs" onClick={() => setDeleting(p)}>
                                Delete
                              </Btn>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
