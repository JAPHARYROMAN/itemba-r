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
  DocumentStatGrid,
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
  proformaLineBudget,
} from '@/components/documents/document-line-budget';
import { backendGet } from '@/lib/api-client';
import { ErrorState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

interface ProformaLine {
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

interface ProformaInvoice {
  id: string;
  proformaNumber: string;
  proformaDate: string;
  validUntil?: string | null;
  customerName?: string | null;
  status: string;
  currency: string;
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  quotationId?: string | null;
  convertedSalesOrderId?: string | null;
  notes?: string | null;
  company?: {
    name?: string | null;
    code?: string | null;
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
  quotation?: { quotationNumber?: string | null } | null;
  lines?: ProformaLine[];
}

export default function ProformaInvoicePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('proformas.view');
  const beginRequest = useRequestGuard();
  const [record, setRecord] = useState<ProformaInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    if (authLoading || !canView || !id) return;
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const next = await backendGet<ProformaInvoice>(`/westsides/proforma-invoices/${id}`, {
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
  }, [authLoading, beginRequest, canView, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading) return <PageSpinner />;
  if (!canView) return <ErrorState message="Access Restricted" />;
  if (loading) return <PageSpinner />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!record) return null;

  const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
  const lines = record.lines ?? [];
  const split = layoutDocumentLines(lines, proformaLineBudget(Boolean(record.notes?.trim())));
  const branchLabel = [record.branch?.code, record.branch?.name].filter(Boolean).join(' - ');

  return (
    <DocumentShell
      title="PROFORMA INVOICE"
      subtitle={customerName}
      reference={record.proformaNumber}
      status={labelDocumentValue(record.status)}
      statusTone={documentStatusTone(record.status)}
      organization={documentOrganization(record.company, record.branch)}
      generatedAt={generatedAt}
      footerNote="This proforma invoice is issued for quotation and payment planning only. It is not a tax invoice or receipt until converted and formally invoiced in ITEMBA-R."
      meta={[
        { label: 'Proforma Number', value: record.proformaNumber },
        { label: 'Proforma Date', value: formatDocumentDate(record.proformaDate) },
        { label: 'Valid Until', value: formatDocumentDate(record.validUntil) },
        { label: 'Currency', value: record.currency },
        {
          label: 'Related Quotation',
          value: valueOrNA(record.quotation?.quotationNumber ?? record.quotationId),
        },
      ]}
      actions={
        <DocumentActions
          backHref="/westsides/proforma-invoices"
          label="Proforma invoice preview"
          entityType="PROFORMA_INVOICE"
          entityId={record.id}
        />
      }
      continuation={
        split.overflowLines.length > 0 ? (
          <DocumentSection title="Line Items (continued)">
            <DocumentTable>
              <ProformaHead />
              <tbody>
                {split.overflowLines.map((line) => (
                  <ProformaRow key={line.id} line={line} currency={record.currency} />
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
      <DocumentStatGrid
        items={[
          {
            label: 'Proforma Total',
            value: formatDocumentMoney(record.totalAmount, record.currency),
            tone: 'success',
          },
          {
            label: 'Valid Until',
            value: formatDocumentDate(record.validUntil),
            tone: 'warning',
          },
          {
            label: 'Line Items',
            value: lines.length,
            hint: 'Products and services quoted below.',
          },
          {
            label: 'Status',
            value: labelDocumentValue(record.status),
            tone: documentStatusTone(record.status) === 'danger' ? 'danger' : 'neutral',
          },
        ]}
      />

      <DocumentSection title="Prepared For">
        <DocumentKeyValueGrid
          items={[
            { label: 'Customer', value: customerName },
            { label: 'Customer Code', value: valueOrNA(record.customer?.customerCode) },
            { label: 'Phone', value: valueOrNA(record.customer?.phone) },
            { label: 'Email', value: valueOrNA(record.customer?.email) },
            { label: 'Contact Person', value: valueOrNA(record.customer?.contactPerson) },
            { label: 'Address', value: valueOrNA(record.customer?.address) },
            { label: 'Branch / Location', value: valueOrNA(branchLabel) },
            { label: 'Converted Sales Order', value: valueOrNA(record.convertedSalesOrderId) },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Validity & Commercial Terms">
        <DocumentKeyValueGrid
          items={[
            { label: 'Validity', value: formatDocumentDate(record.validUntil) },
            { label: 'Currency', value: record.currency },
            { label: 'Pricing Basis', value: 'Subject to stock availability at confirmation.' },
            {
              label: 'Document Notice',
              value: 'This is a proforma invoice, not a fiscal tax invoice or receipt.',
            },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Line Items">
        {lines.length > 0 ? (
          <>
            {split.firstPageLines.length > 0 && (
              <DocumentTable>
                <ProformaHead />
                <tbody>
                  {split.firstPageLines.map((line) => (
                    <ProformaRow key={line.id} line={line} currency={record.currency} />
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
              ]}
            />
          </>
        ) : (
          <EmptyDocumentState>
            No line items are attached to this proforma invoice.
          </EmptyDocumentState>
        )}
      </DocumentSection>

      {record.notes && (
        <DocumentSection title="Notes">
          <DocumentNotePanel>{record.notes}</DocumentNotePanel>
        </DocumentSection>
      )}

      <DocumentSection title="Authorization">
        <DocumentSignatureGrid labels={['Issued By', 'Reviewed By', 'Customer']} />
      </DocumentSection>
    </DocumentShell>
  );
}

function ProformaHead() {
  return (
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
  );
}

function ProformaRow({ line, currency }: { line: ProformaLine; currency: string }) {
  return (
    <tr>
      <DocumentTd>{line.description || line.product?.name || 'N/A'}</DocumentTd>
      <DocumentTd mono>{line.product?.sku ?? line.product?.productCode ?? 'N/A'}</DocumentTd>
      <DocumentTd align="right">{formatQty(line.quantity)}</DocumentTd>
      <DocumentTd>{line.unit?.symbol ?? line.unit?.name ?? 'N/A'}</DocumentTd>
      <DocumentTd align="right">{formatDocumentMoney(line.unitPrice, currency)}</DocumentTd>
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
