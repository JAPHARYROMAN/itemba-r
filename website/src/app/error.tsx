'use client';

import { useRouter } from 'next/navigation';
import { startTransition, useEffect } from 'react';
import { footerDirectory } from '@/content/nav';
import { Button, ChevronLink } from '@/ui/actions';

/**
 * Copy for the error boundaries, to move into src/content/errors.ts
 * (`errorPage`) with the 404 copy; kept here until the integrator makes
 * that shared change. global-error.tsx carries the same wording.
 */
const copy = {
  eyebrow: 'Error',
  heading: 'Something went wrong',
  body: 'This page could not be loaded just now. Try again, or go back to the home page.',
  retry: 'Try again',
  home: { label: 'Back to home', href: '/' },
  reference: 'Reference',
} as const;

type ErrorProps = { error: Error & { digest?: string }; reset: () => void };

/**
 * The error boundary for every route below the root layout: the same calm
 * light page as the 404, inside the site's own nav and footer. "Try again"
 * refreshes the server components and re-renders the segment (a bare
 * reset() would re-render the same failed server payload). The digest, when
 * Next provides one, is the reference the group office can quote to
 * whoever runs the site; the error itself is never shown.
 *
 * Next loads this boundary with the root layout on every page, so it keeps
 * its imports to the pill and chevron link the layout's islands already
 * ship (@/ui/actions), and sets the kit's section, eyebrow, display and
 * lede styles on plain elements rather than pulling in @/ui/text and
 * @/ui/layout.
 *
 * Not indexable: React hoists the robots <meta> into <head>. The page's
 * own <title> stays (a second hoisted <title> would compete with it).
 * A client component, as Next requires for error.tsx (the client
 * allowlist names this file).
 */
export default function RouteError({ error, reset }: ErrorProps) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <section data-tone="light" aria-labelledby="error-title" className="pb-section pt-14 md:pt-24">
      <meta name="robots" content="noindex" />
      <div className="mx-auto box-content max-w-prose px-gutter text-center">
        <p className="mb-3 text-eyebrow text-gold-fg">{copy.eyebrow}</p>
        <h1 id="error-title" className="text-display text-fg">
          {copy.heading}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-pretty text-lede text-fg max-md:text-body-lg md:mt-6">{copy.body}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          <Button size="lg" onClick={retry}>
            {copy.retry}
          </Button>
          <ChevronLink href={copy.home.href} size="body-lg">
            {copy.home.label}
          </ChevronLink>
        </div>
        <p className="mt-10">
          <ChevronLink href={footerDirectory.contact.page.href} size="caption">
            {footerDirectory.contact.page.label}
          </ChevronLink>
        </p>
        {error.digest ? (
          <p className="mt-4 text-caption text-fg-muted">
            {copy.reference}: <code className="font-mono">{error.digest}</code>
          </p>
        ) : null}
      </div>
    </section>
  );
}
