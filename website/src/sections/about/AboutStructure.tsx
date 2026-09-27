import { aboutPage, type StructureCompany } from '@/content/about';
import { companyUrl } from '@/content/site';
import { Container, Eyebrow, Heading, Lede, Section, SmartLink, cn, keepCompounds } from '@/ui';

/**
 * The group structure as a three-tier diagram: the parent on black, the
 * three companies as white cards (each links to its page), and their
 * brands and businesses as outlined panels. The tiers are real nested lists
 * (the accessible content); the connectors are inline SVG hairlines,
 * aria-hidden, drawn per column so they meet exactly at any width: group
 * gold from the parent, each company's accent down to its brands.
 *
 * - From `md`: a tree. A stem drops from the parent to a bus that spans the
 *   three columns; each column draws its own share of the bus (the first
 *   from its centre rightwards, the last up to its centre) and a drop to
 *   its company.
 * - Phones: a rail. The companies stack beside a gold rail from the
 *   parent, each joined to it by a tick.
 *
 * Server markup with no motion; no ASCII tree, no emoji.
 */

type Position = 'first' | 'middle' | 'last';

/** Stroke classes for the connectors (decorative graphic colours: no contrast minimum). */
const goldStroke = 'stroke-gold';
const accentStroke = 'stroke-accent';

/** The phone rail's x, and the y at which a company's tick meets it (px). */
const RAIL_X = 20;
const TICK_Y = 48;

function Connectors({ position }: { position: Position }) {
  return (
    <>
      {/* md+: this column's share of the bus, and the drop to the company. */}
      <svg aria-hidden="true" focusable="false" className="absolute inset-x-0 top-0 hidden h-8 w-full overflow-visible md:block">
        <line
          x1={position === 'first' ? '50%' : '0'}
          x2={position === 'last' ? '50%' : '100%'}
          y1="0.75"
          y2="0.75"
          className={goldStroke}
          strokeWidth={1.5}
        />
        <line x1="50%" x2="50%" y1="0" y2="100%" className={goldStroke} strokeWidth={1.5} />
      </svg>
      {/* Phones: the rail beside the stacked companies, and this company's tick. */}
      <svg aria-hidden="true" focusable="false" className="absolute inset-y-0 left-0 h-full w-9 overflow-visible md:hidden">
        <line
          x1={RAIL_X}
          x2={RAIL_X}
          y1="0"
          y2={position === 'last' ? TICK_Y : '100%'}
          className={goldStroke}
          strokeWidth={1.5}
        />
        <line x1={RAIL_X} x2="36" y1={TICK_Y} y2={TICK_Y} className={goldStroke} strokeWidth={1.5} />
      </svg>
    </>
  );
}

/** A short vertical hairline between two tiers, centred. */
function Drop({ className, stroke }: { className?: string; stroke: string }) {
  return (
    <svg aria-hidden="true" focusable="false" width="2" className={cn('mx-auto block h-6 overflow-visible md:h-8', className)}>
      <line x1="1" x2="1" y1="0" y2="100%" className={stroke} strokeWidth={1.5} />
    </svg>
  );
}

const stretchedLink =
  'after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus';

function CompanyBranch({ company, position, flagshipLabel }: { company: StructureCompany; position: Position; flagshipLabel: string }) {
  return (
    <li data-accent={company.companyId} className="relative pl-9 pt-4 md:flex md:flex-col md:px-2 md:pt-8 lg:px-3">
      <Connectors position={position} />
      <div className="group relative rounded-card bg-surface-alt p-5 transition-shadow duration-base ease-apple hover:shadow-card md:p-6">
        <p className="flex items-center gap-2 text-caption text-fg-muted">
          <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full bg-accent" />
          {keepCompounds(company.focus)}
        </p>
        <p className="mt-2 text-body-lg font-semibold text-fg">
          <SmartLink href={companyUrl(company.companySlug)} className={stretchedLink}>
            {company.name}
          </SmartLink>
        </p>
      </div>
      <Drop stroke={accentStroke} />
      <ul role="list" className="rounded-card border border-line-strong/40 md:flex-1">
        {company.units.map((unit) => (
          <li key={unit.name} className="border-t border-line px-5 py-3.5 first:border-t-0 md:px-6">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-semibold text-fg">
              {keepCompounds(unit.name)}
              {unit.flagship ? (
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-line px-2.5 text-caption font-normal text-fg-muted">
                  <span aria-hidden="true" className="inline-block size-1.5 shrink-0 rounded-full bg-accent" />
                  {flagshipLabel}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-caption text-fg-muted">{keepCompounds(unit.focus)}</p>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function AboutStructure() {
  const { organisation } = aboutPage;
  const { structure } = organisation;
  const last = structure.companies.length - 1;
  return (
    <Section tone="alt" labelledBy="structure-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{organisation.eyebrow}</Eyebrow>
          <Heading as="h2" id="structure-title" size="h1" className="mt-2">
            {organisation.title}
          </Heading>
          <Lede tone="muted" className="mx-auto mt-5 max-w-[40rem] md:mt-6">
            {organisation.lede}
          </Lede>
        </div>

        <ul role="list" aria-labelledby="structure-title" className="mt-12 md:mt-16">
          <li>
            <div data-tone="cinema" className="rounded-card bg-surface px-6 py-5 text-center md:mx-auto md:max-w-xs">
              <p className="text-h3 text-fg">{structure.root.name}</p>
              <p className="mt-1 text-caption text-fg-muted">{structure.root.note}</p>
            </div>
            <Drop stroke={goldStroke} className="hidden md:block" />
            <ul role="list" className="md:-mx-2 md:grid md:grid-cols-3 lg:-mx-3">
              {structure.companies.map((company, index) => (
                <CompanyBranch
                  key={company.companyId}
                  company={company}
                  position={index === 0 ? 'first' : index === last ? 'last' : 'middle'}
                  flagshipLabel={structure.flagshipLabel}
                />
              ))}
            </ul>
          </li>
        </ul>

        <ol role="list" className="mt-14 grid gap-x-8 gap-y-6 md:mt-20 md:grid-cols-3">
          {organisation.tiers.map((tier) => (
            <li key={tier.level} className="border-t border-line pt-5">
              <p className="text-eyebrow text-gold-fg">{tier.level}</p>
              <Heading as="h3" size="h5" className="mt-1">
                {tier.title}
              </Heading>
              <p className="mt-1.5 text-body text-fg-muted">{tier.summary}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
