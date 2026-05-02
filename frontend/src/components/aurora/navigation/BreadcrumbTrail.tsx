'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { buildBreadcrumbs } from '@/lib/design-system/navigation';

interface BreadcrumbTrailProps {
  custom?: Array<{ label: string; href?: string }>;
}

export function BreadcrumbTrail({ custom }: BreadcrumbTrailProps) {
  const pathname = usePathname();
  const items = custom ?? buildBreadcrumbs(pathname);

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span style={{ color: 'var(--aurora-text-muted)' }}>/</span>}
          {item.href && index < items.length - 1 ? (
            <Link
              href={item.href}
              className="transition-colors hover:opacity-80"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              {item.label}
            </Link>
          ) : (
            <span
              className="font-medium"
              style={{ color: index === items.length - 1 ? 'var(--aurora-text-secondary)' : 'var(--aurora-text-muted)' }}
            >
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
