import React from 'react';
import { WorkspaceLink as Link } from '@/components/workspace/workspace-navigation';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  /** Subtitle text. Also accepts legacy "description" prop. */
  subtitle?: string;
  description?: string; // legacy alias for subtitle
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  action?: React.ReactNode; // legacy alias for actions
}

export function PageHeader({
  title,
  subtitle,
  description,
  breadcrumbs,
  actions,
  action,
}: PageHeaderProps) {
  const sub = subtitle ?? description;
  const act = actions ?? action;
  return (
    <div data-page-header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            className="flex flex-wrap items-center gap-1 mb-1 text-[12px]"
            style={{ color: 'var(--aurora-text-muted)' }}
          >
            {breadcrumbs.map((bc, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span>/</span>}
                {bc.href ? (
                  <Link
                    href={bc.href}
                    className="hover:underline transition-colors"
                    style={{ color: 'var(--aurora-text-secondary)' }}
                  >
                    {bc.label}
                  </Link>
                ) : (
                  <span
                    aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {bc.label}
                  </span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1
          className="text-[22px] font-semibold leading-tight"
          style={{ color: 'var(--aurora-text)' }}
        >
          {title}
        </h1>
        {sub && (
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--aurora-text-secondary)' }}>
            {sub}
          </p>
        )}
      </div>
      {act && (
        <div data-page-actions className="flex flex-wrap items-center gap-2 max-w-full">
          {act}
        </div>
      )}
    </div>
  );
}
