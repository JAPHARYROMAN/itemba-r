'use client';
import dynamic from 'next/dynamic';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  Receipt,
  ShoppingBag,
  StickyNote,
  Tags,
  Trash2,
  Wallet,
} from 'lucide-react';
import { AppGlyph } from '@/components/os/app-glyph';
import { FormSelect, PageSpinner, PermissionDeniedState } from '@/components/ui';
import {
  WorkspaceLink as Link,
  useWorkspacePathname,
  useWorkspaceRouter,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';
import { useAuth } from '@/hooks/use-auth';
import { getApp } from '@/lib/apps';
import { RecordsHostContext } from './records-context';
import { RECORDS_PERMISSIONS, recordsRoute } from './records-routes';
import { RecordsOverview } from './records-overview';
import './records.css';
import './records-workspace.css';

const loading = () => <PageSpinner label="Opening Records" />;
const Notebook = dynamic(() => import('./records-notebook').then((m) => m.RecordsNotebook), {
  loading,
});
const Daily = dynamic(
  () => import('@/app/(dashboard)/record-book/record-book-client').then((m) => m.RecordBookClient),
  { loading },
);
const Detail = dynamic(
  () =>
    import('@/app/(dashboard)/record-book/record-book-detail-client').then(
      (m) => m.RecordBookDetailClient,
    ),
  { loading },
);
const Reports = dynamic(
  () =>
    import('@/app/(dashboard)/record-book/record-book-reports-client').then(
      (m) => m.RecordBookReportsClient,
    ),
  { loading },
);
const Trash = dynamic(
  () =>
    import('@/app/(dashboard)/record-book/record-book-trash-client').then(
      (m) => m.RecordBookTrashClient,
    ),
  { loading },
);
const app = getApp('records')!;

export function RecordsApp() {
  const { hasPermission, loading: authLoading } = useAuth();
  const path = useWorkspacePathname(),
    params = useWorkspaceSearchParams(),
    router = useWorkspaceRouter();
  const route = recordsRoute(path, params);
  if (authLoading) return loading();
  if (!RECORDS_PERMISSIONS.some((permission) => hasPermission(permission)))
    return (
      <PermissionDeniedState description="Ask your administrator for Records or Records Book access." />
    );
  const canBook = hasPermission('record_book.view'),
    canNotebook = hasPermission('records.view');
  const items = [
    {
      id: 'overview',
      label: 'Overview',
      href: '/records',
      icon: LayoutDashboard,
      visible: true,
      group: '',
    },
    ...[
      { id: 'daily-summary', label: 'Daily overview', icon: BarChart3 },
      { id: 'daily-sales', label: 'Daily sales', icon: Receipt },
      { id: 'money-out', label: 'Money out', icon: Wallet },
      { id: 'categories', label: 'Categories', icon: Tags },
      { id: 'reports', label: 'Reports', icon: ClipboardList },
      { id: 'trash', label: 'Trash', icon: Trash2 },
    ].map((item) => ({
      ...item,
      href: `/records/${item.id}`,
      visible: canBook,
      group: 'Daily records',
    })),
    ...[
      {
        id: 'notebook',
        label: 'Notebook overview',
        href: '/records/notebook?view=overview',
        icon: BookOpen,
      },
      { id: 'debtors', label: 'Debtors', icon: ArrowDownLeft },
      { id: 'creditors', label: 'Creditors', icon: ArrowUpRight },
      { id: 'sales', label: 'Individual sales', icon: Receipt },
      { id: 'purchases', label: 'Purchases', icon: ShoppingBag },
      { id: 'expenses', label: 'Expense notes', icon: Wallet },
      { id: 'notes', label: 'Notes', icon: StickyNote },
    ].map((item) => ({
      ...item,
      href: item.href ?? `/records?view=${item.id}`,
      visible: canNotebook,
      group: 'Notebook',
    })),
  ].filter((item) => item.visible);
  const active =
    route.kind === 'sale'
      ? 'daily-sales'
      : route.kind === 'expense'
        ? 'money-out'
        : route.kind === 'notebook'
          ? params.get('view') === 'overview'
            ? 'notebook'
            : (params.get('view') ?? 'notebook')
          : route.kind;
  const selected = items.find((item) => item.id === active);
  const restricted =
    (route.kind === 'notebook' && !canNotebook) ||
    (!['overview', 'notebook', 'unavailable'].includes(route.kind) && !canBook);
  return (
    <RecordsHostContext.Provider value>
      <div className="records-app records-unified">
        <aside className="records-rail">
          <Link href="/records" className="records-identity" aria-label="Records home">
            <AppGlyph app={app} size="small" />
            <div>
              <strong>Records</strong>
              <span>Everything worth keeping</span>
            </div>
          </Link>
          <nav aria-label="Records navigation">
            {items.map((item, index) => (
              <div key={item.id}>
                {item.group && items[index - 1]?.group !== item.group && (
                  <p className="records-nav-group">{item.group}</p>
                )}
                <Link href={item.href} aria-current={item.id === active ? 'page' : undefined}>
                  <item.icon size={17} />
                  {item.label}
                </Link>
              </div>
            ))}
          </nav>
          <FormSelect
            className="records-register-switcher"
            label="Records section"
            value={selected?.href ?? '/records'}
            onChange={(e) => router.push(e.target.value)}
            options={items.map((item) => ({ value: item.href, label: item.label }))}
          />
        </aside>
        <div className="records-unified-content">
          {restricted ? (
            <PermissionDeniedState description="Your current role does not have access to this Records section." />
          ) : route.kind === 'overview' ? (
            <RecordsOverview canBook={canBook} canNotebook={canNotebook} />
          ) : route.kind === 'notebook' ? (
            <Notebook embedded />
          ) : route.kind === 'sale' || route.kind === 'expense' ? (
            <Detail
              key={`${route.kind}:${route.id}`}
              kind={route.kind === 'sale' ? 'daily-sales' : 'expenses'}
              recordId={route.id}
            />
          ) : route.kind === 'reports' ? (
            <Reports initialReportKey={route.report} />
          ) : route.kind === 'trash' ? (
            <Trash />
          ) : route.kind === 'unavailable' ? (
            <div className="records-empty">
              <h1>Record page unavailable</h1>
              <Link href="/records">Return to Records</Link>
            </div>
          ) : (
            <Daily
              key={route.kind}
              initialTab={
                route.kind === 'daily-summary'
                  ? 'dashboard'
                  : route.kind === 'money-out'
                    ? 'expenses'
                    : route.kind
              }
            />
          )}
        </div>
      </div>
    </RecordsHostContext.Provider>
  );
}
