'use client';
import { ArrowRight, Receipt, Users } from 'lucide-react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceResource } from '@/hooks/use-workspace-resource';

export function SalesDeskOverview() {
  const { hasPermission } = useAuth();
  const canSales = hasPermission('sales.view');
  const canCustomers = hasPermission('customers.view');
  const sales = useWorkspaceResource<{
    totalOrders: number;
    draft: number;
    confirmed: number;
    overdueCreditOrders: number;
  }>('/sales-orders/workbench-summary', {}, canSales);
  const customers = useWorkspaceResource<{ total: number; active: number; blocked: number }>(
    '/customers/workbench-summary',
    {},
    canCustomers,
  );
  const count = (value: number | undefined, loading: boolean) =>
    loading ? '…' : value === undefined ? '—' : value.toLocaleString();
  return (
    <div className="sales-business-overview">
      <header className="desk-header">
        <div>
          <p className="desk-eyebrow">YOUR BUSINESS, CONNECTED</p>
          <h1>Sales Desk</h1>
          <p>Follow every customer relationship, sale and payment from one place.</p>
        </div>
      </header>
      <div className="sales-business-cards">
        {canSales && (
          <section className="sales-business-card">
            <Receipt size={24} />
            <h2>Sales</h2>
            <strong>{count(sales.data?.totalOrders, sales.loading)}</strong>
            <span>Sales orders across your permitted companies</span>
            <p>
              {count(sales.data?.draft, sales.loading)} drafts ·{' '}
              {count(sales.data?.confirmed, sales.loading)} confirmed
            </p>
            {sales.error && (
              <p role="alert">
                Sales summary unavailable. <button onClick={sales.reload}>Retry</button>
              </p>
            )}
            <Link href="/sales-desk?view=sales">
              Open sales <ArrowRight size={16} />
            </Link>
          </section>
        )}
        {canCustomers && (
          <section className="sales-business-card">
            <Users size={24} />
            <h2>Customers</h2>
            <strong>{count(customers.data?.total, customers.loading)}</strong>
            <span>Customer relationships in your organisation</span>
            <p>
              {count(customers.data?.active, customers.loading)} active ·{' '}
              {count(customers.data?.blocked, customers.loading)} blocked
            </p>
            {customers.error && (
              <p role="alert">
                Customer summary unavailable. <button onClick={customers.reload}>Retry</button>
              </p>
            )}
            <Link href="/sales-desk?view=customers">
              Open customers <ArrowRight size={16} />
            </Link>
          </section>
        )}
      </div>
      <p className="sales-business-note">
        Your existing Operations records are here, including new POS sales. Customer profiles retain
        their balances, statements and sales history.
      </p>
      {hasPermission('sales_desk.view') && (
        <div className="sales-business-direct-card">
          <div>
            <h2>Direct entries</h2>
            <p>
              Your earlier Sales Desk customers, simple sales and Cash Desk receipts remain in their
              separate register.
            </p>
          </div>
          <Link href="/sales-desk?source=direct&view=overview">
            Open direct entries <ArrowRight size={16} />
          </Link>
        </div>
      )}
    </div>
  );
}
