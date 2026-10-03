import { coverFacts, profileCover, profilePdfHref } from '@/content/profile';
import { LeadPhoto, heroFrame } from '@/sections/company/LeadPhoto';
import { ButtonLink, ChevronLink, Container, Heading, HeadlineText, PageHero, Section, keepCompounds } from '@/ui';
import { ProfileDownloads } from './ProfileDownloads';
import { ENQUIRE_ID } from './ProfileSubNav';

/**
 * §1, the cover: everything above the first chapter, under the outline id
 * `cover-page` (so the contents sheet reads "Cover page" while any of it is
 * in view).
 *
 * - The hero: who the document is for, the title as Apple's two-tone line
 *   (the page's only h1), one sentence on the group, then the two actions:
 *   the group profile as a PDF (the pill, with the download glyph) and the
 *   enquiry form further down the page; then the cover photograph, a 2400px
 *   landscape master framed 2:1 in the content width (LeadPhoto heroFrame,
 *   the company template's hero), cropped tighter on phones. Static server
 *   HTML: the hero and its LCP photograph never animate.
 * - "At a glance": the four facts a bank or partner reads first.
 * - The four ready-made PDFs and the live print picker (ProfileDownloads).
 */
export function ProfileCover() {
  const photo = profileCover.image;
  const frame = heroFrame(photo);
  return (
    <div id="cover-page">
      <PageHero
        eyebrow={profileCover.eyebrow}
        title={<HeadlineText headline={profileCover.headline} variant="muted-break" breakFrom="always" />}
        titleSize="display"
        lede={profileCover.lede}
        actions={
          <>
            <ButtonLink href={profilePdfHref('group')} download size="lg" icon="download">
              {profileCover.downloadLabel}
            </ButtonLink>
            <ChevronLink href={`#${ENQUIRE_ID}`} size="body-lg">
              {profileCover.enquireLabel}
            </ChevronLink>
          </>
        }
        mediaLayout={frame.layout}
        mediaSize="content"
        media={<LeadPhoto photo={photo} shape={frame.shape} width={frame.width} zoom={frame.zoom} priority />}
      />

      <Section space="none" labelledBy="glance-title" className="pb-section-tight">
        <Container>
          <Heading as="h2" id="glance-title" size="h5">
            {profileCover.glanceTitle}
          </Heading>
          {/* FactList's grid, two by two: four facts, one of them a long list, sit evenly in two columns rather than three and one. */}
          <dl className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
            {coverFacts.map((fact) => (
              <div key={fact.label} className="border-t border-line pt-4">
                <dt className="text-caption text-fg-muted">{fact.label}</dt>
                <dd className="mt-1 text-body-lg text-fg">{keepCompounds(fact.value)}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>

      <ProfileDownloads />
    </div>
  );
}
