'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
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
import { DocumentArtifactButton } from '@/components/documents';
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

interface CustomerOption {
  id: string;
  customerCode?: string | null;
  name: string;
}

interface Receivable {
  id: string;
  receivableNumber?: string;
  customerId?: string | null;
  customerName: string;
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
  customer?: CustomerSnapshot | null;
  journalEntry?: JournalEntrySnapshot | null;
  salesOrders?: SalesOrderSnapshot[];
  fuelCreditSales?: FuelCreditSaleSnapshot[];
  projectBillings?: ProjectBillingSnapshot[];
  trips?: TripSnapshot[];
  createdAt: string;
  updatedAt?: string;
}

interface CustomerSnapshot {
  id?: string | null;
  customerCode?: string | null;
  name?: string | null;
  legalName?: string | null;
  customerType?: string | null;
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

interface SalesOrderSnapshot {
  id: string;
  salesOrderNumber: string;
  customerName?: string | null;
  customer?: { id?: string | null; name?: string | null } | null;
  orderDate: string;
  dueDate?: string | null;
  salesType: string;
  status: string;
  paymentStatus: string;
  subtotal: number | string;
  taxAmount: number | string;
  discountAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  lines?: SalesOrderLineSnapshot[];
}

interface SalesOrderLineSnapshot {
  id: string;
  description?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  discountAmount: number | string;
  taxAmount: number | string;
  lineTotal: number | string;
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

interface FuelCreditSaleSnapshot {
  id: string;
  creditSaleNumber: string;
  saleDate: string;
  status: string;
  litres: number | string;
  pricePerLitre: number | string;
  totalAmount: number | string;
  vehicleNumber?: string | null;
  driverName?: string | null;
  product?: { productCode: string; name: string; sku?: string | null } | null;
}

interface ProjectBillingSnapshot {
  id: string;
  billingNumber: string;
  billingDate: string;
  description: string;
  amount: number | string;
  currency: string;
  status: string;
}

interface TripSnapshot {
  id: string;
  tripNumber: string;
  tripDate: string;
  origin: string;
  destination: string;
  revenueAmount: number | string;
  currency: string;
  status: string;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

interface ReceivableAccount {
  accountKey: string;
  companyId: string;
  customerId?: string | null;
  customerName: string;
  customerCode?: string | null;
  company?: { id: string; name: string; code: string } | null;
  currency: string;
  documentCount: number;
  openDocumentCount: number;
  amount: number;
  paidAmount: number;
  outstandingAmount: number;
  overdueAmount: number;
  overdueCount: number;
  oldestIssueDate?: string | null;
  nextDueDate?: string | null;
  lastIssueDate?: string | null;
  status: Receivable['status'];
  documents: Receivable[];
}

interface ReceivableForm {
  companyId: string;
  customerId: string;
  customerName: string;
  amount: number | '';
  currency: string;
  issueDate: string;
  dueDate: string;
  notes: string;
}

const BLANK_FORM: ReceivableForm = {
  companyId: '',
  customerId: '',
  customerName: '',
  amount: '',
  currency: 'TZS',
  issueDate: '',
  dueDate: '',
  notes: '',
};

const CURRENCIES = ['TZS', 'USD', 'EUR', 'KES', 'UGX', 'GBP'];

function moneyNumber(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function receivablePaidAmount(receivable: Receivable) {
  const explicit = receivable.amountPaid ?? receivable.paidAmount;
  if (explicit !== undefined && explicit !== null) return moneyNumber(explicit);
  return Math.max(0, moneyNumber(receivable.amount) - moneyNumber(receivable.outstandingAmount));
}

function receivableOutstandingAmount(receivable: Receivable) {
  return moneyNumber(receivable.outstandingAmount);
}

function receivableCustomerName(receivable: Receivable) {
  const sourceOrder = receivable.salesOrders?.[0];
  return (
    receivable.customer?.name?.trim() ||
    sourceOrder?.customer?.name?.trim() ||
    sourceOrder?.customerName?.trim() ||
    receivable.customerName ||
    'Walk-in Customer'
  );
}

function fmtTZS(n: unknown) {
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      moneyNumber(n),
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

function ReceivableDetailModal({
  receivable,
  onClose,
}: {
  receivable: Receivable;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Receivable>(receivable);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDetail(receivable);
    setLoading(true);
    setError('');

    fetch(`/api/backend/receivables/${receivable.id}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message ?? 'Unable to load receivable details');
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
  }, [receivable]);

  const currency = detail.currency || 'TZS';
  const paid = receivablePaidAmount(detail);
  const outstanding = receivableOutstandingAmount(detail);
  const customer = detail.customer;
  const sourceCount =
    (detail.salesOrders?.length ?? 0) +
    (detail.fuelCreditSales?.length ?? 0) +
    (detail.projectBillings?.length ?? 0) +
    (detail.trips?.length ?? 0);
  const salesOrderProductLines =
    detail.salesOrders?.flatMap((order) =>
      (order.lines ?? []).map((line) => ({
        ...line,
        salesOrderNumber: order.salesOrderNumber,
        orderDate: order.orderDate,
      })),
    ) ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Receivable ${detail.receivableNumber ?? detail.id.slice(0, 8)}`}
      subtitle={`${receivableCustomerName(detail)} · ${detail.status}`}
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
          Loading full debtor details...
        </div>
      )}

      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <MoneyTile label="Invoice Amount" value={detail.amount} currency={currency} />
          <MoneyTile label="Paid / Collected" value={paid} currency={currency} tone="success" />
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
          title="Debtor Details"
          description="Customer identity, contact, and credit posture."
        >
          <DetailGrid>
            <DetailItem label="Customer Name" value={receivableCustomerName(detail)} />
            <DetailItem label="Customer Code" value={customer?.customerCode} mono />
            <DetailItem label="Legal Name" value={customer?.legalName} />
            <DetailItem label="Customer Type" value={customer?.customerType} />
            <DetailItem label="Contact Person" value={customer?.contactPerson} />
            <DetailItem label="Phone" value={customer?.phone} />
            <DetailItem label="Email" value={customer?.email} />
            <DetailItem label="TIN" value={customer?.tin} mono />
            <DetailItem label="VRN" value={customer?.vrn} mono />
            <DetailItem label="Payment Terms" value={customer?.paymentTerms} />
            <DetailItem label="Credit Limit" value={fmtMoney(customer?.creditLimit, currency)} />
            <DetailItem
              label="Current Balance"
              value={fmtMoney(customer?.currentBalance, currency)}
            />
            <DetailItem
              label="Customer Status"
              value={<InlineStatus status={customer?.status} />}
            />
            <DetailItem label="Address" value={customer?.address} />
          </DetailGrid>
        </DetailSection>

        <DetailSection title="Receivable Details" description="Document scope, source, and dates.">
          <DetailGrid>
            <DetailItem label="AR Number" value={detail.receivableNumber} mono />
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
          description="Operational records that created or support this debtor balance."
        >
          {sourceCount === 0 ? (
            <EmptyDetail>No linked source documents found for this receivable.</EmptyDetail>
          ) : (
            <div className="space-y-4">
              {(detail.salesOrders?.length ?? 0) > 0 && (
                <DetailTable
                  columns={[
                    'Sales Order',
                    'Date',
                    'Status',
                    'Payment',
                    'Total',
                    'Paid',
                    'Outstanding',
                  ]}
                  empty="No sales orders"
                  rows={detail.salesOrders!.map((order) => (
                    <tr key={order.id}>
                      <td className="px-3 py-2 font-mono text-xs">{order.salesOrderNumber}</td>
                      <td className="px-3 py-2">{fmtDetailDate(order.orderDate)}</td>
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
              {(detail.fuelCreditSales?.length ?? 0) > 0 && (
                <DetailTable
                  columns={[
                    'Fuel Credit Sale',
                    'Date',
                    'Product',
                    'Litres',
                    'Price / L',
                    'Total',
                    'Status',
                  ]}
                  empty="No fuel credit sales"
                  rows={detail.fuelCreditSales!.map((sale) => (
                    <tr key={sale.id}>
                      <td className="px-3 py-2 font-mono text-xs">{sale.creditSaleNumber}</td>
                      <td className="px-3 py-2">{fmtDetailDate(sale.saleDate)}</td>
                      <td className="px-3 py-2">{sale.product?.name ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtQty(sale.litres, 3)}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(sale.pricePerLitre, currency)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(sale.totalAmount, currency)}
                      </td>
                      <td className="px-3 py-2">
                        <InlineStatus status={sale.status} />
                      </td>
                    </tr>
                  ))}
                />
              )}
              {(detail.projectBillings?.length ?? 0) > 0 && (
                <DetailTable
                  columns={['Billing', 'Date', 'Description', 'Amount', 'Status']}
                  empty="No project billings"
                  rows={detail.projectBillings!.map((billing) => (
                    <tr key={billing.id}>
                      <td className="px-3 py-2 font-mono text-xs">{billing.billingNumber}</td>
                      <td className="px-3 py-2">{fmtDetailDate(billing.billingDate)}</td>
                      <td className="px-3 py-2">{billing.description}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(billing.amount, billing.currency)}
                      </td>
                      <td className="px-3 py-2">
                        <InlineStatus status={billing.status} />
                      </td>
                    </tr>
                  ))}
                />
              )}
              {(detail.trips?.length ?? 0) > 0 && (
                <DetailTable
                  columns={['Trip', 'Date', 'Route', 'Revenue', 'Status']}
                  empty="No trips"
                  rows={detail.trips!.map((trip) => (
                    <tr key={trip.id}>
                      <td className="px-3 py-2 font-mono text-xs">{trip.tripNumber}</td>
                      <td className="px-3 py-2">{fmtDetailDate(trip.tripDate)}</td>
                      <td className="px-3 py-2">
                        {trip.origin} {'->'} {trip.destination}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmtMoney(trip.revenueAmount, trip.currency)}
                      </td>
                      <td className="px-3 py-2">
                        <InlineStatus status={trip.status} />
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
          description="Actual products and quantities behind the debtor balance."
        >
          {salesOrderProductLines.length > 0 ? (
            <DetailTable
              columns={[
                'Sales Order',
                'Product',
                'Description',
                'Qty',
                'Unit',
                'Unit Price',
                'Discount',
                'Tax',
                'Total',
              ]}
              empty="No product lines"
              rows={salesOrderProductLines.map((line) => (
                <tr key={`${line.salesOrderNumber}-${line.id}`}>
                  <td className="px-3 py-2 font-mono text-xs">{line.salesOrderNumber}</td>
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
                    {fmtMoney(line.unitPrice, currency)}
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
                </tr>
              ))}
            />
          ) : (
            <EmptyDetail>No sales order product lines found for this receivable.</EmptyDetail>
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
            <EmptyDetail>No journal entry is linked to this receivable.</EmptyDetail>
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

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({
  receivable,
  onClose,
  onDone,
}: {
  receivable: Receivable;
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
    const outstanding = receivableOutstandingAmount(receivable);
    if (amt > outstanding) {
      setError(`Amount cannot exceed outstanding balance ${fmtTZS(outstanding)}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/backend/receivables/${receivable.id}/record-payment`, {
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
      subtitle={`Outstanding: ${fmtTZS(receivableOutstandingAmount(receivable))}`}
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
          max={receivableOutstandingAmount(receivable)}
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

// ─── Write-Off Dialog ─────────────────────────────────────────────────────────

function WriteOffDialog({
  receivable,
  onClose,
  onDone,
}: {
  receivable: Receivable;
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
      const res = await fetch(`/api/backend/receivables/${receivable.id}/write-off`, {
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
      title="Write Off Receivable"
      subtitle={`Write off ${receivable.receivableNumber ?? receivable.id.slice(0, 8)}`}
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

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function ReceivableModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Receivable;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ReceivableForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          customerId: initial.customerId ?? initial.customer?.id ?? '',
          customerName: initial.customerName,
          amount: moneyNumber(initial.amount),
          currency: initial.currency,
          issueDate: initial.issueDate.split('T')[0],
          dueDate: initial.dueDate.split('T')[0],
          notes: initial.notes ?? '',
        }
      : { ...BLANK_FORM },
  );
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof ReceivableForm, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let cancelled = false;
    const loadCustomers = async () => {
      if (!form.companyId) {
        setCustomers([]);
        return;
      }
      try {
        const res = await fetch(
          `/api/backend/customers?companyId=${encodeURIComponent(form.companyId)}&limit=500`,
        );
        if (!res.ok) throw new Error('Failed to load customers');
        const json = await res.json();
        const rows = Array.isArray(json?.data?.data)
          ? json.data.data
          : Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json)
              ? json
              : [];
        if (!cancelled) setCustomers(rows);
      } catch {
        if (!cancelled) setCustomers([]);
      }
    };
    loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.customerName.trim()) {
      setError('Customer name is required');
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
        customerId: form.customerId || null,
        amount: Number(form.amount),
        notes: form.notes || undefined,
      };
      const res = await fetch(
        mode === 'create' ? '/api/backend/receivables' : `/api/backend/receivables/${initial!.id}`,
        {
          method: mode === 'create' ? 'POST' : 'PATCH',
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
      title={mode === 'create' ? 'Create Receivable' : 'Edit Receivable'}
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
              customerId: '',
              customerName: '',
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
          label="Linked Customer"
          value={form.customerId}
          onChange={(e) => {
            const customerId = e.target.value;
            const customer = customers.find((c) => c.id === customerId);
            setForm((f) => ({
              ...f,
              customerId,
              customerName: customer?.name ?? '',
            }));
          }}
          placeholder="Select an operations customer…"
        >
          <option value="">Manual / unlinked customer</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
              {customer.customerCode ? ` (${customer.customerCode})` : ''}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Customer Name"
          required
          disabled={Boolean(form.customerId)}
          value={form.customerName}
          onChange={(e) => set('customerName', e.target.value)}
          placeholder="Customer name"
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

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({
  receivable,
  onClose,
  onDeleted,
}: {
  receivable: Receivable;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    await fetch(`/api/backend/receivables/${receivable.id}`, { method: 'DELETE' });
    onDeleted();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Receivable"
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
        Delete receivable{' '}
        <span className="font-medium">
          {receivable.receivableNumber ?? receivable.id.slice(0, 8)}
        </span>
        ?
      </p>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReceivablesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Receivable> | null>(null);
  const [accounts, setAccounts] = useState<Paginated<ReceivableAccount> | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'accounts' | 'documents'>('accounts');
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Receivable | null>(null);
  const [editing, setEditing] = useState<Receivable | null>(null);
  const [deleting, setDeleting] = useState<Receivable | null>(null);
  const [recordingPayment, setRecordingPayment] = useState<Receivable | null>(null);
  const [writingOff, setWritingOff] = useState<Receivable | null>(null);

  const canView = hasPermission('receivables.view');
  const canManage = hasPermission('receivables.manage');

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
      const endpoint =
        viewMode === 'accounts' ? '/api/backend/receivables/accounts' : '/api/backend/receivables';
      const res = await fetch(`${endpoint}?${params}`);
      const json = await res.json();
      if (viewMode === 'accounts') {
        setAccounts(json.data ?? null);
      } else {
        setData(json.data ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [canView, page, companyId, status, viewMode]);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
    setExpandedAccounts({});
  };

  const switchViewMode = (mode: 'accounts' | 'documents') => {
    setViewMode(mode);
    setPage(1);
    setExpandedAccounts({});
  };

  const totalOutstanding =
    viewMode === 'accounts'
      ? (accounts?.data.reduce((s, account) => s + account.outstandingAmount, 0) ?? 0)
      : (data?.data.reduce((s, r) => s + receivableOutstandingAmount(r), 0) ?? 0);
  const totalOverdue =
    viewMode === 'accounts'
      ? (accounts?.data.reduce((s, account) => s + account.overdueAmount, 0) ?? 0)
      : (data?.data
          .filter((r) => r.status === 'OVERDUE')
          .reduce((s, r) => s + receivableOutstandingAmount(r), 0) ?? 0);
  const totalRecords = viewMode === 'accounts' ? (accounts?.total ?? 0) : (data?.total ?? 0);
  const openRecords =
    viewMode === 'accounts'
      ? (accounts?.data.filter((account) => account.outstandingAmount > 0).length ?? 0)
      : (data?.data.filter((r) => r.status === 'OPEN').length ?? 0);
  const paginated = viewMode === 'accounts' ? accounts : data;

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Receivables" subtitle="Manage accounts receivable" />
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
        <ReceivableModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {viewing && <ReceivableDetailModal receivable={viewing} onClose={() => setViewing(null)} />}
      {editing && (
        <ReceivableModal
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
          receivable={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            load();
          }}
        />
      )}
      {recordingPayment && (
        <RecordPaymentModal
          receivable={recordingPayment}
          onClose={() => setRecordingPayment(null)}
          onDone={() => {
            setRecordingPayment(null);
            load();
          }}
        />
      )}
      {writingOff && (
        <WriteOffDialog
          receivable={writingOff}
          onClose={() => setWritingOff(null)}
          onDone={() => {
            setWritingOff(null);
            load();
          }}
        />
      )}

      <PageHeader title="Receivables" subtitle="Accounts receivable management (AR)" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={viewMode === 'accounts' ? 'Customer Accounts' : 'Documents'}
          value={totalRecords}
        />
        <StatCard label="Open" value={openRecords} />
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
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              variant={viewMode === 'accounts' ? 'primary' : 'secondary'}
              onClick={() => switchViewMode('accounts')}
            >
              Customer Accounts
            </Btn>
            <Btn
              variant={viewMode === 'documents' ? 'primary' : 'secondary'}
              onClick={() => switchViewMode('documents')}
            >
              AR Documents
            </Btn>
            {canManage ? (
              <Btn variant="primary" onClick={() => setCreating(true)}>
                + New AR
              </Btn>
            ) : null}
          </div>
        }
      />

      {viewMode === 'accounts' ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-4 py-3">Customer Account</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3 text-right">Documents</th>
                  <th className="px-4 py-3 text-right">Total Debt</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right">Overdue</th>
                  <th className="px-4 py-3">Next Due</th>
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
                ) : !accounts?.data.length ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-10 text-center text-sm"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    >
                      No customer accounts found
                    </td>
                  </tr>
                ) : (
                  accounts.data.map((account) => {
                    const expanded = expandedAccounts[account.accountKey];
                    return (
                      <Fragment key={account.accountKey}>
                        <tr className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="font-semibold">{account.customerName}</div>
                            <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                              {account.customerCode ?? 'Unlinked customer'} · {account.currency}
                            </div>
                          </td>
                          <td className="px-4 py-3">{account.company?.name ?? '-'}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            {account.documentCount}
                            {account.openDocumentCount > 0 ? (
                              <span style={{ color: 'var(--aurora-text-muted)' }}>
                                {' '}
                                ({account.openDocumentCount} open)
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {fmtTZS(account.amount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-green-700">
                            {fmtTZS(account.paidAmount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-semibold">
                            {fmtTZS(account.outstandingAmount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {fmtTZS(account.overdueAmount)}
                          </td>
                          <td className="px-4 py-3">{fmtDate(account.nextDueDate)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={account.status} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {account.outstandingAmount > 0.005 ? (
                                <DocumentArtifactButton
                                  entityType="CUSTOMER_DEBT_STATEMENT"
                                  entityId={account.accountKey}
                                  buttonLabel="Export Debt PDF"
                                  compact
                                />
                              ) : null}
                              <Btn
                                variant="secondary"
                                size="xs"
                                onClick={() =>
                                  setExpandedAccounts((prev) => ({
                                    ...prev,
                                    [account.accountKey]: !expanded,
                                  }))
                                }
                              >
                                {expanded ? 'Hide Details' : 'View Details'}
                              </Btn>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={10} className="px-4 py-4">
                              <div
                                className="rounded-lg border overflow-hidden"
                                style={{ borderColor: 'var(--aurora-border)' }}
                              >
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr
                                      className="text-left uppercase"
                                      style={{
                                        color: 'var(--aurora-text-muted)',
                                        background: 'var(--aurora-bg-subtle)',
                                      }}
                                    >
                                      <th className="px-3 py-2">AR #</th>
                                      <th className="px-3 py-2">Issue</th>
                                      <th className="px-3 py-2">Due</th>
                                      <th className="px-3 py-2 text-right">Amount</th>
                                      <th className="px-3 py-2 text-right">Paid</th>
                                      <th className="px-3 py-2 text-right">Outstanding</th>
                                      <th className="px-3 py-2">Status</th>
                                      <th className="px-3 py-2 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {account.documents.map((r) => (
                                      <tr key={r.id}>
                                        <td className="px-3 py-2 font-mono">
                                          {r.receivableNumber ?? r.id.slice(0, 8)}
                                        </td>
                                        <td className="px-3 py-2">{fmtDate(r.issueDate)}</td>
                                        <td className="px-3 py-2">{fmtDate(r.dueDate)}</td>
                                        <td className="px-3 py-2 text-right font-mono">
                                          {fmtTZS(r.amount)}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono text-green-700">
                                          {fmtTZS(receivablePaidAmount(r))}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold">
                                          {fmtTZS(receivableOutstandingAmount(r))}
                                        </td>
                                        <td className="px-3 py-2">
                                          <StatusBadge status={r.status} />
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="flex items-center justify-end gap-1.5">
                                            <Btn
                                              variant="secondary"
                                              size="xs"
                                              onClick={() => setViewing(r)}
                                            >
                                              View
                                            </Btn>
                                            {canManage && (
                                              <>
                                                {(r.status === 'OPEN' ||
                                                  r.status === 'PARTIALLY_PAID' ||
                                                  r.status === 'OVERDUE') && (
                                                  <Btn
                                                    variant="success"
                                                    size="xs"
                                                    onClick={() => setRecordingPayment(r)}
                                                  >
                                                    Pay
                                                  </Btn>
                                                )}
                                                {(r.status === 'OPEN' ||
                                                  r.status === 'OVERDUE') && (
                                                  <Btn
                                                    variant="warning"
                                                    size="xs"
                                                    onClick={() => setWritingOff(r)}
                                                  >
                                                    Write Off
                                                  </Btn>
                                                )}
                                                {r.status === 'OPEN' && (
                                                  <Btn
                                                    variant="ghost"
                                                    size="xs"
                                                    onClick={() => setEditing(r)}
                                                  >
                                                    Edit
                                                  </Btn>
                                                )}
                                                {r.status === 'OPEN' && (
                                                  <Btn
                                                    variant="danger"
                                                    size="xs"
                                                    onClick={() => setDeleting(r)}
                                                  >
                                                    Delete
                                                  </Btn>
                                                )}
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr
                  className="text-left text-xs uppercase bg-gray-50"
                  style={{ color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-4 py-3">AR #</th>
                  <th className="px-4 py-3">Customer</th>
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
                      No receivables found
                    </td>
                  </tr>
                ) : (
                  data.data.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs">
                        <div className="space-y-1">
                          <div>{r.receivableNumber ?? r.id.slice(0, 8)}</div>
                          <button
                            type="button"
                            onClick={() => setViewing(r)}
                            className="font-sans text-[11px] font-semibold hover:underline"
                            style={{ color: 'var(--aurora-primary-text)' }}
                          >
                            View details
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{receivableCustomerName(r)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtTZS(r.amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-green-700">
                        {fmtTZS(receivablePaidAmount(r))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold">
                        {fmtTZS(receivableOutstandingAmount(r))}
                      </td>
                      <td className="px-4 py-3">{fmtDate(r.issueDate)}</td>
                      <td className="px-4 py-3">{fmtDate(r.dueDate)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {agingBucket(r.dueDate)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn variant="secondary" size="xs" onClick={() => setViewing(r)}>
                            View
                          </Btn>
                          {canManage && (
                            <>
                              {(r.status === 'OPEN' ||
                                r.status === 'PARTIALLY_PAID' ||
                                r.status === 'OVERDUE') && (
                                <Btn
                                  variant="success"
                                  size="xs"
                                  onClick={() => setRecordingPayment(r)}
                                >
                                  Pay
                                </Btn>
                              )}
                              {(r.status === 'OPEN' || r.status === 'OVERDUE') && (
                                <Btn variant="warning" size="xs" onClick={() => setWritingOff(r)}>
                                  Write Off
                                </Btn>
                              )}
                              {r.status === 'OPEN' && (
                                <Btn variant="ghost" size="xs" onClick={() => setEditing(r)}>
                                  Edit
                                </Btn>
                              )}
                              {r.status === 'OPEN' && (
                                <Btn variant="danger" size="xs" onClick={() => setDeleting(r)}>
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
      )}

      {paginated && paginated.totalPages > 1 && viewMode === 'accounts' && (
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Page {paginated.page} of {paginated.totalPages} · {paginated.total} total
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
              disabled={page >= paginated.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
