'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, type ReactNode } from 'react';
import { errorPage as copy } from '@/content/errors';
import { buttonClasses } from '@/ui/button';
import { Chevron } from '@/ui/Chevron';
import { cn } from '@/ui/cn';

type ErrorProps = { error: Error & { digest?: string }; reset: () => void };

/**
 * A chevron link as @/ui/actions draws it (the tone's text-safe accent,
 * the last word kept on one line with the chevron), for a plain-text label.
 */
function ChevronTextLink({ href, className, children }: { href: string; className: string; children: string }) {
  const cut = children.lastIndexOf(' ') + 1;
  return (
    <Link href={href} className={cn('group inline-block text-accent-fg decoration-1 underline-offset-4 hover:underline', className)}>
      {children.slice(0, cut)}
      <span className="whitespace-nowrap">
        {children.slice(cut)}
        <Chevron className="ml-[0.3em] inline-block align-middle" />
      </span>
    </Link>
  );
}

function Pill({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={buttonClasses({ size: 'lg' })}>
      <span>{children}</span>
    </button>
  );
}

/**
 * The error boundary for every route below the root layout: the same calm
 * light page as the 404, inside the site's own nav and footer. "Try again"
 * refreshes the server components and re-renders the segment (a bare
 * reset() would re-render the same failed server payload). The digest, when
 * Next provides one, is the reference the group office can quote to
 * whoever runs the site; the error itself is never shown.
 *
 * Next loads this boundary with the root layout on every page, so it keeps
 * its imports to the pill's classes (@/ui/button), the chevron glyph and
 * next/link, which every page already ships, and sets the kit's section,
 * eyebrow, display and lede styles on plain elements rather than pulling
 * in @/ui/actions (and with it the icon set), @/ui/text and @/ui/layout.
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
          <Pill onClick={retry}>{copy.retry}</Pill>
          <ChevronTextLink href={copy.home.href} className="text-body-lg">
            {copy.home.label}
          </ChevronTextLink>
        </div>
        <p className="mt-10">
          <ChevronTextLink href={copy.contact.href} className="text-caption">
            {copy.contact.label}
          </ChevronTextLink>
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
