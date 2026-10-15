import { withFlags } from '@/content/flags';
import { homeNumbers, homeNumbersCopy } from '@/content/home';
import { Container, Heading, Section, Stat, StatList } from '@/ui';

export function HomeNumbers() {
  return <Section tone="alt" space="tight" labelledBy="numbers-title" className="border-b border-line">
    <Container>
      <Heading as="h2" id="numbers-title" size="h5" className="mb-8 text-fg-muted">{homeNumbersCopy.title}</Heading>
      <StatList columns={4}>{withFlags(homeNumbers).map((stat) => <Stat key={stat.label} value={stat.value} label={stat.label} size="h1" className="border-l border-line pl-5" />)}</StatList>
    </Container>
  </Section>;
}
