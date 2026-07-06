'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { backendGet } from '@/lib/api-client';
import { Card, PageSpinner } from '@/components/ui';

interface QuotationLine {
  id: string;
  description?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  lineTotal?: number | string | null;
  product?: { name?: string | null; sku?: string | null; productCode?: string | null } | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  quotationDate: string;
  validUntil?: string | null;
  quotationType: string;
  customerName?: string | null;
  status: string;
  currency: string;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  approvedAt?: string | null;
  convertedSalesOrderId?: string | null;
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
  customer?: {
    name?: string | null;
    customerCode?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    contactPerson?: string | null;
  } | null;
  lines?: QuotationLine[];
}

export default function QuotationPrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [record, setRecord] = useState<Quotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    backendGet<Quotation>(`/westsides/quotations/${id}`)
      .then(setRecord)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (error) return <ErrorCard message={error} />;
  if (!record) return null;

  const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
  const lines = record.lines ?? [];

  return (
    <DocumentShell
      title="Quotation"
      subtitle={customerName}
      reference={record.quotationNumber}
      status={labelDocumentValue(record.status)}
      statusTone={documentStatusTone(record.status)}
      organization={documentOrganization(record.company, record.branch)}
      generatedAt={generatedAt}
      meta={[
        { label: 'Quotation Number', value: record.quotationNumber },
        { label: 'Quotation Date', value: formatDocumentDate(record.quotationDate) },
        { label: 'Valid Until', value: formatDocumentDate(record.validUntil) },
        { label: 'Quotation Type', value: labelDocumentValue(record.quotationType) },
      ]}
      actions={
        <DocumentActions
          backHref="/westsides/quotations"
          label="Quotation preview"
          entityType="QUOTATION"
          entityId={record.id}
        />
      }
    >
      <DocumentSection title="Customer Details">
        <DocumentKeyValueGrid
          items={[
            { label: 'Customer', value: customerName },
            { label: 'Customer Code', value: valueOrNA(record.customer?.customerCode) },
            { label: 'Phone', value: valueOrNA(record.customer?.phone) },
            { label: 'Email', value: valueOrNA(record.customer?.email) },
            { label: 'Contact Person', value: valueOrNA(record.customer?.contactPerson) },
            { label: 'Address', value: valueOrNA(record.customer?.address) },
            { label: 'Approved At', value: formatDocumentDate(record.approvedAt) },
            { label: 'Converted Sales Order', value: valueOrNA(record.convertedSalesOrderId) },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Line Items">
        {lines.length > 0 ? (
          <>
            <DocumentTable>
              <thead>
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
                  <tr key={line.id}>
                    <DocumentTd>{line.description || line.product?.name || 'N/A'}</DocumentTd>
                    <DocumentTd mono>
                      {line.product?.sku ?? line.product?.productCode ?? 'N/A'}
                    </DocumentTd>
                    <DocumentTd align="right">{formatQty(line.quantity)}</DocumentTd>
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
              ]}
            />
          </>
        ) : (
          <EmptyDocumentState>No line items are attached to this quotation.</EmptyDocumentState>
        )}
      </DocumentSection>

      {record.notes && (
        <DocumentSection title="Notes">
          <DocumentNotePanel>{record.notes}</DocumentNotePanel>
        </DocumentSection>
      )}

      <DocumentSection title="Acceptance">
        <DocumentSignatureGrid labels={['Issued By', 'Customer Acceptance', 'Approved By']} />
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
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(
    Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0,
  );
}
