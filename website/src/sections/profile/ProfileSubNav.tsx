import { outline, profileNavCopy, profileScreenCopy } from '@/content/profile';
import ProfileNav from '@/islands/ProfileNav';
import { SubNav } from '@/ui';

/** The form every Enquire action on the page lands on (inside "Contact Information"). */
export const ENQUIRE_ID = 'enquire';

/**
 * The profile's sticky local bar, as on an Apple product page: the page
 * name, then the contents (the ProfileNav island: "Contents" on phones, the
 * current section from `md`, kept current by a scrollspy over the 17
 * outline sections; it opens a sheet listing all of them) and the Enquire
 * pill, which jumps to the enquiry form on the page. Seventeen anchors do
 * not fit a bar, so the sheet carries them rather than the bar.
 */
export function ProfileSubNav() {
  const { nav } = profileScreenCopy;
  return (
    <SubNav title={nav.title} shortTitle={nav.shortTitle} label={nav.label} cta={{ href: `#${ENQUIRE_ID}`, label: nav.enquire }}>
      <ProfileNav outline={outline} labels={profileNavCopy} />
    </SubNav>
  );
}
