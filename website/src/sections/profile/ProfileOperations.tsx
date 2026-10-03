import { branchOperations, operationsNote, operationsVisuals, profileCompanyOperations, profileScreenCopy } from '@/content/profile';
import { companyUrl } from '@/content/site';
import {
  Bento,
  BentoCell,
  Chevron,
  Heading,
  Media,
  Reveal,
  SmartLink,
  keepCompounds,
} from '@/ui';
import { ReportHeader, ReportSection } from './ReportSection';

type BranchGroup = (typeof branchOperations)[number];

/** A stretched title link: the whole card is one target named by the company. */
const stretchedLink =
  'after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus';

/**
 * An operating company as one link to its page: its name beside the
 * accent dot, its sector, and what it runs. "Explore ›" is decorative
 * (the link's name is the company's name) and group gold.
 */
function CompanyCard({ company }: { company: (typeof profileCompanyOperations)[number] }) {
  return (
    <li
      data-accent={company.companyId}
      className="group relative flex flex-col rounded-card bg-surface-alt p-6 transition-shadow duration-base ease-apple hover:shadow-card md:p-7"
    >
      <Heading as="h3" size="h4" className="flex items-baseline gap-2.5">
        <span aria-hidden="true" className="size-2 shrink-0 -translate-y-0.5 rounded-full bg-accent" />
        <SmartLink href={companyUrl(company.slug)} className={stretchedLink}>
          {company.name}
        </SmartLink>
      </Heading>
      <p className="mt-1 text-caption font-semibold text-fg-muted">{keepCompounds(company.sector)}</p>
      <p className="mt-4 text-body text-fg-muted">{keepCompounds(company.detail)}</p>
      <span aria-hidden="true" className="mt-auto inline-flex items-center gap-[0.3em] pt-6 text-body text-gold-fg">
        {profileScreenCopy.operations.companyAction}
        <Chevron />
      </span>
    </li>
  );
}

/** A company's branches or sites: its summary, then one hairline row per site. */
function BranchSchedule({ group }: { group: BranchGroup }) {
  return (
    <>
      <Heading as="h4" size="h4" className="flex items-baseline gap-2.5">
        <span aria-hidden="true" className="size-2 shrink-0 -translate-y-0.5 rounded-full bg-accent" />
        <span>{group.company}</span>
      </Heading>
      <p className="mt-3 text-body text-fg-muted">{keepCompounds(group.summary)}</p>
      <ul role="list" className="mt-6 border-t border-line">
        {group.branches.map((branch) => (
          <li key={branch.name} className="border-b border-line py-4">
            <p className="text-body font-semibold text-fg">{keepCompounds(branch.name)}</p>
            <p className="mt-1 text-body text-fg">{keepCompounds(branch.focus)}</p>
            <p className="mt-0.5 text-caption text-fg-muted">{keepCompounds(branch.coverage)}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * §7, Operations and Branches: the three operating companies as links to
 * their pages, then the branch and site schedule as a bento: Westsides'
 * four branches beside the ITEMBA-HARDWARE storefront under its WESTSIDES
 * signboard (a portrait, in a tall cell); the ITEMBA stations; and
 * UZUNGUNI PARKING YARD under its truck line. The chapter's two photographs
 * are the page's only ones besides the cover, and neither is a canopy.
 */
export function ProfileOperations() {
  const [westsides, stations, parking] = branchOperations;
  const { westsides: storefront, parking: truckLine } = operationsVisuals;
  return (
    <ReportSection id="operations-branches" tone="alt">
      <ReportHeader id="operations-branches" />

      <ul role="list" className="mt-10 grid gap-4 md:mt-14 lg:grid-cols-3">
        {profileCompanyOperations.map((company) => (
          <CompanyCard key={company.slug} company={company} />
        ))}
      </ul>

      <Heading as="h3" size="h3" className="mt-16 md:mt-20">
        {profileScreenCopy.operations.branchesTitle}
      </Heading>
      <Bento className="mt-6 md:mt-8">
        {westsides ? (
          <BentoCell span="two-thirds" accent={westsides.companyId} padding="lg">
            <BranchSchedule group={westsides} />
          </BentoCell>
        ) : null}
        {/* From `lg` only, beside the branches it stands for: a tall third (about 1:2) crops the portrait to its middle, so it renders about 1.5 cells wide. */}
        <BentoCell span="third" padding="none" className="max-lg:hidden">
          <Reveal className="absolute inset-0">
            <Media media={storefront} alt={storefront.alt} fill sizes="560px" />
          </Reveal>
        </BentoCell>
        {stations ? (
          <BentoCell span="half" accent={stations.companyId} padding="lg">
            <BranchSchedule group={stations} />
          </BentoCell>
        ) : null}
        {parking ? (
          <BentoCell span="half" accent={parking.companyId} padding="none">
            <Reveal>
              <Media
                media={truckLine}
                alt={truckLine.alt}
                aspect="2/1"
                sizes="(min-width: 1112px) 526px, (min-width: 768px) calc(50vw - 30px), calc(100vw - 44px)"
              />
            </Reveal>
            <div className="p-8 md:p-10 lg:p-12">
              <BranchSchedule group={parking} />
            </div>
          </BentoCell>
        ) : null}
      </Bento>

      <p className="mt-8 max-w-[46rem] text-caption text-fg-muted">{keepCompounds(operationsNote)}</p>
    </ReportSection>
  );
}
