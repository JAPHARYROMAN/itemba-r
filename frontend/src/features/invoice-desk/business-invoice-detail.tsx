'use client';
import { Btn, PermissionDeniedState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import type { SupplierInvoice } from '@/app/(dashboard)/procurement/supplier-invoices/page';
import { money, dateLabel } from './types';

export function BusinessInvoiceDetail({ id }: { id: string }) {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('supplier_invoices.view');
  const result = useWorkspaceResource<SupplierInvoice>(
    `/supplier-invoices/${encodeURIComponent(id)}`,
    {},
    allowed,
  );
  if (!allowed) return <PermissionDeniedState />;
  if (result.loading) return <PageSpinner label="Loading supplier invoice" />;
  if (result.error)
    return (
      <p role="alert">
        {result.error} <Btn onClick={result.reload}>Retry</Btn>
      </p>
    );
  const row = result.data;
  if (!row) return null;
  return (
    <section className="space-y-5">
      <Link href="/invoice-desk?view=invoices">All supplier invoices</Link>
      <header>
        <h1>{row.supplierInvoiceNumber}</h1>
        <p>
          {row.supplier?.name} · {row.company?.name} · {row.status}
        </p>
      </header>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt>Invoice date</dt>
          <dd>{dateLabel(row.invoiceDate)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{money(String(row.totalAmount), row.currency)}</dd>
        </div>
        <div>
          <dt>Outstanding</dt>
          <dd>{money(String(row.outstandingAmount), row.currency)}</dd>
        </div>
      </dl>
      {row.purchaseOrder && (
        <Link href={`/operations/purchase-orders/${encodeURIComponent(row.purchaseOrder.id)}`}>
          Purchase order {row.purchaseOrder.purchaseOrderNumber}
        </Link>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <caption className="text-left">Invoice lines</caption>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col">Quantity</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(row.lines ?? []).map((line, index) => (
              <tr key={line.id ?? index}>
                <td>{line.description}</td>
                <td>{String(line.quantity)}</td>
                <td>{money(String(line.lineTotal), row.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {row.notes && <p>{row.notes}</p>}
      {row.payable && hasPermission('payables.view') && (
        <Link href={`/cash-desk/payables?search=${encodeURIComponent(row.payable.payableNumber)}`}>
          Payable {row.payable.payableNumber} · manage supplier payments
        </Link>
      )}
    </section>
  );
}
