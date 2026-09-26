import type { DesktopWindow } from './desktop';
import { recordsRoute } from '@/features/records/records-routes';

/** A view summary, never a capture of potentially private form contents. */
export function desktopWindowLabel(
  item: DesktopWindow,
  companies: { id: string; name: string }[] = [],
) {
  const values = item.viewState?.values ?? {};
  const url = new URL(item.href, 'http://desktop.local');
  const params = url.searchParams;
  if (item.appId === 'records') {
    const route = recordsRoute(url.pathname, params);
    const labels = {
      overview: 'Overview',
      notebook: 'Notebook overview',
      'daily-summary': 'Daily overview',
      'daily-sales': 'Daily sales',
      'money-out': 'Money out',
      categories: 'Categories',
      reports: 'Reports',
      trash: 'Trash',
      sale: 'Daily sale detail',
      expense: 'Money-out detail',
      unavailable: 'Records',
    };
    const view = route.kind === 'notebook' ? params.get('view') : null;
    const label = view && view !== 'overview' ? view.replaceAll('-', ' ') : labels[route.kind];
    const filters = values[
      route.kind === 'reports' ? 'records.book-report.filters' : 'records.book.filters'
    ] as { search?: string } | undefined;
    const search =
      route.kind === 'notebook'
        ? values['records.search']
        : ['daily-summary', 'daily-sales', 'money-out', 'categories', 'reports'].includes(
              route.kind,
            )
          ? filters?.search
          : undefined;
    return [label, typeof search === 'string' && search ? `“${search}”` : '']
      .filter(Boolean)
      .join(' · ');
  }
  const section =
    values[`${item.appId}.section`] ??
    values['documents.view'] ??
    params.get('view') ??
    params.get('tab') ??
    item.href.split(/[?#]/)[0].split('/').slice(2).join(' / ') ??
    '';
  const scope = values[`${item.appId}.scope`] as { companyId?: string } | undefined;
  const companyId = scope?.companyId ?? values['documents.company'] ?? params.get('companyId');
  const company = companyId
    ? (companies.find((row) => row.id === companyId)?.name ?? 'Company selected')
    : '';
  const status = values[`${item.appId}.status`];
  const search = values[`${item.appId}.search`] ?? params.get('q');
  return [
    typeof section === 'string' && section ? section.replaceAll('-', ' ') : 'Overview',
    company,
    typeof status === 'string' && status !== 'all' ? status : '',
    typeof search === 'string' && search ? `“${search}”` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
