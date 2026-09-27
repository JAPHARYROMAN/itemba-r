import { profileProductsServices } from '@/content/profile';
import { Card, Chip, ChipList, Eyebrow, Heading, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

/**
 * §5, Products and Services: the six brands and product lines, each with
 * the company that runs it (its accent dot), what it offers in a sentence
 * and its products as chips, so a visitor finds the right line before
 * enquiring. Two across from `md`, three from `lg`; white on the grey tile.
 */
export function ProfileProducts() {
  return (
    <ReportSection id="products-services" tone="alt">
      <ReportHeader id="products-services" />
      <ul role="list" className="mt-10 grid gap-4 md:mt-14 md:grid-cols-2 lg:grid-cols-3">
        {profileProductsServices.map((service) => (
          <Card key={service.title} as="li" accent={service.companyId} className="flex flex-col">
            <Eyebrow dot tone="muted">
              {service.eyebrow}
            </Eyebrow>
            <Heading as="h3" size="h4" className="mt-3">
              {service.title}
            </Heading>
            <p className="mt-3 text-body text-fg-muted">{keepCompounds(service.summary)}</p>
            <ChipList className="mt-6 pt-1">
              {service.offerings.map((offering) => (
                <Chip key={offering} as="li">
                  <span>{keepCompounds(offering)}</span>
                </Chip>
              ))}
            </ChipList>
          </Card>
        ))}
      </ul>
    </ReportSection>
  );
}
