import { withFlags } from '@/content/flags';
import { homeNumbers, homeNumbersCopy } from '@/content/home';
import { Container, Heading, Section, Stat, StatList } from '@/ui';

/**
 * 6. By the numbers: big static numerals on black. No count-up. The
 * unconfirmed divisions figure stays hidden until the owner confirms it
 * (flags.showDivisionsStat).
 */
export function HomeNumbers() {
  const stats = withFlags(homeNumbers);
  return (
    <Section tone="cinema" labelledBy="numbers-title">
      <Container>
        <Heading as="h2" id="numbers-title" size="h1" className="max-w-[40rem]">
          {homeNumbersCopy.title}
        </Heading>
        <StatList columns={4} className="mt-14 md:mt-20">
          {stats.map((stat) => (
            <Stat key={stat.label} value={stat.value} label={stat.label} className="border-t border-line pt-6" />
          ))}
        </StatList>
      </Container>
    </Section>
  );
}
