import type { DesktopWindow } from './desktop';

/** A view summary, never a capture of potentially private form contents. */
export function desktopWindowLabel(
  item: DesktopWindow,
  companies: { id: string; name: string }[] = [],
) {
  const values = item.viewState?.values ?? {};
  const params = new URL(item.href, 'http://desktop.local').searchParams;
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
