import { homeStatement } from '@/content/home';
import { Container, Heading, HeadlineText, Lede, Section } from '@/ui';

/**
 * 2. The statement tile: "One group. Three companies. The corridor that
 * moves the south." set as Apple's two-tone line, with the structure in
 * one sentence beneath. Display from `md`; stepped down on phones
 * (`statement`), where the hero's h1 must lead it. The grey line starts
 * its own line at every width, and "One group." and "Three companies."
 * each stay whole, so the two-tone structure survives on a phone.
 */
export function HomeStatement() {
  return (
    <Section tone="alt" labelledBy="statement-title">
      <Container className="text-center">
        <Heading as="h2" id="statement-title" size="statement">
          <HeadlineText headline={homeStatement.headline} variant="muted-break" breakFrom="always" />
        </Heading>
        <Lede tone="muted" className="mx-auto mt-6 max-w-[40rem] md:mt-8">
          {homeStatement.body}
        </Lede>
      </Container>
    </Section>
  );
}
