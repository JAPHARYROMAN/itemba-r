import { companyPageCopy, isPhoto, type Company } from '@/content/companies';
import { isEnabled } from '@/content/flags';
import { getMedia } from '@/content/media';
import { Container, Eyebrow, Figure, Heading, Section } from '@/ui';
import { companySectionIds } from './CompanySubNav';

/** Owned, enabled photographs not already presented by the page's lead sections. */
export function companyGallery(company: Company) {
  const used = new Set([company.heroImage.media]);
  if (isPhoto(company.strengthsVisual)) used.add(company.strengthsVisual.media);
  return company.gallery.filter((photo) => {
    const entry = getMedia(photo.media);
    if (entry.provenance !== 'own' || !isEnabled(entry.requires) || used.has(photo.media)) return false;
    used.add(photo.media);
    return true;
  });
}

export function CompanyGallery({ company }: { company: Company }) {
  const photos = companyGallery(company);
  if (!photos.length) return null;
  const copy = companyPageCopy.gallery;
  return (
    <Section tone="alt" accent={company.accent} id={companySectionIds.gallery} labelledBy="gallery-title">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Eyebrow dot>{copy.eyebrow}</Eyebrow>
            <Heading as="h2" id="gallery-title" size="h1" className="mt-4">{copy.title}</Heading>
          </div>
          <p className="max-w-md text-body text-fg-muted">{copy.body}</p>
        </div>
        <div className="mt-10 grid gap-7 sm:grid-cols-2 md:mt-14 lg:grid-cols-3">
          {photos.map((photo) => (
            <Figure key={photo.media} media={photo} alt={photo.alt} caption={photo.caption} aspect="4/3" sizes="(min-width: 1280px) 370px, (min-width: 1024px) 30vw, (min-width: 640px) 46vw, calc(100vw - 44px)" />
          ))}
        </div>
      </Container>
    </Section>
  );
}