/**
 * Which internal routes next/link may prefetch as a link scrolls into view.
 * On its own, with no imports, so the global nav island can use it without
 * pulling the UI kit into every page's first-load script.
 *
 * /company-profile is never prefetched: its payload carries the four hidden
 * print documents (about 36 kB), too much to spend on a phone's metered data
 * for a link that may never be followed. The link still navigates
 * client-side on click.
 */
export function prefetchByDefault(href: string): boolean {
  return !/^\/company-profile(?:[?#]|$)/.test(href);
}

/** next/link's `prefetch` prop for an internal href: false for the routes above, otherwise its default. */
export function linkPrefetch(href: string): false | undefined {
  return prefetchByDefault(href) ? undefined : false;
}
