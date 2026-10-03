import { capabilitiesPage } from '@/content/capabilities';
import { enquiryIntents, enquiryPrompts } from '@/content/enquiry';
import EnquiryRouter from '@/islands/EnquiryRouter';
import { ChevronLink, Container, Eyebrow, Heading, Lede, Section, cn } from '@/ui';
import { capabilitiesSectionIds as ids } from './ids';

/**
 * "Ready to contact the group?": the full enquiry form (name, organisation,
 * preferred contact and message), for the general route by default. On the
 * left, sticky under the nav from `lg`: the one-office promise, a legend of
 * the form's enquiry types (each marked as the form marks it, ink for the
 * group office and the company accent otherwise, with what it covers), so a
 * visitor knows which to pick, and the way on to the partnership routes. On
 * the right the form, on the alternate grey. The section is white, so the
 * page's last tile stands apart from the grey footer. The hero's pill lands
 * here.
 */
export function CapabilitiesEnquire() {
  const { route } = capabilitiesPage;
  return (
    <Section id={ids.enquire} labelledBy="enquire-title">
      <Container className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="lg:sticky lg:top-[calc(var(--nav-height)+2rem)]">
          <Eyebrow>{route.eyebrow}</Eyebrow>
          <Heading as="h2" id="enquire-title" size="h1" className="mt-3">
            {route.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {route.body}
          </Lede>
          <h3 className="mt-10 text-eyebrow text-fg-muted">{route.optionsLabel}</h3>
          <dl className="mt-3 border-b border-line">
            {enquiryIntents.map((intent) => (
              <div
                key={intent.id}
                data-accent={intent.id === 'general' ? undefined : intent.id}
                className="flex flex-col gap-0.5 border-t border-line py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <dt className="flex items-center gap-2.5 whitespace-nowrap text-body font-semibold text-fg">
                  <span
                    aria-hidden="true"
                    className={cn('size-2 shrink-0 rounded-full', intent.id === 'general' ? 'bg-fg' : 'bg-accent')}
                  />
                  {intent.segmentLabel}
                </dt>
                <dd className="pl-[1.125rem] text-caption text-fg-muted sm:pl-0 sm:text-right">{intent.label}</dd>
              </div>
            ))}
          </dl>
          <ChevronLink href={route.link.href} className="mt-6">
            {route.link.label}
          </ChevronLink>
        </div>
        <EnquiryRouter
          headingLevel={3}
          defaultIntentId="general"
          title={enquiryPrompts.capabilities.title}
          description={enquiryPrompts.capabilities.description}
        />
      </Container>
    </Section>
  );
}
