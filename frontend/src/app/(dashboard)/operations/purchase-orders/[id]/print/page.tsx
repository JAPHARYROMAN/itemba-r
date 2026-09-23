'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  DocumentActions,
  DocumentKeyValueGrid,
  DocumentNotePanel,
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
import {
  layoutDocumentLines,
  purchaseOrderLineBudget,
} from '@/components/documents/document-line-budget';
import { backendGet } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { ErrorState, PageSpinner } from '@/components/ui';

interface PurchaseOrderLine {
  id: string;
  description?: string | null;
  quantity?: number | string | null;
  unitCost?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  lineTotal?: number | string | null;
  product?: { name?: string | null; sku?: string | null; productCode?: string | null } | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

interface PurchaseOrder {
  id: string;
  purchaseOrderNumber?: string | null;
  orderDate: string;
  expectedDate?: string | null;
  displayInvoiceNumber?: string | null;
  displayInvoiceDate?: string | null;
  invoiceSource?: string | null;
  purchaseType: string;
  supplierName?: string | null;
  status: string;
  paymentStatus: string;
  currency: string;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  paidAmount?: number | string | null;
  outstandingAmount?: number | string | null;
  notes?: string | null;
  confirmedAt?: string | null;
  receivedAt?: string | null;
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
  supplier?: {
    name?: string | null;
    supplierCode?: string | null;
    tin?: string | null;
    vrn?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    contactPerson?: string | null;
    paymentTerms?: string | null;
  } | null;
  createdBy?: { fullName?: string | null } | null;
  confirmedBy?: { fullName?: string | null } | null;
  receivedBy?: { fullName?: string | null } | null;
  lines?: PurchaseOrderLine[];
}

export default function PurchaseOrderPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const { hasPermission } = useAuth();
  const canView = hasPermission('purchases.view');
  const beginRequest = useRequestGuard();
  const [record, setRecord] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    if (!canView || !id) return;
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const next = await backendGet<PurchaseOrder>(`/purchase-orders/${id}`, {
        signal: request.signal,
      });
      if (!request.current()) return;
      setRecord(next);
    } catch (err) {
      if (!request.current()) return;
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [beginRequest, canView, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) return <ErrorState message="Access Restricted" />;
  if (loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!record) return null;

  const number = record.purchaseOrderNumber ?? record.id.slice(0, 8);
  const supplierName = record.supplier?.name ?? record.supplierName ?? 'N/A';
  const lines = record.lines ?? [];
  const split = layoutDocumentLines(lines, purchaseOrderLineBudget(Boolean(record.notes?.trim())));

  return (
    <DocumentShell
      title="Purchase Order"
      subtitle={supplierName}
      reference={number}
      status={labelDocumentValue(record.status)}
      statusTone={documentStatusTone(record.status)}
      organization={documentOrganization(record.company, record.branch)}
      generatedAt={generatedAt}
      meta={[
        { label: 'Purchase Order', value: number },
        { label: 'Order Date', value: formatDocumentDate(record.orderDate) },
        { label: 'Expected Date', value: formatDocumentDate(record.expectedDate) },
        { label: 'Supplier Invoice #', value: valueOrNA(record.displayInvoiceNumber) },
        { label: 'Invoice Date', value: formatDocumentDate(record.displayInvoiceDate) },
        { label: 'Payment Status', value: labelDocumentValue(record.paymentStatus) },
      ]}
      actions={
        <DocumentActions
          backHref="/operations/purchase-orders"
          label="Purchase order preview"
          entityType="PURCHASE_ORDER"
          entityId={record.id}
        />
      }
      continuation={
        split.overflowLines.length > 0 ? (
          <DocumentSection title="Line Items (continued)">
            <DocumentTable>
              <PurchaseOrderHead />
              <tbody>
                {split.overflowLines.map((line) => (
                  <PurchaseOrderRow key={line.id} line={line} currency={record.currency} />
                ))}
              </tbody>
            </DocumentTable>
            <p className="mt-3 text-xs text-slate-600">
              Totals for all {lines.length} items are stated on page 1.
            </p>
          </DocumentSection>
        ) : undefined
      }
    >
      <DocumentSection title="Supplier and Order Details">
        <DocumentKeyValueGrid
          items={[
            { label: 'Supplier', value: supplierName },
            { label: 'Supplier Code', value: valueOrNA(record.supplier?.supplierCode) },
            { label: 'TIN', value: valueOrNA(record.supplier?.tin) },
            { label: 'VRN', value: valueOrNA(record.supplier?.vrn) },
            { label: 'Phone', value: valueOrNA(record.supplier?.phone) },
            { label: 'Email', value: valueOrNA(record.supplier?.email) },
            { label: 'Contact Person', value: valueOrNA(record.supplier?.contactPerson) },
            { label: 'Payment Terms', value: valueOrNA(record.supplier?.paymentTerms) },
            { label: 'Address', value: valueOrNA(record.supplier?.address) },
            { label: 'Purchase Type', value: labelDocumentValue(record.purchaseType) },
            { label: 'Invoice Source', value: labelDocumentValue(record.invoiceSource) },
            { label: 'Prepared By', value: valueOrNA(record.createdBy?.fullName) },
            { label: 'Confirmed By', value: valueOrNA(record.confirmedBy?.fullName) },
            { label: 'Received By', value: valueOrNA(record.receivedBy?.fullName) },
            { label: 'Confirmed At', value: formatDocumentDate(record.confirmedAt) },
            { label: 'Received At', value: formatDocumentDate(record.receivedAt) },
            { label: 'Currency', value: record.currency },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Line Items">
        {lines.length > 0 ? (
          <>
            {split.firstPageLines.length > 0 && (
              <DocumentTable>
                <PurchaseOrderHead />
                <tbody>
                  {split.firstPageLines.map((line) => (
                    <PurchaseOrderRow key={line.id} line={line} currency={record.currency} />
                  ))}
                </tbody>
              </DocumentTable>
            )}
            {split.overflowLines.length > 0 && (
              <p className="mt-3 text-xs text-slate-600">
                {split.overflowLines.length} further item(s) continue overleaf. Totals below cover
                every line.
              </p>
            )}
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
                  tone: Number(record.outstandingAmount ?? 0) > 0 ? ('danger' as const) : undefined,
                },
              ]}
            />
          </>
        ) : (
          <EmptyDocumentState>
            No line items are attached to this purchase order.
          </EmptyDocumentState>
        )}
      </DocumentSection>

      {record.notes && (
        <DocumentSection title="Notes">
          <DocumentNotePanel>{record.notes}</DocumentNotePanel>
        </DocumentSection>
      )}

      <DocumentSection title="Authorization">
        <DocumentSignatureGrid labels={['Prepared By', 'Approved By', 'Supplier']} />
      </DocumentSection>
    </DocumentShell>
  );
}

