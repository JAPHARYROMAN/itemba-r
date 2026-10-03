import { printButtonCopy, printProfileOptions, profilePdfHref, profileScreenCopy } from '@/content/profile';
import type { AccentName } from '@/design/tokens';
import PrintProfileButton from '@/islands/PrintProfileButton';
import { Card, ChevronLink, Container, Heading, Icon, Lede, Section } from '@/ui';

type ProfileOption = (typeof printProfileOptions)[number];

/** The group's document in group gold; each company's in its own accent (the icon only). */
const accentOf = (id: ProfileOption['id']): AccentName => (id === 'group' ? 'group' : id);

/**
 * One ready-made PDF: its document icon, what it covers and the download
 * link (the `download` attribute, as on origin/main). Links stay group gold
 * on this page; a company shows only in its icon.
 */
function DownloadCard({ option }: { option: ProfileOption }) {
  return (
    <Card as="li" accent={accentOf(option.id)} padding="none" className="flex flex-col p-6 md:p-7">
      <Icon name="document" size="lg" strokeWidth={1.3} className="text-accent" />
      <Heading as="h3" size="h5" className="mt-5 md:mt-8">
        {option.label}
      </Heading>
      <p className="mt-2 text-caption text-fg-muted">{option.description}</p>
      <ChevronLink
        href={profilePdfHref(option.id)}
        download
        tone="gold"
        context={option.label}
        className="mt-auto self-start pt-6"
      >
        {profileScreenCopy.downloads.action}
      </ChevronLink>
    </Card>
  );
}

/**
 * The profile to take away, straight under the cover: the four committed
 * PDFs (the group profile, then each company's legal profile, in the print
 * picker's order) as cards, then the live print picker (PrintProfileButton)
 * beside a line on what it prints. On the alternate grey, so the cards and
 * the picker sit white.
 */
export function ProfileDownloads() {
  const copy = profileScreenCopy.downloads;
  return (
    <Section tone="alt" id="downloads" labelledBy="downloads-title">
      <Container>
        <div className="max-w-[40rem]">
          <Heading as="h2" id="downloads-title" size="h1">
            {copy.title}
          </Heading>
          <Lede tone="muted" className="mt-5">
            {copy.body}
          </Lede>
        </div>

        <ul role="list" className="mt-10 grid gap-4 sm:grid-cols-2 md:mt-14 lg:grid-cols-4">
          {printProfileOptions.map((option) => (
            <DownloadCard key={option.id} option={option} />
          ))}
        </ul>

        <div className="mt-12 grid items-center gap-6 md:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <Heading as="h3" size="h3">
              {copy.printTitle}
            </Heading>
            <p className="mt-3 max-w-lg text-body text-fg-muted">{copy.printBody}</p>
          </div>
          <PrintProfileButton
            profiles={printProfileOptions}
            label={printButtonCopy.label}
            actionLabel={printButtonCopy.action}
            preparingLabel={printButtonCopy.preparing}
            className="lg:max-w-none"
          />
        </div>
      </Container>
    </Section>
  );
}
