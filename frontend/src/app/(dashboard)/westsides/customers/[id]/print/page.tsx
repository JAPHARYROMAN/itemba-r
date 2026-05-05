'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  DocumentActions,
  DocumentKeyValueGrid,
  DocumentSection,
  DocumentShell,
  DocumentStatGrid,
  DocumentTable,
  EmptyDocumentState,
  documentOrganization,
} from '@/components/documents';
import { Card, PageSpinner } from '@/components/ui';

interface Customer {
  id: string;
  customerCode: string;
  name: string;
  customerType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  paymentTerms?: string | null;
  status: string;
  company?: {
    id: string;
    name: string;
    code: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    logoUrl?: string | null;
    group?: {
      name?: string | null;
      code?: string | null;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
      website?: string | null;
    } | null;
    profile?: {
      registeredName?: string | null;
      tradingName?: string | null;
      brelaRegNumber?: string | null;
      tin?: string | null;
      vrn?: string | null;
      registeredAddress?: string | null;
      postalAddress?: string | null;
    } | null;
  } | null;
  branch?: { id: string; name: string; code?: string | null; address?: string | null; phone?: string | null } | null;
}

interface CustomerProfile {
  customer: Customer;
  credit: {
    creditLimit: number;
    currentBalance: number;
    totalReceivable: number;
    overdueAmount: number;
    overdueCount: number;
    openReceivables: number;
    creditAvailable: number;
    creditUtilizationPct: number;
  };
  lifetime: {
    ordersCount: number;
    totalSpend: number;
  };
  recentOrders: Array<{
    id: string;
    salesOrderNumber: string;
    orderDate: string;
    totalAmount: number | string;
    paidAmount: number | string;
    outstandingAmount: number | string;
    status: string;
    paymentStatus: string;
    paymentMethod?: string | null;
    salesperson?: { id: string; fullName?: string | null; employeeCode?: string | null } | null;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    sku?: string | null;
    totalQuantity: number;
    totalSpend: number;
  }>;
  recentPayments: Array<{
    id: string;
    receivableNumber: string;
    amount: number | string;
    paidAmount: number | string;
    updatedAt: string;
  }>;
  preferredSalesperson: { id: string; fullName?: string | null; employeeCode?: string | null } | null;
}

const fmt = (n: number | string | undefined | null) =>
  new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));

