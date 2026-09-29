'use client';
import { useState } from 'react';
import { Btn } from '@/components/ui';
import { WorkspaceLink } from '@/components/workspace/workspace-navigation';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';
import { useAuth } from '@/hooks/use-auth';
import { useLinkedDeskChanges } from '@/components/workspace/linked-desk-changes';
import { money, dateLabel } from '@/features/invoice-desk/types';
type Row = {
  id: string;
  saleNumber: string;
  saleDate: string;
  totalAmount: string;
  currency: string;
  canonicalSalesOrderId?: string | null;
};
export function CustomerDirectHistory({ customerId }: { customerId: string }) {
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const result = useWorkspaceResource<{ rows: Row[]; total: number }>(
    `/sales-desk/customers/${encodeURIComponent(customerId)}/sales`,
    { page },
    hasPermission('sales_desk.view') && hasPermission('customers.view'),
  );
  useLinkedDeskChanges('cash-desk', false, result.reload);
  return (
    <section className="space-y-4">
      <p>
        Original direct-register history linked to this customer. Business sales and receivables are
        shown in their own sections; linked historical entries must not be added to those balances.
      </p>
      {result.loading && <p role="status">Loading direct history…</p>}
      {result.error && (
        <p role="alert">
          {result.error} <Btn onClick={result.reload}>Retry</Btn>
        </p>
      )}
      <ul>
        {(result.data?.rows ?? []).map((row) => (
          <li key={row.id} className="border-b py-3">
            <WorkspaceLink href={`/sales-desk?source=direct&record=${encodeURIComponent(row.id)}`}>
              {row.saleNumber}
            </WorkspaceLink>{' '}
            · {dateLabel(row.saleDate)} · {money(row.totalAmount, row.currency)}{' '}
            {row.canonicalSalesOrderId && <span> · Linked business record</span>}
          </li>
        ))}
      </ul>
      {!result.loading && !result.error && !result.data?.total && <p>No linked direct history.</p>}
      <div className="flex items-center gap-3">
        <Btn disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </Btn>
        <span>Page {page}</span>
        <Btn disabled={page * 25 >= (result.data?.total ?? 0)} onClick={() => setPage(page + 1)}>
          Next
        </Btn>
      </div>
    </section>
  );
}
