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
  EmptyDocumentState,
  documentOrganization,
  documentStatusTone,
  formatDocumentDate,
  labelDocumentValue,
  valueOrNA,
} from '@/components/documents';
import {
  deliveryNoteLineBudget,
  layoutDocumentLines,
} from '@/components/documents/document-line-budget';
import { backendGet } from '@/lib/api-client';
import { ErrorState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

interface DeliveryLine {
  id: string;
  description?: string | null;
  orderedQuantity?: number | string | null;
  deliveredQuantity?: number | string | null;
  product?: { name?: string | null; sku?: string | null; productCode?: string | null } | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

interface DeliveryNote {
  id: string;
  deliveryNoteNumber?: string | null;
  dnNumber?: string | null;
  deliveryDate?: string | null;
  dnDate?: string | null;
  customerName?: string | null;
  deliveryAddress?: string | null;
  vehicleNumber?: string | null;
  driverName?: string | null;
  receivedByName?: string | null;
  receivedByPhone?: string | null;
  status: string;
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
  salesOrder?: { salesOrderNumber?: string | null; orderDate?: string | null } | null;
  deliveredBy?: { fullName?: string | null } | null;
  lines?: DeliveryLine[];
}

export default function DeliveryNotePrintPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('delivery_notes.view');
  const beginRequest = useRequestGuard();
  const [record, setRecord] = useState<DeliveryNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    if (authLoading || !canView || !id) return;
    const request = beginRequest();
    setLoading(true);
    setError('');
    try {
      const next = await backendGet<DeliveryNote>(`/westsides/delivery-notes/${id}`, {
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

  const number = record.deliveryNoteNumber ?? record.dnNumber ?? record.id.slice(0, 8);
  const date = record.deliveryDate ?? record.dnDate;
  const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
  const lines = record.lines ?? [];
  const split = layoutDocumentLines(lines, deliveryNoteLineBudget(Boolean(record.notes?.trim())));

  return (
    <DocumentShell
      title="Delivery Note"
      subtitle={customerName}
      reference={number}
      status={labelDocumentValue(record.status)}
      statusTone={documentStatusTone(record.status)}
      organization={documentOrganization(record.company, record.branch)}
      generatedAt={generatedAt}
      meta={[
        { label: 'Delivery Note', value: number },
        { label: 'Delivery Date', value: formatDocumentDate(date) },
        { label: 'Sales Order', value: valueOrNA(record.salesOrder?.salesOrderNumber) },
        { label: 'Vehicle', value: valueOrNA(record.vehicleNumber) },
      ]}
      actions={
        <DocumentActions
          backHref="/westsides/delivery-notes"
          label="Delivery note preview"
          entityType="DELIVERY_NOTE"
          entityId={record.id}
        />
      }
      continuation={
        split.overflowLines.length > 0 ? (
          <DocumentSection title="Line Items (continued)">
            <DocumentTable>
              <DeliveryHead />
              <tbody>
                {split.overflowLines.map((line) => (
                  <DeliveryRow key={line.id} line={line} />
                ))}
              </tbody>
            </DocumentTable>
            <p className="mt-3 text-xs text-slate-600">
              Acknowledgement for all {lines.length} items is on page 1.
            </p>
          </DocumentSection>
        ) : undefined
      }
    >
      <DocumentSection title="Delivery Details">
        <DocumentKeyValueGrid
          items={[
            { label: 'Customer', value: customerName },
            { label: 'Customer Code', value: valueOrNA(record.customer?.customerCode) },
            {
              label: 'Delivery Address',
              value: valueOrNA(record.deliveryAddress ?? record.customer?.address),
            },
            { label: 'Customer Contact', value: valueOrNA(record.customer?.contactPerson) },
            { label: 'Driver', value: valueOrNA(record.driverName) },
            { label: 'Delivered By', value: valueOrNA(record.deliveredBy?.fullName) },
            { label: 'Received By', value: valueOrNA(record.receivedByName) },
            { label: 'Receiver Phone', value: valueOrNA(record.receivedByPhone) },
          ]}
        />
      </DocumentSection>

      <DocumentSection title="Line Items">
        {lines.length > 0 ? (
          <>
            {split.firstPageLines.length > 0 && (
              <DocumentTable>
                <DeliveryHead />
                <tbody>
                  {split.firstPageLines.map((line) => (
                    <DeliveryRow key={line.id} line={line} />
                  ))}
                </tbody>
              </DocumentTable>
            )}
            {split.overflowLines.length > 0 && (
              <p className="mt-3 text-xs text-slate-600">
                {split.overflowLines.length} further item(s) continue overleaf. The acknowledgement
                below covers every line.
              </p>
            )}
          </>
        ) : (
          <EmptyDocumentState>No line items are attached to this delivery note.</EmptyDocumentState>
        )}
      </DocumentSection>

      {record.notes && (
        <DocumentSection title="Notes">
          <DocumentNotePanel>{record.notes}</DocumentNotePanel>
        </DocumentSection>
      )}

      <DocumentSection title="Acknowledgement">
        <DocumentSignatureGrid labels={['Dispatch Clerk', 'Driver', 'Receiver']} />
      </DocumentSection>
    </DocumentShell>
  );
}

function DeliveryHead() {
  return (
    <thead>
      <tr>
        <DocumentTh>Item</DocumentTh>
        <DocumentTh>SKU</DocumentTh>
        <DocumentTh align="right">Ordered</DocumentTh>
        <DocumentTh align="right">Delivered</DocumentTh>
        <DocumentTh>Unit</DocumentTh>
      </tr>
    </thead>
  );
}

function DeliveryRow({ line }: { line: DeliveryLine }) {
  return (
    <tr>
      <DocumentTd>{line.description || line.product?.name || 'N/A'}</DocumentTd>
      <DocumentTd mono>{line.product?.sku ?? line.product?.productCode ?? 'N/A'}</DocumentTd>
      <DocumentTd align="right">{formatQty(line.orderedQuantity)}</DocumentTd>
      <DocumentTd align="right">{formatQty(line.deliveredQuantity)}</DocumentTd>
      <DocumentTd>{line.unit?.symbol ?? line.unit?.name ?? 'N/A'}</DocumentTd>
    </tr>
  );
}

function formatQty(value: number | string | null | undefined) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(
    Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0,
  );
}
