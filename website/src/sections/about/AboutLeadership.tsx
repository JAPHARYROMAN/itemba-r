import { aboutPage } from '@/content/about';
import { isEnabled } from '@/content/flags';
import { leadershipTeam } from '@/content/profile/leadership';
import { Card, Container, Eyebrow, Heading, Lede, Section, cn, keepCompounds } from '@/ui';

/**
 * The leadership team as typographic cards, with no portraits and no
 * stand-in avatars: each card is the group role, the name and the roles
 * held in the companies. The chairman's card leads, two columns wide from
 * `lg`, so five cards make two even rows of three columns. The section is
 * gated with the directors and legal identifiers
 * (flags.publishLegalIdentifiers).
 */
export function AboutLeadership() {
  const { leadership } = aboutPage;
  if (!isEnabled(leadership.requires)) return null;
  return (
    <Section labelledBy="leadership-title">
      <Container>
        <div>
          <Eyebrow>{leadership.eyebrow}</Eyebrow>
          <Heading as="h2" id="leadership-title" size="h1" className="mt-2">
            {leadership.title}
          </Heading>
          <Lede tone="muted" className="mt-5 max-w-[40rem] md:mt-6">
            {leadership.lede}
          </Lede>
        </div>
        <ul role="list" className="mt-10 grid gap-3 sm:grid-cols-2 md:mt-14 md:gap-4 lg:grid-cols-3">
          {leadershipTeam.map((person, index) => {
            const lead = index === 0;
            return (
              <Card
                key={person.name}
                as="li"
                padding="none"
                className={cn('flex flex-col p-6 md:p-8', lead && 'sm:col-span-2 lg:col-span-2')}
              >
                <Eyebrow tone="gold">{person.groupRole}</Eyebrow>
                <Heading as="h3" size={lead ? 'h3' : 'h4'} className="mt-2">
                  {person.name}
                </Heading>
                <p className={cn('mt-2 text-body text-fg-muted sm:mt-auto sm:pt-6', lead && 'md:text-body-lg')}>{keepCompounds(person.companyRole)}</p>
              </Card>
            );
          })}
        </ul>
      </Container>
    </Section>
  );
}
