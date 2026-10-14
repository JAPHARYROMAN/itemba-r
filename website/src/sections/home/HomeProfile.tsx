import { homeProfile } from '@/content/home';
import { profilePdfHref } from '@/content/profile/cover';
import { ButtonLink, ChevronLink, Container, Eyebrow, Heading, Icon, Section } from '@/ui';

export function HomeProfile() {
  return <Section labelledBy="profile-title">
    <Container className="grid items-start gap-8 border-t border-line pt-10 lg:grid-cols-[1fr_2fr] lg:gap-20">
      <div><Icon name="document" size="lg" className="text-accent-fg" /><Eyebrow className="mt-5">{homeProfile.eyebrow}</Eyebrow></div>
      <div><Heading as="h2" id="profile-title" size="h1">{homeProfile.title}</Heading><p className="mt-5 max-w-[38rem] text-body-lg text-fg-muted">{homeProfile.body}</p>
        <div className="mt-8 flex flex-wrap items-center gap-7"><ButtonLink href={profilePdfHref('group')} download>{homeProfile.download}</ButtonLink><ChevronLink href="/company-profile">{homeProfile.explore}</ChevronLink></div>
      </div>
    </Container>
  </Section>;
}
