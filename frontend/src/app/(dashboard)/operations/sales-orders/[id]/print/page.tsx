'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  DocumentActions,
  DocumentKeyValueGrid,
  DocumentSection,
  DocumentShell,
  DocumentSignatureGrid,
  DocumentTable,
  DocumentTd,
  DocumentTh,
  DocumentTotals,
  EmptyDocumentState,
  documentOrganization,
  documentStatusTone,
  formatDocumentDate,
  formatDocumentMoney,
  labelDocumentValue,
  valueOrNA,
} from '@/components/documents';
import { backendGet } from '@/lib/api-client';
import { Card, PageSpinner } from '@/components/ui';

interface SalesOrderLine {
  id: string;
  description?: string | null;
  quantity?: number | string | null;
  qty?: number | string | null;
  unitPrice?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  lineTotal?: number | string | null;
  product?: { name?: string | null; sku?: string | null; productCode?: string | null } | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

interface SalesOrder {
  id: string;
  salesOrderNumber?: string | null;
  orderNumber?: string | null;
  orderDate: string;
  dueDate?: string | null;
  salesType: string;
  customerName?: string | null;
  status: string;
  paymentStatus: string;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  currency: string;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  paidAmount?: number | string | null;
  outstandingAmount?: number | string | null;
  notes?: string | null;
  company?: {
    name?: string | null;
    code?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  branch?: {
    name?: string | null;
    code?: string | null;
    address?: string | null;
    phone?: string | null;
  } | null;
  customer?: { name?: string | null } | null;
  cashAccount?: { accountName?: string | null; accountType?: string | null } | null;
  createdBy?: { fullName?: string | null } | null;
  confirmedBy?: { fullName?: string | null } | null;
  lines?: SalesOrderLine[];
}

export default function SalesOrderPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [record, setRecord] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    backendGet<SalesOrder>(`/sales-orders/${id}`)
      .then(setRecord)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (error) return <ErrorCard message={error} />;
  if (!record) return null;

  const number = record.salesOrderNumber ?? record.orderNumber ?? record.id.slice(0, 8);
  const customerName = record.customer?.name ?? record.customerName ?? 'Walk-in customer';
  const lines = record.lines ?? [];

  return (
    <DocumentShell
      title="Sales Order"
      subtitle={customerName}
      reference={number}
      status={labelDocumentValue(record.status)}
      statusTone={documentStatusTone(record.status)}
      organization={documentOrganization(record.company, record.branch)}
      generatedAt={generatedAt}
      meta={[
        { label: 'Order Number', value: number },
        { label: 'Order Date', value: formatDocumentDate(record.orderDate) },
        { label: 'Due Date', value: formatDocumentDate(record.dueDate) },
        { label: 'Payment Status', value: labelDocumentValue(record.paymentStatus) },
      ]}
      actions={
        <DocumentActions
          backHref="/operations/sales-orders"
          label="Sales order preview"
          entityType="SALES_ORDER"
          entityId={record.id}
        />
      }
    >
      <DocumentSection title="Customer and Order Details">
        <DocumentKeyValueGrid
          items={[
            { label: 'Customer', value: customerName },
            { label: 'Sales Type', value: labelDocumentValue(record.salesType) },
            { label: 'Payment Method', value: labelDocumentValue(record.paymentMethod) },
            { label: 'Payment Reference', value: valueOrNA(record.paymentReference) },
            { label: 'Cash Account', value: valueOrNA(record.cashAccount?.accountName) },
            { label: 'Prepared By', value: valueOrNA(record.createdBy?.fullName) },
            { label: 'Confirmed By', value: valueOrNA(record.confirmedBy?.fullName) },
            { label: 'Currency', value: record.currency },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Line Items">
        {lines.length > 0 ? (
          <>
            <DocumentTable>
              <thead className="bg-slate-50">
                <tr>
                  <DocumentTh>Item</DocumentTh>
                  <DocumentTh>SKU</DocumentTh>
                  <DocumentTh align="right">Qty</DocumentTh>
                  <DocumentTh>Unit</DocumentTh>
                  <DocumentTh align="right">Unit Price</DocumentTh>
                  <DocumentTh align="right">Discount</DocumentTh>
                  <DocumentTh align="right">Tax</DocumentTh>
                  <DocumentTh align="right">Line Total</DocumentTh>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-t border-slate-200">
                    <DocumentTd>{line.description || line.product?.name || 'N/A'}</DocumentTd>
                    <DocumentTd mono>
                      {line.product?.sku ?? line.product?.productCode ?? 'N/A'}
                    </DocumentTd>
                    <DocumentTd align="right">{formatQty(line.quantity ?? line.qty)}</DocumentTd>
                    <DocumentTd>{line.unit?.symbol ?? line.unit?.name ?? 'N/A'}</DocumentTd>
                    <DocumentTd align="right">
                      {formatDocumentMoney(line.unitPrice, record.currency)}
                    </DocumentTd>
                    <DocumentTd align="right">
                      {formatDocumentMoney(line.discountAmount, record.currency)}
                    </DocumentTd>
                    <DocumentTd align="right">
                      {formatDocumentMoney(line.taxAmount, record.currency)}
                    </DocumentTd>
                    <DocumentTd align="right">
                      {formatDocumentMoney(line.lineTotal, record.currency)}
                    </DocumentTd>
                  </tr>
                ))}
              </tbody>
            </DocumentTable>
            <DocumentTotals
              items={[
                { label: 'Subtotal', value: formatDocumentMoney(record.subtotal, record.currency) },
                {
                  label: 'Discount',
                  value: formatDocumentMoney(record.discountAmount, record.currency),
                },
                { label: 'Tax', value: formatDocumentMoney(record.taxAmount, record.currency) },
                {
                  label: 'Total',
                  value: formatDocumentMoney(record.totalAmount, record.currency),
                  emphasis: true,
                },
                { label: 'Paid', value: formatDocumentMoney(record.paidAmount, record.currency) },
                {
                  label: 'Outstanding',
                  value: formatDocumentMoney(record.outstandingAmount, record.currency),
                  emphasis: true,
                },
              ]}
            />
          </>
        ) : (
          <EmptyDocumentState>No line items are attached to this sales order.</EmptyDocumentState>
        )}
      </DocumentSection>

      {record.notes && (
        <DocumentSection title="Notes">
          <p className="text-sm leading-6 text-slate-700">{record.notes}</p>
        </DocumentSection>
      )}

      <DocumentSection title="Authorization">
        <DocumentSignatureGrid labels={['Prepared By', 'Approved By', 'Customer']} />
      </DocumentSection>
    </DocumentShell>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="p-6">
      <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</Card>
    </div>
  );
}

function formatQty(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0);
}