export default function CustomerPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    fetch(`/api/backend/customers/${id}/profile`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body?.message ?? `HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(body => setProfile(body.data ?? body))
      .catch(err => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;

  if (error) {
    return (
      <div className="p-6">
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</Card>
      </div>
    );
  }

  if (!profile) return null;

  const { customer, credit, lifetime, recentOrders, topProducts, recentPayments, preferredSalesperson } = profile;
  const salespersonName = preferredSalesperson?.fullName ?? preferredSalesperson?.employeeCode ?? 'N/A';

  return (
    <DocumentShell
      title="Customer Profile"
      subtitle={customer.name}
      reference={customer.customerCode}
      status={label(customer.status)}
      statusTone={customerStatusTone(customer.status)}
      organization={documentOrganization(customer.company, customer.branch)}
      generatedAt={generatedAt}
      meta={[
        { label: 'Customer Code', value: customer.customerCode },
        { label: 'Customer Type', value: label(customer.customerType) },
        { label: 'Payment Terms', value: valueOrNA(customer.paymentTerms) },
        { label: 'Preferred Salesperson', value: salespersonName },
      ]}
      actions={
        <DocumentActions
          backHref={`/westsides/customers/${customer.id}`}
          backLabel="Back to Profile"
          label="Customer document preview"
          entityType="CUSTOMER_PROFILE"
          entityId={customer.id}
        />
      }
    >
      <DocumentSection title="Customer Details">
        <DocumentKeyValueGrid
          items={[
            { label: 'Customer Name', value: customer.name },
            { label: 'Status', value: label(customer.status) },
            { label: 'Phone', value: valueOrNA(customer.phone) },
            { label: 'Email', value: valueOrNA(customer.email) },
            { label: 'Contact Person', value: valueOrNA(customer.contactPerson) },
            { label: 'Address', value: valueOrNA(customer.address) },
            { label: 'Company', value: customer.company?.name ?? 'N/A' },
            { label: 'Branch', value: customer.branch?.name ?? 'N/A' },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Credit Position">
        <DocumentStatGrid
          items={[
            { label: 'Credit Limit', value: money(credit.creditLimit), hint: 'Approved customer limit' },
            { label: 'Outstanding', value: money(credit.totalReceivable), hint: `${credit.openReceivables} open receivable${credit.openReceivables === 1 ? '' : 's'}` },
            { label: 'Available Credit', value: money(credit.creditAvailable), tone: credit.creditAvailable < 0 ? 'danger' : 'success' },
            { label: 'Overdue', value: money(credit.overdueAmount), hint: `${credit.overdueCount} overdue receivable${credit.overdueCount === 1 ? '' : 's'}`, tone: credit.overdueAmount > 0 ? 'danger' : 'neutral' },
          ]}
        />
        <div className="mt-4">
          <DocumentKeyValueGrid
            items={[
              { label: 'Current Balance', value: money(credit.currentBalance) },
              { label: 'Credit Utilization', value: `${credit.creditUtilizationPct.toFixed(1)}%` },
              { label: 'Lifetime Spend', value: money(lifetime.totalSpend) },
              { label: 'Lifetime Orders', value: lifetime.ordersCount.toLocaleString('en-GB') },
            ]}
          />
        </div>
      </DocumentSection>

      <DocumentSection title="Recent Orders" description="Last 10 orders">
        {recentOrders.length > 0 ? (
          <DocumentTable>
            <thead className="bg-slate-50">
              <tr>
                <Th>Order</Th>
                <Th>Date</Th>
                <Th>Salesperson</Th>
                <Th align="right">Total</Th>
                <Th align="right">Outstanding</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map(order => (
                <tr key={order.id} className="border-t border-slate-200">
                  <Td mono>{order.salesOrderNumber}</Td>
                  <Td>{formatDate(order.orderDate)}</Td>
                  <Td>{order.salesperson?.fullName ?? order.salesperson?.employeeCode ?? 'N/A'}</Td>
                  <Td align="right">{fmt(order.totalAmount)}</Td>
                  <Td align="right">{Number(order.outstandingAmount) > 0 ? fmt(order.outstandingAmount) : 'N/A'}</Td>
                  <Td>{label(order.status)}</Td>
                </tr>
              ))}
            </tbody>
          </DocumentTable>
        ) : (
          <EmptyDocumentState>No orders have been recorded for this customer.</EmptyDocumentState>
        )}
      </DocumentSection>

      <DocumentSection title="Recent Payments" description="Last 10 settled receivables">
        {recentPayments.length > 0 ? (
          <DocumentTable>
            <thead className="bg-slate-50">
              <tr>
                <Th>Receivable</Th>
                <Th>Settled</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Paid</Th>
              </tr>
            </thead>
            <tbody>
              {recentPayments.map(payment => (
                <tr key={payment.id} className="border-t border-slate-200">
                  <Td mono>{payment.receivableNumber}</Td>
                  <Td>{formatDate(payment.updatedAt)}</Td>
                  <Td align="right">{fmt(payment.amount)}</Td>
                  <Td align="right">{fmt(payment.paidAmount)}</Td>
                </tr>
              ))}
            </tbody>
          </DocumentTable>
        ) : (
          <EmptyDocumentState>No settled payments have been recorded for this customer.</EmptyDocumentState>
        )}
      </DocumentSection>

      <DocumentSection title="Top Products" description="Last 90 days">
        {topProducts.length > 0 ? (
          <DocumentTable>
            <thead className="bg-slate-50">
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Spend</Th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map(product => (
                <tr key={product.productId} className="border-t border-slate-200">
                  <Td>{product.productName}</Td>
                  <Td mono>{product.sku ?? 'N/A'}</Td>
                  <Td align="right">{product.totalQuantity.toLocaleString('en-GB')}</Td>
                  <Td align="right">{fmt(product.totalSpend)}</Td>
                </tr>
              ))}
            </tbody>
          </DocumentTable>
        ) : (
          <EmptyDocumentState>No product purchases are available for the last 90 days.</EmptyDocumentState>
        )}
      </DocumentSection>
    </DocumentShell>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th className={`px-3 py-2 ${alignClass} text-[10px] font-bold uppercase tracking-wide text-slate-600`}>
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  mono = false,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
}) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <td className={`px-3 py-2 ${alignClass} align-top text-xs text-slate-800 ${mono ? 'font-mono' : ''}`}>
      {children}
    </td>
  );
}

function money(value: number | string | undefined | null) {
  return `TZS ${fmt(value)}`;
}

function valueOrNA(value: string | null | undefined) {
  return value?.trim() ? value : 'N/A';
}

function label(value: string | null | undefined) {
  return valueOrNA(value).replace(/_/g, ' ');
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString('en-GB');
}

function customerStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const normalized = status.toLowerCase();
  if (normalized.includes('active')) return 'success';
  if (normalized.includes('suspend') || normalized.includes('block')) return 'danger';
  if (normalized.includes('pending')) return 'warning';
  return 'neutral';
}
