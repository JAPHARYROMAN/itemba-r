import { history } from '@/content/profile';
import { Heading, keepCompounds } from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

/** The year a milestone is filed under ("20 January 2012" → "2012"; "2017 onward" → "2017"). */
const yearOf = (date: string) => /\d{4}/.exec(date)?.[0] ?? date;

/**
 * §9, Company History: the milestones in order, from the first company in
 * 2012 to the 2025 reorganisation, on black, as hairline rows. Each row
 * files the milestone under its year, set large in gold (decorative where
 * the full date follows it as text), beside its title and account from
 * `md`.
 */
export function ProfileHistory() {
  return (
    <ReportSection id="company-history" tone="cinema">
      <ReportHeader id="company-history" />
      <ol role="list" className="mt-12 md:mt-16">
        {history.map((item) => {
          const year = yearOf(item.date);
          const exact = item.date !== year;
          return (
            <li
              key={`${item.date}-${item.title}`}
              className="relative grid gap-2 border-t border-line py-7 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10 md:py-9"
            >
              <div>
                <p aria-hidden={exact || undefined} className="text-h2 tabular-nums text-gold-fg">
                  {year}
                </p>
                {exact ? <p className="mt-1 text-caption text-fg-muted">{item.date}</p> : null}
              </div>
              <div className="max-w-[40rem]">
                <Heading as="h3" size="h5">
                  {item.title}
                </Heading>
                <p className="mt-2 text-body text-fg-muted">{keepCompounds(item.body)}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </ReportSection>
  );
}
