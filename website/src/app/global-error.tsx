'use client';

// Every stylesheet, in cascade order, imported alike here and in layout.tsx
// (tests/unit/shell.test.ts), so the two roots share one CSS chunk and every
// page makes a single render-blocking stylesheet request. The corridor and
// profile-contents styles are small and ride along.
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/utilities.css';
import '@/styles/print.css';
import '@/sections/corridor/corridor.css';
import '@/islands/profile-nav.css';
import { useEffect } from 'react';
import { contact, contactActionLabels, mailtoHref, telHref } from '@/content/contact';
import { errorPage as copy } from '@/content/errors';
import { siteLanguage } from '@/content/site';
import { inter } from '@/design/fonts';
import { Chevron as ChevronGlyph } from '@/ui/Chevron';

/* eslint-disable @next/next/no-html-link-for-pages -- plain anchors on purpose: after the root layout fails, a full page load is the surer way back, and next/link would join every page's first load (see below). */

type GlobalErrorProps = { error: Error & { digest?: string }; reset: () => void };

/*
 * Next ships global-error with the root of every page, so everything this
 * file imports counts against the shared first-load JS budget. It
 * therefore draws the kit's pill, chevron link and type scale from the
 * same tokens with plain elements (no next/link, next/image or design-token
 * modules; from the UI kit only the chevron glyph), and links with plain
 * anchors: after the root layout has failed, a full page load is the surer
 * way back.
 */
const pill =
  'inline-flex min-h-[52px] select-none items-center justify-center whitespace-nowrap rounded-pill bg-btn px-8 text-body-lg text-btn-fg transition-colors duration-fast ease-apple hover:bg-btn-hover';
const chevronLink = 'group inline-block text-accent-fg decoration-1 underline-offset-4 hover:underline';

function Chevron() {
  return <ChevronGlyph className="ml-[0.3em] inline-block align-middle" />;
}

/**
 * The last-resort boundary: it replaces the root layout when the layout
 * itself fails, so it brings its own <html> and <body>, the stylesheets and
 * the font, and no site chrome beyond the crest (the nav and footer read
 * server-only content). A calm light page, like the 404: the message, a
 * retry, a way home, and the direct channels to the group office (from
 * src/content/contact.ts, in the forms ConversionTracker classifies).
 *
 * "Try again" calls reset(), which re-renders the root. A client component,
 * as Next requires (the client allowlist names this file).
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const channels = [
    { href: telHref(contact.primaryPhone), label: copy.call, name: contactActionLabels.call, kind: 'tel' },
    { href: contact.whatsapp, label: copy.whatsapp, name: contactActionLabels.whatsapp, kind: 'whatsapp' },
    { href: mailtoHref(), label: copy.email, name: contactActionLabels.email, kind: 'mailto' },
  ] as const;

  return (
    <html lang={siteLanguage} className={inter.variable}>
      <head>
        <title>{copy.metaTitle}</title>
        <meta name="robots" content="noindex" />
      </head>
      <body className="bg-surface font-sans text-fg">
        <header className="border-b border-line">
          <div className="mx-auto box-content flex h-nav max-w-content items-center px-gutter">
            <a href="/" aria-label={copy.brandLabel} className="-my-2 inline-flex min-h-11 items-center">
              {/* A plain <img>: next/image would add its client code to every page's first load (see above). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-nav.png" alt="" width={85} height={30} className="block h-[1.875rem] w-auto opacity-90 brightness-0" />
            </a>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <section data-tone="light" aria-labelledby="global-error-title" className="pb-section pt-14 md:pt-24">
            <div className="mx-auto box-content max-w-prose px-gutter text-center">
              <p className="mb-3 text-eyebrow text-gold-fg">{copy.eyebrow}</p>
              <h1 id="global-error-title" className="text-display text-fg">
                {copy.heading}
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-pretty text-lede text-fg max-md:text-body-lg md:mt-6">{copy.body}</p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
                <button type="button" onClick={reset} className={pill}>
                  {copy.retry}
                </button>
                <a href={copy.home.href} className={`${chevronLink} text-body-lg`}>
                  {copy.home.label}
                  <Chevron />
                </a>
              </div>
              <div className="mx-auto mt-14 max-w-xl border-t border-line pt-8">
                <p className="text-body text-fg-muted">{copy.channels}</p>
                <ul role="list" className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                  {channels.map((channel) => (
                    <li key={channel.kind}>
                      <a href={channel.href} data-contact={channel.kind} aria-label={channel.name} className={`${chevronLink} text-body`}>
                        {channel.label}
                        <Chevron />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-6">
                  <a href={copy.contact.href} className={`${chevronLink} text-caption`}>
                    {copy.contact.label}
                    <Chevron />
                  </a>
                </p>
              </div>
              {error.digest ? (
                <p className="mt-8 text-caption text-fg-muted">
                  {copy.reference}: <code className="font-mono">{error.digest}</code>
                </p>
              ) : null}
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
