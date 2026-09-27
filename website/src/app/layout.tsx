import type { Metadata, Viewport } from 'next';
// Every stylesheet, in cascade order, imported alike here and in global-error.tsx
// (tests/unit/shell.test.ts), so the two roots share one CSS chunk and every
// page makes a single render-blocking stylesheet request. The corridor and
// profile-contents styles are small and ride along.
import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/utilities.css';
import '@/styles/print.css';
import '@/sections/corridor/corridor.css';
import '@/islands/profile-nav.css';
import { shellCopy } from '@/content/nav';
import { site } from '@/content/site';
import { inter } from '@/design/fonts';
import { surfaces } from '@/design/tokens';
import Analytics from '@/components/Analytics';
import ConversionTracker from '@/components/ConversionTracker';
import { organizationJsonLd, websiteJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { QuickContactBar } from '@/shell/QuickContactBar';
import { SiteFooter } from '@/shell/SiteFooter';
import { SiteHeader } from '@/shell/SiteHeader';
import { SkipLink } from '@/ui/a11y';
import { StructuredData } from '@/ui/StructuredData';

/**
 * Site-wide defaults, built by seo.ts. Every page, home included
 * (src/app/page.tsx), sets its own canonical and a complete openGraph (a
 * page's openGraph replaces the layout's; it does not merge), so these only
 * reach a route that sets none.
 */
const home = pageMetadata({
  title: { absolute: site.title },
  description: site.description,
  path: '/',
  ogDescription: site.shortDescription,
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  applicationName: site.name,
  title: {
    default: site.title,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords: site.keywords,
  alternates: home.alternates,
  robots: {
    index: true,
    follow: true,
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-48x48.png', type: 'image/png', sizes: '48x48' },
      { url: '/favicon-64x64.png', type: 'image/png', sizes: '64x64' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
  // No `images`: the root opengraph-image.tsx supplies the card.
  openGraph: home.openGraph,
  // The card type only. Next fills twitter:title, description and image from
  // each page's own openGraph, so layout copy never leaks onto every page
  // (architecture §6).
  twitter: { card: 'summary_large_image' },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? {
        google: process.env.GOOGLE_SITE_VERIFICATION,
      }
    : undefined,
};

/** The browser chrome matches the canvas, so nothing flashes another colour. */
export const viewport: Viewport = {
  themeColor: surfaces.canvas,
  colorScheme: 'light',
};

/**
 * The shell: skip link, global nav, <main> with no wrapper (the print rules
 * and the PDF script see the page content directly), footer, and the mobile
 * quick-contact bar. html and body take their colours from the tokens
 * (src/styles/base.css), so the first paint is already the canvas.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={site.language} className={inter.variable}>
      <body className="overflow-x-hidden bg-surface font-sans text-fg">
        <SkipLink>{shellCopy.skipLink}</SkipLink>
        <Analytics />
        <ConversionTracker />
        {/* The group, declared once per page; every other entity refers to it by @id (src/lib/jsonld.ts). */}
        <StructuredData data={[organizationJsonLd(), websiteJsonLd()]} />
        <SiteHeader />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <QuickContactBar />
      </body>
    </html>
  );
}
