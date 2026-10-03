'use client';

import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { cn } from '@/ui/cn';
import { Icon } from '@/ui/Icon';
// Its styles, ./profile-nav.css, load with the root stylesheet (src/app/layout.tsx).

export type ProfileNavItem = { id: string; title: string };

export type ProfileNavLabels = {
  /** The trigger's text ("Contents"); on wide screens it prefixes the current section for screen readers. */
  trigger: string;
  /** The sheet's heading ("In this profile"). */
  title: string;
  /** The sheet's close button. */
  close: string;
};

export type ProfileNavProps = {
  /** The page's sections in document order; each id is an element id on the page. */
  outline: readonly ProfileNavItem[];
  /** From src/content/profile (profileNavCopy); islands cannot read that server-only module. */
  labels: ProfileNavLabels;
  className?: string;
};

/**
 * Attributes for the native invoker commands (`commandfor` + `command`):
 * where the browser supports them, the sheet opens and closes even before
 * this island hydrates or without JavaScript. React passes unknown
 * lowercase attributes through as they are.
 */
const invoke = (target: string, command: 'show-modal' | 'close') => ({ commandfor: target, command }) as Record<string, string>;

/** Section in view: the band 30% down the viewport, just under the two sticky bars. */
const SPY_MARGIN = '-30% 0px -69% 0px';

/**
 * The company profile's contents, as the right-hand control of its SubNav:
 *
 *   <SubNav title="Company profile" label="Company profile sections" cta={…}>
 *     <ProfileNav outline={outline} labels={profileNavCopy} />
 *   </SubNav>
 *
 * - The trigger reads "Contents" on phones and the current section's title
 *   from `md`; an IntersectionObserver scrollspy keeps it current.
 * - It opens a native <dialog> with showModal(): a bottom sheet on phones
 *   and a panel under the sub-nav on wider screens, listing all sections
 *   with the current one marked (aria-current). The browser supplies the
 *   focus trap, Escape and focus return; clicking the backdrop closes it.
 * - Choosing a section closes the sheet, scrolls to the section (smoothly
 *   unless reduced motion is set, via the page's scroll-behavior) and moves
 *   focus there, so keyboard and screen-reader users land where they chose.
 * - Print: the sub-nav is hidden and a closed dialog renders nothing.
 */
export default function ProfileNav({ outline, labels, className }: ProfileNavProps) {
  const [activeId, setActiveId] = useState(outline[0]?.id ?? '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const dialogId = `${uid}-contents`;
  const titleId = `${uid}-title`;

  // Scrollspy: the first section (in document order) crossing the band.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sections = outline
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!sections.length) return;

    const crossing = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) crossing.set(entry.target.id, entry.isIntersecting);
        const current = outline.find((item) => crossing.get(item.id));
        if (current) setActiveId(current.id);
      },
      { rootMargin: SPY_MARGIN, threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [outline]);

  // Light dismiss: a click on the backdrop lands on the <dialog> element itself.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClick = (event: globalThis.MouseEvent) => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener('click', onClick);
    return () => dialog.removeEventListener('click', onClick);
  }, []);

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // Start on the current section rather than the first link.
    const current = dialog.querySelector<HTMLAnchorElement>('a[aria-current="true"]');
    current?.focus();
    current?.scrollIntoView({ block: 'nearest' });
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  const go = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    // New tab, new window or download: leave it to the browser.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    close();
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
    target.scrollIntoView({ block: 'start' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    setActiveId(id);
  };

  const activeIndex = Math.max(
    0,
    outline.findIndex((item) => item.id === activeId),
  );
  const active = outline[activeIndex];

  return (
    <>
      <button
        type="button"
        {...invoke(dialogId, 'show-modal')}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        onClick={open}
        className={cn(
          "relative inline-flex min-h-8 max-w-72 items-center gap-1.5 rounded-pill px-3 text-caption text-fg transition-colors duration-fast ease-apple after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:bg-fg/5",
          className,
        )}
      >
        <span className="md:hidden">{labels.trigger}</span>
        {active ? (
          <span className="hidden min-w-0 items-center gap-2 md:inline-flex">
            <span className="sr-only">{labels.trigger}: </span>
            <span aria-hidden="true" className="tabular-nums text-fg-muted">
              {activeIndex + 1}
            </span>
            <span className="truncate">{active.title}</span>
          </span>
        ) : null}
        <Icon name="chevron-down" size="xs" strokeWidth={2} className="text-fg-muted" />
      </button>

      <dialog
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={titleId}
        closedby="any"
        className="profile-contents"
      >
        <div data-tone="light" className="profile-contents__panel">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3 md:px-8">
            <h2 id={titleId} className="text-body-lg font-semibold text-fg">
              {labels.title}
            </h2>
            <button
              type="button"
              {...invoke(dialogId, 'close')}
              onClick={close}
              aria-label={labels.close}
              className="-mr-2.5 inline-flex size-11 items-center justify-center rounded-pill text-fg transition-colors duration-fast hover:bg-fg/5"
            >
              <Icon name="close" size="sm" strokeWidth={1.6} />
            </button>
          </div>
          <ol role="list" className="profile-contents__list px-3 py-3 md:px-5 md:py-5">
            {outline.map((item, index) => {
              const current = item.id === activeId;
              return (
                <li key={item.id} className="break-inside-avoid">
                  <a
                    href={`#${item.id}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={(event) => go(event, item.id)}
                    className="flex min-h-11 items-baseline gap-3 rounded-input px-3 py-2.5 text-body text-fg transition-colors duration-fast ease-apple hover:bg-surface-alt aria-[current=true]:bg-surface-alt aria-[current=true]:font-semibold"
                  >
                    <span aria-hidden="true" className="w-6 shrink-0 text-right text-caption tabular-nums text-fg-muted">
                      {index + 1}
                    </span>
                    <span>{item.title}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
      </dialog>
    </>
  );
}
