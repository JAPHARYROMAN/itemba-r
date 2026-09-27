/**
 * /__kit: a development-only catalogue of the UI kit (src/ui), rendered
 * with real content so page authors can see every component in each tone.
 *
 * - It returns 404 in production builds (NODE_ENV=production), so it never
 *   ships as a page, and it is noindex.
 * - It is not in the sitemap (src/app/sitemap.ts lists content routes only).
 * - The folder is `%5F%5Fkit` because Next treats `_folders` as private; the
 *   encoded underscores give the URL /__kit.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { companies } from '@/content/companies';
import { withFlags } from '@/content/flags';
import {
  homeClosing,
  homeCompanyTiles,
  homeCorridor,
  homeCorridorMap,
  homeHero,
  homeNumbers,
  homeSectors,
  homeStatement,
} from '@/content/home';
import { enquiryPrompts } from '@/content/enquiry';
import { insightArticles } from '@/content/insights';
import { mediaImage } from '@/content/media';
import { printButtonCopy, printProfileOptions, profileNavCopy } from '@/content/profile';
import { serviceAreas } from '@/content/services';
import EnquiryRouter from '@/islands/EnquiryRouter';
import PrintProfileButton from '@/islands/PrintProfileButton';
import ProfileNav from '@/islands/ProfileNav';
import { pageMetadata } from '@/lib/seo';
import { CorridorMap } from '@/sections/corridor/CorridorMap';
import { CorridorStory } from '@/sections/corridor/CorridorStory';
import {
  Bento,
  BentoCell,
  Breadcrumbs,
  Button,
  ButtonLink,
  CardLink,
  Chip,
  ChipList,
  ChevronLink,
  ContactLink,
  Container,
  CtaBand,
  Eyebrow,
  FactList,
  FaqList,
  Figure,
  Grid,
  Heading,
  HeadlineText,
  Icon,
  iconNames,
  Lede,
  Media,
  PageHero,
  Prose,
  Reveal,
  Section,
  Stat,
  StatList,
  SubNav,
} from '@/ui';

export const metadata: Metadata = pageMetadata({
  title: 'UI kit',
  description: 'Development catalogue of the Itemba UI kit.',
  path: '/__kit',
  noindex: true,
});

/** The kit's own sections, for the ProfileNav demo in its sub-nav (scrollspy and contents sheet). */
const kitOutline = [
  { id: 'type', title: 'Type scale' },
  { id: 'actions', title: 'Actions' },
  { id: 'companies', title: 'Company tiles' },
  { id: 'bento', title: 'Bento' },
  { id: 'data', title: 'Data display' },
  { id: 'media', title: 'Cards and media' },
  { id: 'enquiry', title: 'Enquiry form' },
  { id: 'corridor', title: 'Corridor story' },
  { id: 'sites', title: 'Corridor sites' },
  { id: 'print', title: 'Print picker' },
] as const;

const companyPaths: Record<string, string> = Object.fromEntries(companies.map((c) => [c.slug, `/companies/${c.slug}`]));

