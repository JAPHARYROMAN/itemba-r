'use client';
import dynamic from 'next/dynamic';
import { PageSpinner, PermissionDeniedState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  WorkspaceLink as Link,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
const loading = () => <PageSpinner label="Opening cash workflow" />;
const Cash = dynamic(() => import('./cash-desk').then((m) => m.CashDesk), { loading });
const Accounts = dynamic(() => import('@/app/(dashboard)/finance/cash-accounts/page'), { loading });
const Payables = dynamic(() => import('@/app/(dashboard)/finance/payables/page'), { loading });
const Receivables = dynamic(() => import('@/app/(dashboard)/finance/receivables/page'), {
  loading,
});
const Expenses = dynamic(() => import('@/app/(dashboard)/finance/expenses/page'), { loading });
export const cashWorkflows = [
  {
    key: 'accounts',
    href: '/cash-desk/accounts',
    label: 'Business accounts',
    permission: 'cash_accounts.view',
  },
  {
    key: 'payables',
    href: '/cash-desk/payables',
    label: 'Supplier payments',
    permission: 'payables.view',
  },
  {
    key: 'receivables',
    href: '/cash-desk/receivables',
    label: 'Customer collections',
    permission: 'receivables.view',
  },
  {
    key: 'expenses',
    href: '/cash-desk/expenses',
    label: 'Business expenses',
    permission: 'expenses.view',
  },
] as const;
export function CashWorkspace({ targetRecordId }: { targetRecordId?: string } = {}) {
  const { hasPermission, loading: authLoading } = useAuth();
  const path = useWorkspacePathname();
  const active =
    cashWorkflows.find((w) =>
      [w.href, `/finance/${w.key === 'accounts' ? 'cash-accounts' : w.key}`].includes(path),
    ) ??
    (path === '/cash-desk' && !hasPermission('cash_desk.view')
      ? cashWorkflows.find((w) => hasPermission(w.permission))
      : undefined);
  if (authLoading) return loading();
  return (
    <div>
      <nav className="report-links flex flex-wrap gap-3 p-4" aria-label="Cash Desk workflows">
        {hasPermission('cash_desk.view') && (
          <Link href="/cash-desk" aria-current={!active ? 'page' : undefined}>
            Cash register
          </Link>
        )}
        {cashWorkflows
          .filter((w) => hasPermission(w.permission))
          .map((w) => (
            <Link
              key={w.key}
              href={w.href}
              aria-current={active?.key === w.key ? 'page' : undefined}
            >
              {w.label}
            </Link>
          ))}
        {hasPermission('journal_entries.view') && (
          <Link href="/reports?view=accounting">Accounting connections</Link>
        )}
        {hasPermission('bank_reconciliations.view') && (
          <Link href="/accounting-engine/bank-reconciliations">Bank reconciliation</Link>
        )}
      </nav>
      {active && !hasPermission(active.permission) ? (
        <PermissionDeniedState />
      ) : active?.key === 'accounts' ? (
        <Accounts />
      ) : active?.key === 'payables' ? (
        <Payables />
      ) : active?.key === 'receivables' ? (
        <Receivables />
      ) : active?.key === 'expenses' ? (
        <Expenses />
      ) : (
        <Cash targetRecordId={targetRecordId} />
      )}
    </div>
  );
}
