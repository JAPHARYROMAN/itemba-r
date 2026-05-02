// ITEMBA-R Aurora Design System — Navigation Types

export interface NavItem {
  label: string;
  href: string;
  icon?: string; // icon key
  badge?: string | number;
  permission?: string;
  exact?: boolean;
}

export interface NavSection {
  title: string;
  permission?: string;
  items: NavItem[];
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbItem[] = [{ label: 'Home', href: '/dashboard' }];
  let path = '';
  for (const seg of segments) {
    path += '/' + seg;
    const label = seg
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    crumbs.push({ label, href: path });
  }
  return crumbs;
}
