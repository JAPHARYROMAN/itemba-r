/**
 * Small labels used by the company profile's screen view (the print
 * documents' labels live in ./print).
 */
import 'server-only';

export const profileScreenCopy = {
  /** "Division 1", "Division 2", … */
  divisionLabel: 'Division',
  contact: {
    heading: 'Group Contact',
    headOffice: 'Head Office',
    postal: 'Postal',
    phone: 'Phone',
    email: 'Email',
  },
} as const;

/**
 * The profile's contents sheet (src/islands/ProfileNav.tsx), opened from the
 * page's sub-nav. The island is a client component and cannot read this
 * server-only module, so the page passes these labels in.
 */
export const profileNavCopy = {
  /** The sub-nav button that opens the sheet (and the prefix of its name on wide screens). */
  trigger: 'Contents',
  /** The sheet's heading. */
  title: 'In this profile',
  /** The sheet's close button. */
  close: 'Close contents',
} as const;
