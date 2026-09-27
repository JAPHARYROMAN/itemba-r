import type { Metadata } from 'next';
import { enquiryPrompts } from '@/content/enquiry';
import { faqPage, faqSections } from '@/content/faqs';
import { crumbs } from '@/content/nav';
import { faqPageJsonLd, webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { FaqFamily, FaqHero, FaqTopics, faqKinds } from '@/sections/faq/FaqSections';
import { RoutedEnquiry } from '@/sections/insights/RoutedEnquiry';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = faqPage;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: '/faq',
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /faq, a server component, in the style of Apple's support pages: the
 * hero, the twelve topics as links, then the topics in four chapters (the
 * group, the three companies, the six sectors, the corridor), each topic
 * keeping the anchor id other pages link to, and the compact enquiry form.
 * The group answers are the flag-resolved ones (no manufacturing).
 *
 * JSON-LD: the CollectionPage of the twelve topics (@id /faq#faq), and one
 * FAQPage with exactly the 34 questions the page shows.
 */
export default function FaqPage() {
  const sections = faqSections();
  return (
    <>
      <StructuredData
        data={[
          webPageJsonLd({
            type: 'CollectionPage',
            name: meta.ogTitle,
            path: '/faq',
            fragment: 'faq',
            description: meta.description,
            items: sections.map((section) => ({ name: section.title, path: `/faq#${section.id}` })),
          }),
          faqPageJsonLd(sections.flatMap((section) => section.faqs)),
        ]}
      />
      <FaqHero />
      <FaqTopics sections={sections} />
      {faqKinds.map((kind) => (
        <FaqFamily key={kind} kind={kind} sections={sections} />
      ))}
      <RoutedEnquiry title={enquiryPrompts.faq.title} description={enquiryPrompts.faq.description} />
      <FooterTrail items={[crumbs.home, { name: faqPage.crumb, path: '/faq' }]} />
    </>
  );
}
