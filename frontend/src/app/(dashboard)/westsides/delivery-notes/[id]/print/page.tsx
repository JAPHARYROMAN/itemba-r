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
  EmptyDocumentState,
  documentOrganization,
  documentStatusTone,
  formatDocumentDate,
  labelDocumentValue,
  valueOrNA,
} from '@/components/documents';
import { backendGet } from '@/lib/api-client';
import { Card, PageSpinner } from '@/components/ui';

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
  const [record, setRecord] = useState<DeliveryNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generatedAt = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    backendGet<DeliveryNote>(`/westsides/delivery-notes/${id}`)
      .then(setRecord)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSpinner />;
  if (error) return <ErrorCard message={error} />;
  if (!record) return null;

  const number = record.deliveryNoteNumber ?? record.dnNumber ?? record.id.slice(0, 8);
  const date = record.deliveryDate ?? record.dnDate;
  const customerName = record.customer?.name ?? record.customerName ?? 'N/A';
  const lines = record.lines ?? [];

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
          <DocumentTable>
            <thead className="bg-slate-50">
              <tr>
                <DocumentTh>Item</DocumentTh>
                <DocumentTh>SKU</DocumentTh>
                <DocumentTh align="right">Ordered</DocumentTh>
                <DocumentTh align="right">Delivered</DocumentTh>
                <DocumentTh>Unit</DocumentTh>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-slate-200">
                  <DocumentTd>{line.description || line.product?.name || 'N/A'}</DocumentTd>
                  <DocumentTd mono>
                    {line.product?.sku ?? line.product?.productCode ?? 'N/A'}
                  </DocumentTd>
                  <DocumentTd align="right">{formatQty(line.orderedQuantity)}</DocumentTd>
                  <DocumentTd align="right">{formatQty(line.deliveredQuantity)}</DocumentTd>
                  <DocumentTd>{line.unit?.symbol ?? line.unit?.name ?? 'N/A'}</DocumentTd>
                </tr>
              ))}
            </tbody>
          </DocumentTable>
        ) : (
          <EmptyDocumentState>No line items are attached to this delivery note.</EmptyDocumentState>
        )}
      </DocumentSection>

      {record.notes && (
        <DocumentSection title="Notes">
          <p className="text-sm leading-6 text-slate-700">{record.notes}</p>
        </DocumentSection>
      )}

      <DocumentSection title="Acknowledgement">
        <DocumentSignatureGrid labels={['Dispatch Clerk', 'Driver', 'Receiver']} />
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
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(Number(value ?? 0));
}
