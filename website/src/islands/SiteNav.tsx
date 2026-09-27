'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { LinkItem } from '@/content/types';
import { buttonClasses } from '@/ui/actions';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';

/** id of the mobile menu sheet (the popover the menu button targets). */
export const SITE_MENU_ID = 'site-menu';

/** A nav link is current on its own path and on every path below it. */
function isCurrent(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

/** Closes the sheet if it is open. A no-op where popover is unsupported. */
function hideSheet(sheet: HTMLElement | null) {
  if (!sheet || typeof sheet.hidePopover !== 'function') return;
  try {
    if (sheet.matches(':popover-open')) sheet.hidePopover();
  } catch {
    // :popover-open is not a valid selector in this browser.
  }
}

export type SiteNavProps = {
  links: readonly LinkItem[];
  cta: LinkItem;
  /** Nav landmark name. */
  label: string;
  /** Accessible names of the menu button and the sheet's close button. */
  menuLabel: string;
  closeLabel: string;
  /** The crest link at the top of the sheet. */
  brandLabel: string;
  crest: ReactNode;
};

/**
 * The global nav's links, the Enquire pill and the mobile menu.
 *
 * - From `lg` the links sit in the 48px bar; `aria-current` follows the
 *   pathname, including client-side navigation.
 * - Below `lg` a menu button opens a full-screen sheet built on the native
 *   `popover` attribute with `popovertarget`, so it opens, closes on Escape
 *   and returns focus without any JavaScript. The only script here closes
 *   the sheet after a client-side navigation (the document stays, so the
 *   popover would otherwise stay open).
 * - Browsers without popover get the links as a scrolling row in the bar
 *   instead (src/styles/utilities.css, `@supports not selector(:popover-open)`).
 */
export default function SiteNav({ links, cta, label, menuLabel, closeLabel, brandLabel, crest }: SiteNavProps) {
  const pathname = usePathname() ?? '/';
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hideSheet(sheetRef.current);
  }, [pathname]);

  const current = (href: string) => (isCurrent(pathname, href) ? ('page' as const) : undefined);
  // A link to the page already open changes no pathname, so close explicitly.
  const closeSheet = () => hideSheet(sheetRef.current);

  return (
    <nav aria-label={label} className="flex min-w-0 flex-1 items-center">
      <ul className="site-nav-links mx-auto hidden items-center lg:flex">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={current(link.href)}
              className="flex h-nav items-center whitespace-nowrap px-2.5 text-legal text-fg/80 transition-colors duration-fast ease-apple hover:text-fg aria-[current=page]:text-fg aria-[current=page]:underline aria-[current=page]:decoration-fg/30 aria-[current=page]:underline-offset-4 xl:px-3.5"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-0">
        {/* site-nav-cta: steps aside on pages whose sub-nav carries its own Enquire pill (utilities.css). */}
        <Link href={cta.href} className={cn(buttonClasses({ size: 'sm' }), 'site-nav-cta')}>
          {cta.label}
        </Link>
        <button
          type="button"
          popoverTarget={SITE_MENU_ID}
          aria-label={menuLabel}
          className="site-menu-toggle -mr-2.5 inline-flex size-11 items-center justify-center rounded-pill text-fg transition-colors duration-fast hover:bg-fg/5 lg:hidden"
        >
          <Icon name="menu" size="sm" strokeWidth={1.6} />
        </button>
      </div>

      {/* The popover element itself must not set `display` (the UA hides it with display: none while closed). */}
      <div id={SITE_MENU_ID} ref={sheetRef} popover="auto" data-tone="light" className="site-menu">
        <div className="mx-auto box-content max-w-content px-gutter pb-12">
          <div className="flex h-nav items-center justify-between">
            <Link href="/" aria-label={brandLabel} onClick={closeSheet} className="-ml-1 flex h-11 items-center px-1">
              {crest}
            </Link>
            <button
              type="button"
              popoverTarget={SITE_MENU_ID}
              popoverTargetAction="hide"
              aria-label={closeLabel}
              className="-mr-2.5 inline-flex size-11 items-center justify-center rounded-pill text-fg transition-colors duration-fast hover:bg-fg/5"
            >
              <Icon name="close" size="sm" strokeWidth={1.6} />
            </button>
          </div>
          <ul className="pt-5">
            {links.map((link, index) => (
              <li key={link.href} className="site-menu-item" style={{ '--i': index } as CSSProperties}>
                <Link
                  href={link.href}
                  aria-current={current(link.href)}
                  onClick={closeSheet}
                  className="flex min-h-12 items-center py-1 text-h3 text-fg transition-colors duration-fast hover:text-fg-muted aria-[current=page]:text-accent-fg"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="site-menu-item mt-8 border-t border-line pt-8" style={{ '--i': links.length } as CSSProperties}>
            <Link href={cta.href} onClick={closeSheet} className={cn(buttonClasses({ size: 'md' }), 'w-full')}>
              {cta.label}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
