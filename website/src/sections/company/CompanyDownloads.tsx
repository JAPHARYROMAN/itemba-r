import { companyPageCopy, type Company } from '@/content/companies';
import { profilePdfHref } from '@/content/profile/cover';
import { ButtonLink, ChevronLink, Container, Eyebrow, Heading, Icon, Section } from '@/ui';

export function CompanyDownloads({ company }: { company: Company }) {
  const copy = companyPageCopy.downloads;
  return (
    <Section accent={company.accent} space="tight" labelledBy="downloads-title">
      <Container className="flex flex-col items-start justify-between gap-8 border-y border-line py-8 md:flex-row md:items-center md:py-10">
        <div className="flex items-start gap-5">
          <Icon name="document" size="lg" className="mt-1 shrink-0 text-accent" />
          <div>
            <Eyebrow>{copy.eyebrow}</Eyebrow>
            <Heading as="h2" id="downloads-title" size="h3" className="mt-2">{copy.title}</Heading>
            <p className="mt-3 max-w-xl text-body text-fg-muted">{copy.body}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-4">
          <ButtonLink href={profilePdfHref(company.id)} download icon="download">{copy.action}</ButtonLink>
          <ChevronLink href="/company-profile">{copy.groupAction}</ChevronLink>
        </div>
      </Container>
    </Section>
  );
}