import { contactPage } from '@/content/contactPage';
import { CardLink, Container, Heading, Section } from '@/ui';
import { contactSectionIds } from './ids';

/**
 * "More ways we can help", as an Apple support page closes: where to go
 * for what the form does not cover (partnership routes, the FAQ, the
 * company profile), each a whole-card link. White, so the page's last tile
 * stands apart from the grey footer.
 */
export function ContactHelp() {
  const { help } = contactPage;
  return (
    <Section id={contactSectionIds.help} labelledBy="help-title">
      <Container>
        <Heading as="h2" id="help-title" size="h1">
          {help.heading}
        </Heading>
        <ul role="list" className="mt-10 grid gap-4 md:mt-14 md:grid-cols-3 md:gap-5">
          {help.links.map((link) => (
            <CardLink key={link.href} as="li" href={link.href} title={link.label} description={link.description} cta={help.action} />
          ))}
        </ul>
      </Container>
    </Section>
  );
}
