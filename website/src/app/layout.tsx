import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import './globals.css';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import ScrollProgress from '@/components/ScrollProgress';
import PageTransition from '@/components/PageTransition';
import JsonLd from '@/components/JsonLd';
import QuickContact from '@/components/QuickContact';
import Analytics from '@/components/Analytics';
import ConversionTracker from '@/components/ConversionTracker';
import { absoluteUrl, companyProfiles, contact, site } from '@/lib/site';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  weight: ['600', '700', '800', '900'],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  applicationName: site.name,
  title: {
    default: site.title,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords:
    'Itemba Group, Tanzania, Songwe, Tunduma, energy, fuel distribution, logistics, cross-border transit, trade distribution, construction supplies, hospitality, real estate, Mwanjalisi Oil, Westsides, Itemba Enterprises',
  alternates: {
    canonical: '/',
  },
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
  openGraph: {
    title: site.title,
    description: site.shortDescription,
    url: site.url,
    siteName: site.name,
    locale: site.locale,
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: site.title,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: site.title,
    description: site.shortDescription,
    images: ['/opengraph-image'],
  },
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? {
        google: process.env.GOOGLE_SITE_VERIFICATION,
      }
    : undefined,
};

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${site.url}/#organization`,
  name: site.name,
  url: site.url,
  logo: absoluteUrl('/logo.png'),
  email: contact.email,
  telephone: [contact.primaryPhoneDisplay, contact.secondaryPhoneDisplay],
  address: {
    '@type': 'PostalAddress',
    streetAddress: contact.headOffice,
    addressLocality: 'Tunduma',
    addressRegion: 'Songwe',
    addressCountry: 'TZ',
    postOfficeBoxNumber: contact.postal,
  },
  contactPoint: [
    {
      '@type': 'ContactPoint',
      telephone: contact.primaryPhoneDisplay,
      contactType: 'business enquiries',
      areaServed: ['TZ', 'ZM'],
      availableLanguage: ['English', 'Swahili'],
    },
  ],
  subOrganization: companyProfiles.map((company) => ({
    '@type': 'Organization',
    name: company.name,
    url: absoluteUrl(`/companies/${company.slug}`),
  })),
};

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${site.url}/#website`,
  name: site.name,
  url: site.url,
  inLanguage: 'en',
  publisher: {
    '@id': `${site.url}/#organization`,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body className="font-sans antialiased bg-white text-slate-900 overflow-x-hidden">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <Analytics />
        <ConversionTracker />
        <JsonLd data={[organizationJsonLd, websiteJsonLd]} />
        <ScrollProgress />
        <Navbar />
        <main id="main-content" tabIndex={-1}>
          <PageTransition>{children}</PageTransition>
        </main>
        <Footer />
        <QuickContact />
      </body>
    </html>
  );
}
