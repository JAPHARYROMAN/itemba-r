import { breadcrumbJsonLd, type BreadcrumbItem } from '@/lib/jsonld';
import { Chevron, SmartLink } from './actions';
import { cn } from './cn';
import { StructuredData } from './StructuredData';

export type { BreadcrumbItem } from '@/lib/jsonld';

export type BreadcrumbsProps = {
  /** Home first, the current page last. Names are shown as given. */
  items: readonly BreadcrumbItem[];
  /**
   * Also emit the BreadcrumbList JSON-LD (default). A page has one
   * BreadcrumbList, so turn this off for a second, visual-only trail.
   */
  withJsonLd?: boolean;
  /** `caption` (14px) above content; `legal` (12px) in the footer. */
  size?: 'caption' | 'legal';
  className?: string;
};

/**
 * The visible trail and its BreadcrumbList, from the same items, so the two
 * cannot drift. The current page is plain text with aria-current; the
 * separators are decorative.
 */
export function Breadcrumbs({ items, withJsonLd = true, size = 'caption', className }: BreadcrumbsProps) {
  if (items.length < 2) return null;
  const last = items.length - 1;
  return (
    <>
      <nav aria-label="Breadcrumb" className={className}>
        <ol className={cn('flex flex-wrap items-center gap-x-1.5', size === 'caption' ? 'text-caption' : 'text-legal')}>
          {items.map((item, index) =>
            index === last ? (
              <li key={item.path} className="flex min-h-11 items-center md:min-h-8">
                <span aria-current="page" className="text-fg">
                  {item.name}
                </span>
              </li>
            ) : (
              <li key={item.path} className="flex items-center gap-1.5">
                <SmartLink
                  href={item.path}
                  className="inline-flex min-h-11 items-center text-fg-muted decoration-1 underline-offset-4 hover:text-fg hover:underline md:min-h-8"
                >
                  {item.name}
                </SmartLink>
                <Chevron className="text-fg-muted" />
              </li>
            ),
          )}
        </ol>
      </nav>
      {withJsonLd ? <StructuredData data={breadcrumbJsonLd(items)} /> : null}
    </>
  );
}
