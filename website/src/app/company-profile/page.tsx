import type { Metadata } from 'next';
import CompanyProfilePrintScope from '@/components/CompanyProfilePrintScope';
import { groupFaqs } from '@/content/faqs';
import { crumbs } from '@/content/nav';
import { profileMeta } from '@/content/profile';
import { faqPageJsonLd, webPageJsonLd } from '@/lib/jsonld';
import { pageMetadata } from '@/lib/seo';
import ProfileDocuments from '@/print/ProfileDocuments';
import { ProfileActivities } from '@/sections/profile/ProfileActivities';
import { ProfileAssets } from '@/sections/profile/ProfileAssets';
import { ProfileAttachments } from '@/sections/profile/ProfileAttachments';
import { ProfileBanking } from '@/sections/profile/ProfileBanking';
import { ProfileCompliance } from '@/sections/profile/ProfileCompliance';
import { ProfileContact } from '@/sections/profile/ProfileContact';
import { ProfileCover } from '@/sections/profile/ProfileCover';
import { ProfileFaqs } from '@/sections/profile/ProfileFaqs';
import { ProfileFinancial } from '@/sections/profile/ProfileFinancial';
import { ProfileFuturePlans } from '@/sections/profile/ProfileFuturePlans';
import { ProfileHistory } from '@/sections/profile/ProfileHistory';
import { ProfileManagement } from '@/sections/profile/ProfileManagement';
import { ProfileMarkets } from '@/sections/profile/ProfileMarkets';
import { ProfileOperations } from '@/sections/profile/ProfileOperations';
import { ProfileOverview } from '@/sections/profile/ProfileOverview';
import { ProfileProducts } from '@/sections/profile/ProfileProducts';
import { ProfileStrengths } from '@/sections/profile/ProfileStrengths';
import { ProfileSubNav } from '@/sections/profile/ProfileSubNav';
import { ProfileVision } from '@/sections/profile/ProfileVision';
import { FooterTrail } from '@/shell/SiteFooter';
import { StructuredData } from '@/ui';

const PATH = '/company-profile';

export const metadata: Metadata = pageMetadata({
  title: profileMeta.title,
  description: profileMeta.description,
  path: PATH,
  ogTitle: profileMeta.ogTitle,
  ogDescription: profileMeta.ogDescription,
});

/**
 * The company profile, as an annual report on screen: the sticky sub-nav
 * with the contents sheet (a scrollspy over the 17 outline sections), the
 * cover (hero, key facts, the four PDFs and the live print picker), then
 * the chapters in outline order, each under its outline id, the group
 * questions, and the breadcrumb trail. A server component; the islands are
 * the contents sheet, the print picker, the enquiry form and the print
 * asset loader.
 *
 * Print contract (src/styles/print.css, scripts/generate-profile-pdfs.mjs):
 * CompanyProfilePrintScope marks <body> so any print of the page shows the
 * light A4 documents (group by default); the documents themselves
 * (src/print/ProfileDocuments.tsx) are hidden on screen, and their photos
 * are lazy, so a screen visit downloads none of them.
 *
 * Tone rhythm: the cover light, the downloads grey, then the chapters
 * alternate white and grey, with three cinema tiles well apart (Vision and
 * Mission, Company History, Competitive Strengths); the questions close on
 * white before the grey footer.
 */
export default function CompanyProfilePage() {
  return (
    <>
      <StructuredData
        data={[
          webPageJsonLd({
            type: 'AboutPage',
            fragment: 'profile',
            name: profileMeta.ogTitle,
            path: PATH,
            description: profileMeta.ogDescription,
          }),
          faqPageJsonLd(groupFaqs),
        ]}
      />
      <CompanyProfilePrintScope />
      <ProfileSubNav />
      <ProfileCover />
      <ProfileOverview />
      <ProfileVision />
      <ProfileActivities />
      <ProfileProducts />
      <ProfileMarkets />
      <ProfileOperations />
      <ProfileManagement />
      <ProfileHistory />
      <ProfileAssets />
      <ProfileFinancial />
      <ProfileCompliance />
      <ProfileStrengths />
      <ProfileFuturePlans />
      <ProfileBanking />
      <ProfileContact />
      <ProfileAttachments />
      <ProfileFaqs />
      <FooterTrail items={[crumbs.home, { name: profileMeta.title, path: PATH }]} />
      <ProfileDocuments />
    </>
  );
}
