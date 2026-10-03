import type { Metadata } from 'next';
import { aboutPage } from '@/content/about';
import { crumbs } from '@/content/nav';
import { webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import { AboutApproach } from '@/sections/about/AboutApproach';
import { AboutHeadquarters } from '@/sections/about/AboutHeadquarters';
import { AboutHero } from '@/sections/about/AboutHero';
import { AboutLeadership } from '@/sections/about/AboutLeadership';
import { AboutStructure } from '@/sections/about/AboutStructure';
import { AboutTimeline } from '@/sections/about/AboutTimeline';
import { HomeClosing } from '@/sections/home/HomeClosing';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const { meta } = aboutPage;
const crumb = crumbs.about;

export const metadata: Metadata = pageMetadata({
  title: meta.title,
  description: meta.description,
  path: crumb.path,
  ogTitle: meta.ogTitle,
  ogDescription: meta.ogDescription,
});

/**
 * /about, a server component: "Built for Tanzania. Built to last." Then
 * the group structure (three tiers), why the group diversifies (a bento),
 * the milestones from 2012 to 2025, the leadership team, the head office
 * (the page's one cinema tile, with the Songwe landscape) and the closing
 * call to action. The trail (and the page's only BreadcrumbList) closes the
 * page above the footer. The layout emits the Organization and WebSite;
 * the page adds its AboutPage. No enquiry form here: the quick-contact bar
 * stays (QuickContact's route matrix).
 */
export default function AboutPage() {
  return (
    <>
      <StructuredData
        data={webPageJsonLd({
          type: 'AboutPage',
          name: aboutPage.jsonLdName,
          path: crumb.path,
          description: aboutPage.whoWeAre.lead,
        })}
      />
      <AboutHero />
      <AboutStructure />
      <AboutApproach />
      <AboutTimeline />
      <AboutLeadership />
      <AboutHeadquarters />
      <HomeClosing />
      <FooterTrail items={[crumbs.home, crumb]} />
    </>
  );
}
