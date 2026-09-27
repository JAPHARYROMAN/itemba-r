import type { Metadata } from 'next';
import { contactPage } from '@/content/contactPage';
import { crumbs } from '@/content/nav';
import { webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { ContactCompanies } from '@/sections/contact/ContactCompanies';
import { ContactEnquire } from '@/sections/contact/ContactEnquire';
import { ContactFindUs } from '@/sections/contact/ContactFindUs';
import { ContactHelp } from '@/sections/contact/ContactHelp';
import { ContactHero } from '@/sections/contact/ContactHero';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = contactPage;
const path = '/contact';

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path,
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /contact, a server component, set as an Apple support page: the hero
 * (with WhatsApp and a call straight away), the full enquiry form high on
 * the page (every Enquire pill on the site lands here; general intent),
 * the group headquarters as contact cards with the map facade, the three
 * companies, and where to go for anything else. Every number, address and
 * href comes from src/content/contact.ts. The quick-contact bar steps aside
 * on this route (it has a form). The ContactPage carries the group's
 * contact point; the breadcrumb trail (and its BreadcrumbList) closes the
 * page.
 */
export default function ContactPage() {
  return (
    <>
      <StructuredData
        data={webPageJsonLd({ type: 'ContactPage', name: meta.ogTitle, path, fragment: 'contact', withContactPoint: true })}
      />
      <ContactHero />
      <ContactEnquire />
      <ContactFindUs />
      <ContactCompanies />
      <ContactHelp />
      <FooterTrail items={[crumbs.home, { name: meta.title, path }]} />
    </>
  );
}
