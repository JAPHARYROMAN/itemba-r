import { history } from '@/content/profile';
import { Heading, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

/**
 * §9, Company History: the current operating story, on black as hairline
 * rows. Dates stay out until incorporation and opening records are verified.
 */
export function ProfileHistory() {
  return (
    <ReportSection id="company-history" tone="cinema">
      <ReportHeader id="company-history" />
      <ol role="list" className="mt-12 md:mt-16">
        {history.map((item) => (
          <li
            key={`${item.date}-${item.title}`}
            className="relative grid gap-2 border-t border-line py-7 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10 md:py-9"
          >
            <div>
              <p className="text-h3 text-gold-fg">{item.date}</p>
            </div>
            <div className="max-w-[40rem]">
              <Heading as="h3" size="h5">
                {item.title}
              </Heading>
              <p className="mt-2 text-body text-fg-muted">{keepCompounds(item.body)}</p>
            </div>
          </li>
        ))}
      </ol>
    </ReportSection>
  );
}
