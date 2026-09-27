import { capabilitiesPage, verificationSignals, type VerificationSignal, type VerificationSignalId } from '@/content/capabilities';
import { companies } from '@/content/companies';
import { contact } from '@/content/contact';
import { companyUrl } from '@/content/site';
import {
  Bento,
  BentoCell,
  ChevronLink,
  Container,
  Eyebrow,
  Heading,
  Icon,
  Media,
  Reveal,
  Section,
  SmartLink,
  keepCompounds,
  type IconName,
} from '@/ui';
import { capabilitiesSectionIds as ids } from './ids';

const { signals } = capabilitiesPage;

const icons: Record<Exclude<VerificationSignalId, 'structure'>, IconName> = {
  ownership: 'arrow-right',
  base: 'map-pin',
  contact: 'phone',
};

const signalById = (id: VerificationSignalId): VerificationSignal => {
  const signal = verificationSignals.find((item) => item.id === id);
  if (!signal) throw new Error(`Missing verification signal: ${id}`);
  return signal;
};

/**
 * The group-structure cell's mark, in place of a line icon: the three
 * companies' accent dots in a row, the size of an icon.
 */
function CompaniesMark() {
  return (
    <span aria-hidden="true" className="flex h-8 items-center gap-1.5">
      {companies.map((company) => (
        <span key={company.slug} data-accent={company.accent} className="size-2.5 rounded-full bg-accent" />
      ))}
    </span>
  );
}

/** A signal's mark, title and summary: the head of every cell. */
function SignalHead({ signal }: { signal: VerificationSignal }) {
  return (
    <>
      {signal.id === 'structure' ? <CompaniesMark /> : <Icon name={icons[signal.id]} size="lg" strokeWidth={1.4} className="text-accent" />}
      <Heading as="h3" size="h4" className="mt-8">
        {signal.title}
      </Heading>
      <p className="mt-2 text-body text-fg-muted">{keepCompounds(signal.summary)}</p>
    </>
  );
}

/**
 * "What a visitor can confirm quickly": the four verification signals as a
 * bento on the alternate grey, each with its evidence.
 *   group structure (2/3, the three companies)  · service ownership (1/3)
 *   contact accountability (1/3, black)         · local base (2/3, photograph)
 * The group-structure cell lists the three companies with their accent dots
 * and sectors, each a link to its page; service ownership jumps to the
 * capability map below; contact accountability leads to how an enquiry
 * moves; the local-base cell carries the page's one photograph
 * (UZUNGUNI PARKING YARD in Mpemba-Tunduma, beside the head-office address).
 * From `md` to `lg` the two wide cells run full width and the two small ones
 * pair up.
 */
export function CapabilitiesSignals() {
  const structure = signalById('structure');
  const ownership = signalById('ownership');
  const base = signalById('base');
  const accountable = signalById('contact');
  return (
    <Section tone="alt" id={ids.signals} labelledBy="signals-title">
      <Container>
        <div className="mx-auto max-w-prose text-center">
          <Eyebrow>{signals.eyebrow}</Eyebrow>
          <Heading as="h2" id="signals-title" size="h1" className="mt-2">
            {signals.title}
          </Heading>
        </div>

        <Bento className="mt-10 md:mt-16">
          <BentoCell span="two-thirds" padding="lg">
            <SignalHead signal={structure} />
            <p className="mt-8 text-eyebrow text-fg-muted">{signals.companiesLabel}</p>
            <ul role="list" className="mt-2 border-t border-line">
              {companies.map((company) => (
                <li
                  key={company.slug}
                  data-accent={company.accent}
                  className="flex flex-col gap-0.5 border-b border-line py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                    <SmartLink
                      href={companyUrl(company.slug)}
                      className="text-body font-semibold text-fg decoration-1 underline-offset-4 hover:underline"
                    >
                      {company.shortName}
                    </SmartLink>
                  </span>
                  <span className="pl-[1.125rem] text-caption text-fg-muted sm:pl-0 sm:text-right">{company.sector}</span>
                </li>
              ))}
            </ul>
          </BentoCell>

          <BentoCell span="third">
            <SignalHead signal={ownership} />
            <ChevronLink href={`#${ids.map}`} className="mt-auto pt-6">
              {signals.ownershipAction}
            </ChevronLink>
          </BentoCell>

          <BentoCell span="third" tone="cinema">
            <SignalHead signal={accountable} />
            <ChevronLink href={signals.contactAction.href} className="mt-auto pt-6">
              {signals.contactAction.label}
            </ChevronLink>
          </BentoCell>

          <BentoCell span="two-thirds" padding="none" className="md:flex-row">
            <div className="flex flex-1 flex-col p-7 md:p-8">
              <SignalHead signal={base} />
              <p className="mt-auto pt-6 text-caption text-fg-muted">
                <span className="block font-semibold text-fg">{signals.headOfficeLabel}</span>
                {keepCompounds(contact.headOfficeLines.join(', '))}
              </p>
            </div>
            <Reveal className="relative order-first aspect-[2/1] md:order-none md:aspect-auto md:w-1/2 md:shrink-0">
              {/*
               * From `md` the frame is half the cell and as tall as the text
               * beside it (about 1.2:1), so the 2:1 photograph is drawn at the
               * frame's height, about 680px wide (object-fit: cover).
               */}
              <Media media={signals.image} alt={signals.image.alt} fill sizes="(min-width: 768px) 680px, calc(100vw - 44px)" />
            </Reveal>
          </BentoCell>
        </Bento>
      </Container>
    </Section>
  );
}
