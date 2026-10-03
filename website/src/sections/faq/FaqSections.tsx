import { faqPage, type FaqSection, type FaqSectionKind } from '@/content/faqs';
import type { Tone } from '@/design/tokens';
import { ChevronLink, Container, FaqList, Heading, HeadlineText, Icon, PageHero, Section, keepCompounds } from '@/ui';

/** The four topic families, in page order. */
export const faqKinds: readonly FaqSectionKind[] = ['group', 'company', 'service', 'location'];

/** The families' tiles alternate after the grey topic index: white, grey, white, grey (the form's white follows). */
const familyTones: Record<FaqSectionKind, Tone> = { group: 'light', company: 'alt', service: 'light', location: 'alt' };

const familyTitleId = (kind: FaqSectionKind) => `faq-${kind}-title`;

/**
 * The /faq hero: "Answers for customers and partners." (the second phrase
 * on its own line from `md`), what the page covers, and the way to the
 * form at its foot. Static server HTML.
 */
export function FaqHero() {
  const { hero } = faqPage;
  return (
    <PageHero
      eyebrow={hero.eyebrow}
      title={<HeadlineText headline={hero.headline} variant="break" />}
      titleSize="display"
      lede={hero.lede}
      actions={<ChevronLink href="#enquire">{hero.ask}</ChevronLink>}
    />
  );
}

const countLabel = (count: number) => `${count} ${count === 1 ? faqPage.questions.one : faqPage.questions.other}`;

/**
 * "Browse topics": the twelve topics as pill links, one row per family
 * (the family's name beside them from `md`), each with its line icon in
 * the company's accent and its question count. Every link lands on the
 * topic's anchor below (#partnerships, #company-mwanjalisi-oil, …).
 */
export function FaqTopics({ sections }: { sections: readonly FaqSection[] }) {
  return (
    <Section tone="alt" labelledBy="topics-title">
      <Container>
        <Heading as="h2" id="topics-title" size="h2">
          {faqPage.topicsHeading}
        </Heading>
        <div className="mt-8 border-b border-line md:mt-10">
          {faqKinds.map((kind) => {
            const topics = sections.filter((section) => section.kind === kind);
            if (!topics.length) return null;
            const labelId = `topics-${kind}`;
            return (
              <div key={kind} className="grid gap-3 border-t border-line py-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8 md:py-6">
                <h3 id={labelId} className="text-body font-semibold text-fg md:pt-2.5">
                  {faqPage.groups[kind]}
                </h3>
                <ul role="list" aria-labelledby={labelId} className="grid gap-2 md:flex md:flex-wrap">
                  {topics.map((topic) => (
                    <li key={topic.id} data-accent={topic.accent} className="flex">
                      <a
                        href={`#${topic.id}`}
                        className="flex min-h-11 w-full items-center gap-3 rounded-card bg-surface-alt px-4 py-2.5 text-body text-fg transition-shadow duration-base ease-apple hover:shadow-card md:w-auto md:gap-2 md:rounded-pill md:py-2"
                      >
                        <Icon name={topic.icon} size="sm" strokeWidth={1.6} className="text-accent" />
                        <span className="flex-1 md:flex-none">{keepCompounds(topic.title)}</span>
                        <span className="whitespace-nowrap text-caption text-fg-muted">{countLabel(topic.faqs.length)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}

/**
 * One topic (the anchor other pages link to): its icon, what it is, its
 * name and one sentence, and the page that covers it, beside its questions
 * as disclosure rows (<details>, no JS; each question an h4 under the
 * topic's h3). Every question is also in the page's FAQPage JSON-LD.
 */
function FaqTopic({ topic }: { topic: FaqSection }) {
  const titleId = `${topic.id}-title`;
  return (
    <div
      id={topic.id}
      role="group"
      aria-labelledby={titleId}
      data-accent={topic.accent}
      className="grid gap-6 py-10 first:pt-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:border-t lg:border-line lg:py-12 lg:first:pt-12"
    >
      <div>
        <Icon name={topic.icon} size="lg" strokeWidth={1.4} className="text-accent" />
        <p className="mt-5 text-eyebrow text-fg-muted">{keepCompounds(topic.eyebrow)}</p>
        <Heading as="h3" id={titleId} size="h3" className="mt-1.5">
          {topic.title}
        </Heading>
        <p className="mt-3 text-body text-fg-muted">{keepCompounds(topic.description)}</p>
        <ChevronLink href={topic.href} context={topic.title} className="mt-5">
          {topic.linkLabel}
        </ChevronLink>
      </div>
      {/*
        From `lg` the topic's full-width rule heads its questions, so the
        list drops its own outer rules there (one hairline between topics,
        never two), and its first question lines up with the icon.
      */}
      <FaqList faqs={topic.faqs} headingLevel={4} rules="lg:between" className="lg:-mt-5" />
    </div>
  );
}

/**
 * One family of topics as a tile: its name as the chapter's h2 ("One
 * group.", "Three companies.", "Six sectors.", "One corridor."), then its
 * topics in hairline-separated rows.
 */
export function FaqFamily({ kind, sections }: { kind: FaqSectionKind; sections: readonly FaqSection[] }) {
  const topics = sections.filter((section) => section.kind === kind);
  if (!topics.length) return null;
  return (
    <Section tone={familyTones[kind]} labelledBy={familyTitleId(kind)}>
      <Container>
        <Heading as="h2" id={familyTitleId(kind)} size="h1">
          {faqPage.groups[kind]}
        </Heading>
        <div className="mt-10 lg:mt-12">
          {topics.map((topic) => (
            <FaqTopic key={topic.id} topic={topic} />
          ))}
        </div>
      </Container>
    </Section>
  );
}