function PurchaseOrderHead() {
  return (
    <thead>
      <tr>
        <DocumentTh>Item</DocumentTh>
        <DocumentTh>SKU</DocumentTh>
        <DocumentTh align="right">Qty</DocumentTh>
        <DocumentTh>Unit</DocumentTh>
        <DocumentTh align="right">Unit Cost</DocumentTh>
        <DocumentTh align="right">Discount</DocumentTh>
        <DocumentTh align="right">Tax</DocumentTh>
        <DocumentTh align="right">Line Total</DocumentTh>
      </tr>
    </thead>
  );
}

function PurchaseOrderRow({ line, currency }: { line: PurchaseOrderLine; currency: string }) {
  return (
    <tr>
      <DocumentTd>{line.description || line.product?.name || 'N/A'}</DocumentTd>
      <DocumentTd mono>{line.product?.sku ?? line.product?.productCode ?? 'N/A'}</DocumentTd>
      <DocumentTd align="right">{formatQty(line.quantity)}</DocumentTd>
      <DocumentTd>{line.unit?.symbol ?? line.unit?.name ?? 'N/A'}</DocumentTd>
      <DocumentTd align="right">{formatDocumentMoney(line.unitCost, currency)}</DocumentTd>
      <DocumentTd align="right">{formatDocumentMoney(line.discountAmount, currency)}</DocumentTd>
      <DocumentTd align="right">{formatDocumentMoney(line.taxAmount, currency)}</DocumentTd>
      <DocumentTd align="right">{formatDocumentMoney(line.lineTotal, currency)}</DocumentTd>
    </tr>
  );
}

function formatQty(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(
    Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0,
  );
}
