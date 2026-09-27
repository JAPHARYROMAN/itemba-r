import type { Company } from '@/content/companies';
import { servicePageCopy, type ServiceArea } from '@/content/services';
import { serviceUrl } from '@/content/site';
import { Bento, BentoCell, ChevronLink, Container, Eyebrow, Heading, Icon, Section, Stat, cn, keepCompounds } from '@/ui';
import { serviceSectionIds } from './ServiceSubNav';

/**
 * "What it covers", as a bento on the company template's "What we do":
 * - the service in one sentence, then who it serves as hairline rows;
 * - beside it, its confirmed headline figure (the numeral centred in the
 *   space under its label). A service with no confirmed figure runs the
 *   first cell full width, its rows in two columns: no invented number,
 *   and no weak photograph standing in for one;
 * - then three cells that together cover everything the service offers,
 *   each under its line icon, one linking on where another service page
 *   covers it in full.
 * The cells sit white on the alternate grey.
 */
export function ServiceOfferings({ service, company }: { service: ServiceArea; company: Company }) {
  const copy = servicePageCopy;
  const stat = service.keyStat;
  return (
    <Section tone="alt" accent={company.accent} id={serviceSectionIds.offerings} labelledBy="offerings-title">
      <Container>
        <Heading as="h2" id="offerings-title" size="h1">
          {copy.offeringsHeading}
        </Heading>

        <Bento className="mt-10 md:mt-14">
          <BentoCell span={stat ? 'two-thirds' : 'full'} padding="lg">
            <Eyebrow dot>{copy.nav.offerings}</Eyebrow>
            <p className="mt-5 max-w-[40rem] text-body-lg text-fg md:text-lede">{keepCompounds(service.overview)}</p>
            <h3 className="mt-8 text-eyebrow text-fg-muted">{copy.audienceLabel}</h3>
            <ul role="list" className={cn('mt-2 border-t border-line', !stat && 'md:grid md:grid-cols-2 md:gap-x-10')}>
              {service.audience.map((audience) => (
                <li key={audience} className="border-b border-line py-3 text-body text-fg">
                  {keepCompounds(audience)}
                </li>
              ))}
            </ul>
          </BentoCell>

          {stat ? (
            <BentoCell span="third" padding="lg">
              <Eyebrow>{copy.keyFigure}</Eyebrow>
              <dl className="my-auto pt-8">
                <Stat value={stat.value} label={stat.label} size="display-xl" tone="accent" />
              </dl>
            </BentoCell>
          ) : null}

          {service.features.map((feature, index) => (
            <BentoCell
              key={feature.title}
              span="third"
              // From `md` to `lg` the cells pair up; with no figure beside the
              // first cell, the last feature takes the whole row rather than half.
              className={cn(!stat && index === service.features.length - 1 && service.features.length % 2 === 1 && 'md:max-lg:col-span-6')}
            >
              <Icon name={feature.icon} size="lg" strokeWidth={1.4} className="text-accent" />
              <Heading as="h3" size="h4" className="mt-8">
                {feature.title}
              </Heading>
              <p className="mt-2 text-body text-fg-muted">{keepCompounds(feature.body)}</p>
              {feature.serviceSlug ? (
                <ChevronLink href={serviceUrl(feature.serviceSlug)} context={feature.title} className="mt-auto pt-6">
                  {copy.featureAction}
                </ChevronLink>
              ) : null}
            </BentoCell>
          ))}
        </Bento>
      </Container>
    </Section>
  );
}
