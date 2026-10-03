'use client';

import { useRef } from 'react';
import type { LinkItem } from '@/content/types';
import { Icon } from '@/ui/Icon';

/** id of the sub-nav's section menu (one sub-nav per page). */
export const SUBNAV_MENU_ID = 'subnav-sections';

/** Closes the menu if it is open. A no-op where popover is unsupported. */
function hideMenu(menu: HTMLElement | null) {
  if (!menu || typeof menu.hidePopover !== 'function') return;
  try {
    if (menu.matches(':popover-open')) menu.hidePopover();
  } catch {
    // :popover-open is not a valid selector in this browser.
  }
}

export type SubNavMenuProps = {
  /** The page's section anchors ("#what-we-do"), as the sub-nav lists them from `md`. */
  links: readonly LinkItem[];
  /** Accessible name of the chevron button ("Show Mwanjalisi Oil sections"). */
  label: string;
};

/**
 * The sub-nav's section anchors on phones, as Apple's local nav does it: a
 * chevron beside the page name opens a panel under the bar listing them.
 *
 * Built on the native `popover` attribute with `popovertarget`, so it opens,
 * closes on Escape or a tap outside, and returns focus with no JavaScript.
 * The only script closes the panel once a section is chosen (an in-page
 * link would otherwise leave it open over the section). Hidden from `md`,
 * where the anchors sit in the bar itself (src/styles/utilities.css).
 */
export default function SubNavMenu({ links, label }: SubNavMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => hideMenu(menuRef.current);

  return (
    <>
      <button
        type="button"
        popoverTarget={SUBNAV_MENU_ID}
        aria-label={label}
        className="subnav-menu-toggle relative -ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-pill text-fg/80 transition-colors duration-fast ease-apple after:absolute after:-inset-1.5 after:content-[''] hover:bg-fg/5 hover:text-fg md:hidden"
      >
        <Icon name="chevron-down" size="xs" strokeWidth={2} className="subnav-menu-chevron transition-transform duration-base ease-apple" />
      </button>
      {/* The popover element itself must not set `display` (the UA hides it with display: none while closed). */}
      <div id={SUBNAV_MENU_ID} ref={menuRef} popover="auto" data-tone="light" className="subnav-menu">
        <ul className="mx-auto box-content max-w-content px-gutter py-2">
          {links.map((link) => (
            <li key={link.href} className="border-b border-line last:border-b-0">
              <a href={link.href} onClick={close} className="flex min-h-12 items-center text-body text-fg transition-colors duration-fast hover:text-fg-muted">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
