'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { href: '/operations/purchase-orders', label: 'Actual Purchase Orders' },
  { href: '/operations/purchase-orders/order-drafts', label: 'Supplier Order Drafts' },
];

export function PurchaseOrderTabs() {
  const pathname = usePathname();
  return (
    <nav
      className="flex flex-wrap gap-1 border-b"
      style={{ borderColor: 'var(--aurora-border)' }}
      aria-label="Purchase order workspaces"
    >
      {tabs.map((tab) => {
        const active = tab.href.endsWith('order-drafts')
          ? pathname.startsWith(tab.href)
          : !pathname.includes('/order-drafts');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${active ? 'border-brand-600 text-brand-600' : 'border-transparent'}`}
            style={active ? undefined : { color: 'var(--aurora-text-muted)' }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
