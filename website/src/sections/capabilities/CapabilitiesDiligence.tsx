import { capabilitiesPage, partnerChecklist } from '@/content/capabilities';
import { CheckList, ChevronLink, Container, Eyebrow, Heading, Lede, Section, TypePanel } from '@/ui';
import { capabilitiesSectionIds as ids } from './ids';

const { diligence } = capabilitiesPage;

/**
 * "Prepare a stronger business enquiry": the page's one cinema tile, as the
 * company pages set their key strengths. A typographic panel leads (on
 * phones first, on the left from `lg`): the company profile is written for
 * banks and partners, and each profile is a ready-made download. Beside it
 * the heading, what a partner can confirm on the site, the checklist of
 * what to have ready, and the two profiles to read first.
 */
export function CapabilitiesDiligence() {
  const { visual, actions } = diligence;
  return (
    <Section tone="cinema" id={ids.diligence} labelledBy="diligence-title">
      <Container className="grid items-center gap-10 md:gap-12 lg:grid-cols-[minmax(0,27.5rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Eyebrow>{diligence.eyebrow}</Eyebrow>
          <Heading as="h2" id="diligence-title" size="h1" className="mt-3">
            {diligence.title}
          </Heading>
          <Lede tone="muted" className="mt-5 max-md:text-body-lg">
            {diligence.body}
          </Lede>
          <h3 className="mt-10 text-eyebrow text-fg-muted">{diligence.checklistLabel}</h3>
          <CheckList items={partnerChecklist} className="mt-3" />
          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3">
            <ChevronLink href={actions.profile.href}>{actions.profile.label}</ChevronLink>
            <ChevronLink href={actions.location.href}>{actions.location.label}</ChevronLink>
          </div>
        </div>
        <TypePanel
          icon={visual.icon}
          statement={visual.statement}
          caption={visual.caption}
          className="order-first mx-auto aspect-[4/3] w-full max-w-md sm:aspect-square lg:mx-0 lg:max-w-none"
        />
      </Container>
    </Section>
  );
}
