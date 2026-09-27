import { flags } from '@/content/flags';
import {
  leadershipHeading,
  leadershipTeam,
  legalCompanyProfiles,
  legalLabels,
  ownershipSummary,
  profileCompanyOperations,
  profileScreenCopy,
} from '@/content/profile';
import { site } from '@/content/site';
import { Card, Heading, keepCompounds } from '@/ui';
import { ReportHeader, ReportList, ReportSection } from './ReportSection';

/**
 * The group structure as a two-tier diagram: the parent (an ink node) over
 * its three operating companies (each with its accent dot and sector),
 * joined by hairline connectors. The markup is the structure itself (the
 * parent, then a list of its companies); the connectors are decoration. On
 * phones the companies hang off one vertical rule, from `sm` they sit three
 * across under a horizontal one.
 */
function GroupStructure() {
  const { structureTitle, parentRole } = profileScreenCopy.management;
  return (
    <div>
      <Heading as="h3" size="h5">
        {structureTitle}
      </Heading>
      <div className="mt-5">
        <div data-tone="cinema" className="rounded-card bg-surface px-6 py-5 sm:text-center">
          <p className="text-body-lg font-semibold text-fg">{site.name}</p>
          <p className="mt-1 text-caption text-fg-muted">{parentRole}</p>
        </div>
        <div aria-hidden="true" className="ml-6 h-5 w-px bg-line-strong sm:mx-auto sm:h-6" />
        <ul
          role="list"
          className="relative ml-6 space-y-3 border-l border-line-strong py-2 pl-5 sm:ml-0 sm:grid sm:grid-cols-3 sm:gap-3 sm:space-y-0 sm:border-l-0 sm:py-0 sm:pl-0 sm:pt-6 sm:before:absolute sm:before:inset-x-[16.67%] sm:before:top-0 sm:before:h-px sm:before:bg-line-strong"
        >
          {profileCompanyOperations.map((company) => (
            <li
              key={company.slug}
              data-accent={company.companyId}
              className="relative rounded-card bg-surface-alt p-4 before:absolute before:-left-5 before:top-1/2 before:h-px before:w-5 before:bg-line-strong sm:before:-top-6 sm:before:left-1/2 sm:before:h-6 sm:before:w-px"
            >
              <p className="flex items-center gap-2 text-body font-semibold text-fg">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                {company.name}
              </p>
              <p className="mt-1 text-caption text-fg-muted">{keepCompounds(company.sector)}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * §8, Management and Ownership: how the group is owned and run (the
 * ownership summary beside the group structure), the leadership team as
 * typographic cards (no portraits), and each company's statutory
 * identifiers: TIN, incorporation and directors, as in the PDFs
 * (flags.publishLegalIdentifiers).
 */
export function ProfileManagement() {
  return (
    <ReportSection id="management-ownership">
      <ReportHeader id="management-ownership" />

      <div className="mt-10 grid items-start gap-12 md:mt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <ReportList items={ownershipSummary} />
        <GroupStructure />
      </div>

      <Heading as="h3" size="h3" className="mt-16 md:mt-20">
        {keepCompounds(leadershipHeading)}
      </Heading>
      <ul role="list" className="mt-6 grid gap-4 md:mt-8 md:grid-cols-2 lg:grid-cols-3">
        {leadershipTeam.map((leader) => (
          <Card key={leader.name} as="li" className="flex flex-col">
            <h4 className="text-body-lg font-semibold text-fg">{leader.name}</h4>
            <p className="mt-2 text-body text-fg">{keepCompounds(leader.groupRole)}</p>
            <p className="mt-1 text-caption text-fg-muted">{keepCompounds(leader.companyRole)}</p>
          </Card>
        ))}
      </ul>

      {flags.publishLegalIdentifiers ? (
        <>
          <Heading as="h3" size="h3" className="mt-16 md:mt-20">
            {legalLabels.heading}
          </Heading>
          <ul role="list" className="mt-6 grid gap-4 md:mt-8 lg:grid-cols-3">
            {legalCompanyProfiles.map((company) => (
              <Card key={company.id} as="li" accent={company.id}>
                <h4 className="flex items-center gap-2 text-body-lg font-semibold text-fg">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
                  {company.name}
                </h4>
                <dl className="mt-5 border-t border-line">
                  <div className="border-b border-line py-3">
                    <dt className="text-caption text-fg-muted">{legalLabels.tin}</dt>
                    <dd className="mt-0.5 text-body text-fg">{company.tin}</dd>
                  </div>
                  <div className="border-b border-line py-3">
                    <dt className="text-caption text-fg-muted">{legalLabels.incorporation}</dt>
                    <dd className="mt-0.5 text-body text-fg">
                      {company.incorporationDate}; {legalLabels.numberPrefix} {company.incorporationNumber}
                    </dd>
                  </div>
                  <div className="py-3">
                    <dt className="text-caption text-fg-muted">{legalLabels.directors}</dt>
                    <dd className="mt-0.5 text-body text-fg">
                      {company.directors.map((director) => (
                        <span key={director} className="block">
                          {director}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </Card>
            ))}
          </ul>
        </>
      ) : null}
    </ReportSection>
  );
}
