import type { ReactNode } from 'react';
import type { AccentName } from '@/design/tokens';
import type { LinkItem } from '@/content/types';
import { ButtonLink, SmartLink } from './actions';
import { Container } from './layout';

export type SubNavProps = {
  /** The page name, shown on the left. */
  title: string;
  /** Where the title links (the page top by default). */
  titleHref?: string;
  /** The nav landmark's name, e.g. "Mwanjalisi Oil sections". */
  label: string;
  /** In-page anchors ("#services"); shown from `md`. */
  links?: readonly LinkItem[];
  /** The Enquire pill on the right. */
  cta?: LinkItem;
  /** Company accent: colours the title dot and the chevron links under it. */
  accent?: AccentName;
  /** Slot before the pill, for an island (the profile contents sheet). */
  children?: ReactNode;
};

/**
 * The local sub-nav of company, service and profile pages, as on Apple
 * product pages: page name left, section anchors, Enquire pill right. It
 * sticks under the global nav (`--sticky-top`, the nav height by default;
 * a shell with a non-sticky global nav sets it to 0). While it is on the
 * page, anchored sections clear both bars (utilities.css).
 *
 * Server markup; it needs no JS. The anchors hide below `md`, where the
 * title and the pill remain (pass an island as `children` for a mobile
 * contents menu).
 */
export function SubNav({ title, titleHref = '#main-content', label, links = [], cta, accent, children }: SubNavProps) {
  return (
    <nav
      aria-label={label}
      data-subnav=""
      data-tone="light"
      data-accent={accent}
      className="sticky top-[var(--sticky-top,var(--nav-height))] z-subnav border-b border-line"
    >
      <Container size="content" className="flex h-subnav items-center gap-4 md:gap-8">
        <SmartLink href={titleHref} className="flex min-w-0 items-center gap-2 text-body-lg font-semibold text-fg md:text-lede md:font-semibold">
          {accent ? <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-accent" /> : null}
          <span className="truncate">{title}</span>
        </SmartLink>
        {links.length ? (
          <ul className="ml-auto hidden items-center gap-6 md:flex">
            {links.map((link) => (
              <li key={link.href}>
                <SmartLink
                  href={link.href}
                  className="inline-flex min-h-8 items-center text-caption text-fg-muted transition-colors duration-fast hover:text-fg"
                >
                  {link.label}
                </SmartLink>
              </li>
            ))}
          </ul>
        ) : null}
        <div className={links.length ? 'ml-auto flex shrink-0 items-center gap-3 md:ml-0' : 'ml-auto flex shrink-0 items-center gap-3'}>
          {children}
          {cta ? (
            <ButtonLink href={cta.href} size="sm">
              {cta.label}
            </ButtonLink>
          ) : null}
        </div>
      </Container>
    </nav>
  );
}
