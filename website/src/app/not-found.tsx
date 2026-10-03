import type { Metadata } from 'next';
import { companies, companiesPage } from '@/content/companies';
import { notFoundPage } from '@/content/errors';
import { homeCompanyTiles, homeSectors, homeTileActions } from '@/content/home';
import { footerDirectory } from '@/content/nav';
import { companyUrl } from '@/content/site';
import { ButtonLink, CardLink, ChevronLink, Heading, HeadlineText, Lede, PageHero } from '@/ui';

/**
 * "Page Not Found": the root template adds " | Itemba Group" once
 * (origin/main set a title that already carried the suffix, so it rendered
 * twice). Not indexable, and no canonical: a missing page has no address
 * of its own to point search engines at (the layout's canonical is home).
 */
export const metadata: Metadata = {
  title: notFoundPage.metaTitle,
  description: notFoundPage.body,
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

/**
 * The 404: a calm light page, one screen of it. The message and two ways
 * on (home, and the group office that routes every enquiry), then the
 * three companies, since a mistyped company or service address is the
 * likeliest way here. The footer's full directory follows.
 *
 * A server component. Unknown slugs land here too: every [slug] route
 * sets `dynamicParams = false` or calls notFound().
 */
export default function NotFound() {
  const tiles = homeCompanyTiles.flatMap((tile) => {
    const company = companies.find((c) => c.slug === tile.companySlug);
    return company ? [{ tile, company }] : [];
  });

  return (
    <PageHero
      titleId="page-title"
      eyebrow={notFoundPage.eyebrow}
      title={notFoundPage.heading}
      lede={notFoundPage.body}
      actions={
        <>
          <ButtonLink href={notFoundPage.home.href} size="lg">
            {notFoundPage.home.label}
          </ButtonLink>
          <ChevronLink href={footerDirectory.contact.page.href} size="body-lg">
            {footerDirectory.contact.page.label}
          </ChevronLink>
        </>
      }
    >
      <section aria-labelledby="not-found-companies" className="mt-8 border-t border-line pt-14 md:mt-12 md:pt-20">
        <Heading as="h2" id="not-found-companies" size="h2">
          <HeadlineText headline={companiesPage.hero.headline} variant="muted" />
        </Heading>
        <Lede tone="muted" className="mx-auto mt-3 max-w-2xl max-md:text-body-lg">
          {homeSectors.routing.body}
        </Lede>
        {/* Three across from `md`; on phones a row that snaps card by card, as home's insights row, so three stacked cards do not add two screens to a 404. */}
        <ul
          role="list"
          className="-mx-gutter mt-10 flex snap-x snap-mandatory scroll-px-gutter gap-3 overflow-x-auto px-gutter pb-2 text-left md:mx-0 md:mt-12 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0"
        >
          {tiles.map(({ tile, company }) => (
            <li key={company.slug} className="flex w-[82%] max-w-sm shrink-0 snap-start md:w-auto md:max-w-none">
              <CardLink
                as="div"
                href={companyUrl(company.slug)}
                accent={company.accent}
                eyebrow={tile.eyebrow}
                eyebrowDot
                title={tile.name}
                description={tile.summary}
                cta={homeTileActions.explore}
                className="w-full"
              />
            </li>
          ))}
        </ul>
      </section>
    </PageHero>
  );
}