export default function KitPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  const mwanjalisi = companies[0]!;
  const article = insightArticles[0]!;
  const tones = ['light', 'alt', 'cinema'] as const;

  return (
    <>
      <SubNav
        title="UI kit"
        label="UI kit sections"
        titleHref="#page-title"
        links={[
          { href: '#type', label: 'Type' },
          { href: '#actions', label: 'Actions' },
          { href: '#companies', label: 'Tiles' },
          { href: '#bento', label: 'Bento' },
          { href: '#data', label: 'Data' },
          { href: '#media', label: 'Media' },
        ]}
        cta={{ href: '/partnerships', label: 'Enquire' }}
      >
        <ProfileNav outline={kitOutline} labels={profileNavCopy} />
      </SubNav>

      <PageHero
        breadcrumbs={
          <Breadcrumbs
            items={[
              { name: 'Home', path: '/' },
              { name: 'UI kit', path: '/__kit' },
            ]}
          />
        }
        eyebrow={homeHero.eyebrow}
        title={<HeadlineText headline={homeHero.headline} variant="break" />}
        lede={homeHero.lede}
        actions={
          <>
            <ButtonLink href={homeHero.actions[0]!.href}>{homeHero.actions[0]!.label}</ButtonLink>
            <ChevronLink href={homeHero.actions[1]!.href} size="lede">
              {homeHero.actions[1]!.label}
            </ChevronLink>
          </>
        }
        media={<Media media={homeHero.image} alt={homeHero.image.alt} sizes="(min-width: 1484px) 1440px, calc(100vw - 44px)" aspect="16/9" priority />}
      />

      <Section tone="alt" labelledBy="statement-title">
        <Container size="prose" className="text-center">
          <Heading as="h2" id="statement-title" size="display">
            <HeadlineText headline={homeStatement.headline} />
          </Heading>
          <Lede tone="muted" className="mx-auto mt-6 max-w-[40rem]">
            {homeStatement.body}
          </Lede>
        </Container>
      </Section>

      <Section id="type" labelledBy="type-title">
        <Container>
          <Eyebrow>Type scale</Eyebrow>
          <Heading as="h2" id="type-title" className="mt-2">
            Inter, set the Apple way.
          </Heading>
          <div className="mt-12 space-y-8">
            {(['display-xl', 'display', 'h1', 'h2', 'h3', 'h4', 'h5'] as const).map((size) => (
              <div key={size} className="grid gap-2 border-t border-line pt-6 md:grid-cols-4">
                <p className="text-caption text-fg-muted">{size}</p>
                <Heading as="h3" size={size} className="md:col-span-3">
                  Fuel, trade & logistics.
                </Heading>
              </div>
            ))}
            <div className="grid gap-2 border-t border-line pt-6 md:grid-cols-4">
              <p className="text-caption text-fg-muted">lede / body / caption</p>
              <div className="space-y-4 md:col-span-3">
                <Lede>{homeCorridor.body}</Lede>
                <p className="text-body">{mwanjalisi.summary}</p>
                <p className="text-caption text-fg-muted">{mwanjalisi.eyebrow}</p>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <div id="actions">
        {tones.map((tone) => (
          <Section key={tone} tone={tone} space="tight" labelledBy={`actions-${tone}`}>
            <Container>
              <Heading as="h2" size="h3" id={`actions-${tone}`}>
                Actions on {tone}
              </Heading>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                <ButtonLink href="/partnerships">Enquire</ButtonLink>
                <ButtonLink href="/contact" variant="secondary">
                  Contact the group
                </ButtonLink>
                <ButtonLink href="/partnerships" size="sm">
                  Enquire
                </ButtonLink>
                <ButtonLink href="/company-profile" size="lg" icon="download">
                  Company profile
                </ButtonLink>
                <Button variant="inverse">Inverse pill</Button>
                <Button disabled>Disabled</Button>
                <ChevronLink href="/about" context="about Itemba Group">
                  Learn more
                </ChevronLink>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4">
                <ContactLink kind="tel" appearance="secondary">
                  Call
                </ContactLink>
                <ContactLink kind="whatsapp" appearance="secondary">
                  WhatsApp
                </ContactLink>
                <ContactLink kind="mailto" subject="Business enquiry" appearance="chevron">
                  Email us
                </ContactLink>
              </div>
            </Container>
          </Section>
        ))}
      </div>

      <div id="companies">
        {homeCompanyTiles.map((tile, index) => {
          const tone = tones[index % 3]!;
          const company = companies.find((c) => c.slug === tile.companySlug)!;
          return (
            <Section key={tile.companySlug} tone={tone} accent={company.accent} labelledBy={`tile-${tile.companySlug}`}>
              <Container className="text-center">
                <Eyebrow dot>{company.legalName}</Eyebrow>
                <Heading as="h2" id={`tile-${tile.companySlug}`} size="display" className="mt-3">
                  {tile.name}
                </Heading>
                <Lede className="mx-auto mt-5 max-w-2xl" tone="muted">
                  {tile.summary}
                </Lede>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
                  <ChevronLink href={companyPaths[tile.companySlug]!} size="lede" context={tile.name}>
                    Explore
                  </ChevronLink>
                  <ChevronLink href="/partnerships" size="lede" context={tile.name}>
                    Enquire
                  </ChevronLink>
                </div>
              </Container>
              <Reveal>
                <Container size="wide" className="mt-12">
                  <Media
                    media={company.tileImage}
                    alt={company.tileImage.alt}
                    sizes="(min-width: 1484px) 1440px, calc(100vw - 44px)"
                    aspect="21/9"
                    radius="tile"
                  />
                </Container>
              </Reveal>
            </Section>
          );
        })}
      </div>

      <Section id="bento" tone="light" labelledBy="bento-title">
        <Container size="wide">
          <div className="mx-auto max-w-content text-center">
            <Eyebrow>{homeSectors.eyebrow}</Eyebrow>
            <Heading as="h2" id="bento-title" size="display" className="mt-2">
              {homeSectors.title}
            </Heading>
          </div>
          <Bento as="ul" className="mt-12">
            {homeSectors.items.map((item, index) => (
              <BentoCell key={item.serviceSlug} as="li" span={index < 2 ? 'half' : 'third'} tone={index === 1 ? 'cinema' : undefined}>
                <Icon name={item.icon} size="lg" className="text-accent" />
                <Heading as="h3" size="h3" className="mt-6">
                  {item.name}
                </Heading>
                <ChevronLink href={`/services/${item.serviceSlug}`} className="mt-4" context={item.name}>
                  {homeSectors.action}
                </ChevronLink>
              </BentoCell>
            ))}
          </Bento>
        </Container>
      </Section>

      <Section id="data" tone="alt" labelledBy="numbers-title">
        <Container>
          <Heading as="h2" id="numbers-title" size="h2">
            By the numbers
          </Heading>
          <StatList className="mt-12">
            {withFlags(homeNumbers).map((stat) => (
              <Stat key={stat.label} value={stat.value} label={stat.label} />
            ))}
          </StatList>
          <div className="mt-16 grid gap-12 lg:grid-cols-2">
            <div>
              <Heading as="h3" size="h3">
                Chips and facts
              </Heading>
              <ChipList className="mt-6">
                {mwanjalisi.band.chips.map((chip) => (
                  <Chip as="li" key={chip} dot>
                    {chip}
                  </Chip>
                ))}
              </ChipList>
              <FactList
                className="mt-8"
                items={[
                  { term: 'Registered name', detail: mwanjalisi.legalName },
                  { term: 'Incorporated', detail: mwanjalisi.legal.incorporationDate },
                  { term: 'Status', detail: mwanjalisi.legal.status },
                ]}
              />
              <FactList className="mt-8" layout="grid" items={homeCorridor.facts.map((fact) => ({ term: fact.label, detail: fact.value }))} />
            </div>
            <div>
              <Heading as="h3" size="h3">
                Questions
              </Heading>
              <FaqList className="mt-6" faqs={mwanjalisi.faqs} headingLevel={4} />
            </div>
          </div>
        </Container>
      </Section>

      <Section id="media" labelledBy="cards-title">
        <Container>
          <Heading as="h2" id="cards-title" size="h2">
            Cards and media
          </Heading>
          <Grid cols={3} className="mt-10">
            {serviceAreas.slice(0, 3).map((service) => (
              <CardLink
                key={service.slug}
                as="article"
                href={`/services/${service.slug}`}
                eyebrow={service.companyName}
                title={service.title}
                description={service.summary}
                cta="Learn more"
                media={
                  service.image ? <Media media={service.image} alt="" sizes="(min-width: 1024px) 340px, (min-width: 768px) 50vw, 100vw" aspect="4/3" /> : undefined
                }
              />
            ))}
          </Grid>
          <div className="mt-16 grid gap-10 md:grid-cols-2">
            <Figure media="songwe-landscape" alt="Fields and mountains in Songwe Region" sizes="(min-width: 768px) 50vw, 100vw" aspect="3/2" radius="card" caption={homeCorridor.title} />
            <Media
              media={mediaImage('songwe-landscape')}
              alt="Fields and mountains in Songwe Region"
              sizes="(min-width: 768px) 50vw, 100vw"
              aspect="3/2"
              radius="card"
              credit="overlay"
            />
          </div>
          <div className="mt-16">
            <Heading as="h3" size="h3">
              Icons
            </Heading>
            <ul className="mt-6 grid grid-cols-4 gap-6 sm:grid-cols-6 lg:grid-cols-10">
              {iconNames.map((name) => (
                <li key={name} className="flex flex-col items-center gap-2 text-caption text-fg-muted">
                  <Icon name={name} size="lg" className="text-fg" />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>

      <Section id="enquiry" tone="alt" labelledBy="enquiry-title">
        <Container>
          <Eyebrow>Islands</Eyebrow>
          <Heading as="h2" id="enquiry-title" className="mt-2">
            The enquiry form
          </Heading>
          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <EnquiryRouter headingLevel={3} tone="light" />
            <EnquiryRouter
              compact
              headingLevel={3}
              defaultIntentId="westsides"
              title={enquiryPrompts.service.title}
              description={enquiryPrompts.service.description}
            />
          </div>
        </Container>
      </Section>

      <Section id="corridor" labelledBy="corridor-title">
        <Container>
          <div className="mx-auto max-w-prose text-center">
            <Eyebrow>{homeCorridor.eyebrow}</Eyebrow>
            <Heading as="h2" id="corridor-title" size="display" className="mt-2">
              {homeCorridor.title}
            </Heading>
            <Lede tone="muted" className="mx-auto mt-6 max-w-[40rem]">
              {homeCorridor.body}
            </Lede>
          </div>
          <CorridorStory labelledBy="corridor-title" className="mt-16 md:mt-24" />
        </Container>
      </Section>

      <Section id="sites" tone="alt" labelledBy="sites-title">
        <Container>
          <Eyebrow>{homeCorridorMap.eyebrow}</Eyebrow>
          <Heading as="h2" id="sites-title" className="mt-2">
            {homeCorridorMap.title}
          </Heading>
          <Lede tone="muted" className="mt-5 max-w-[40rem]">
            {homeCorridorMap.body}
          </Lede>
          <CorridorMap labelledBy="sites-title" className="mt-12" />
        </Container>
      </Section>

      <Section id="print" labelledBy="print-title">
        <Container>
          <Heading as="h2" id="print-title" size="h3">
            Print picker
          </Heading>
          <PrintProfileButton
            className="mt-8"
            profiles={printProfileOptions}
            label={printButtonCopy.label}
            actionLabel={printButtonCopy.action}
            preparingLabel={printButtonCopy.preparing}
          />
        </Container>
      </Section>

      <Section tone="alt" labelledBy="prose-title">
        <Container size="measure">
          <Heading as="h2" id="prose-title" size="h2">
            {article.title}
          </Heading>
          <Prose className="mt-8">
            {article.sections.slice(0, 2).map((section) => (
              <Fragment key={section.heading}>
                <h3>{section.heading}</h3>
                <p>{section.body}</p>
                {section.points ? (
                  <ul>
                    {section.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                ) : null}
              </Fragment>
            ))}
          </Prose>
        </Container>
      </Section>

      <CtaBand
        titleId="closing-title"
        title={homeClosing.title}
        lede={homeClosing.body}
        tone="cinema"
        actions={
          <>
            <ButtonLink href={homeClosing.actions[0]!.href}>{homeClosing.actions[0]!.label}</ButtonLink>
            <ContactLink kind="whatsapp" appearance="chevron">
              WhatsApp
            </ContactLink>
            <ContactLink kind="tel" appearance="chevron">
              Call
            </ContactLink>
          </>
        }
      />
    </>
  );
}
