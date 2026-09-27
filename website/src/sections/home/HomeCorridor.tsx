import { homeCorridor } from '@/content/home';
import { CorridorStory } from '@/sections/corridor/CorridorStory';
import { ChevronLink, Container, Eyebrow, FactList, Heading, Lede, Section } from '@/ui';

/**
 * 5. The corridor story, the page's signature moment: "Where Tanzania meets
 * Zambia." Dar es Salaam → Southern Highlands → Mpemba-Tunduma → the
 * Tunduma border → Zambia, DRC, Zimbabwe and Malawi. From `lg` the route
 * draws itself as the stops scroll past (CSS scroll timelines); everywhere
 * else it is a static, fully drawn list.
 */
export function HomeCorridor() {
  return (
    <Section tone="alt" id="corridor" labelledBy="corridor-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{homeCorridor.eyebrow}</Eyebrow>
          <Heading as="h2" id="corridor-title" size="display" className="mt-2">
            {homeCorridor.title}
          </Heading>
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem] md:mt-6">
            {homeCorridor.body}
          </Lede>
        </div>

        <CorridorStory labelledBy="corridor-title" className="mt-16 md:mt-24" />

        <div className="mt-16 md:mt-24">
          <FactList layout="grid" items={homeCorridor.facts.map((fact) => ({ key: fact.label, term: fact.label, detail: fact.value }))} />
          <ChevronLink href={homeCorridor.link.href} className="mt-8">
            {homeCorridor.link.label}
          </ChevronLink>
        </div>
      </Container>
    </Section>
  );
}
