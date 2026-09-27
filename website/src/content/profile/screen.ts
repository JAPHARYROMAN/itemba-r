/**
 * Labels and art direction for the company profile's screen view (the print
 * documents' labels live in ./print).
 */
import 'server-only';
import { mediaImage } from '../media';

export const profileScreenCopy = {
  /**
   * The sticky sub-nav: the page name (the global nav's label, short enough
   * to sit beside Contents and the pill on a 360px phone), its landmark
   * name, and the pill to the enquiry form.
   */
  nav: {
    title: 'Profile',
    label: 'Company profile sections',
    enquire: 'Enquire',
  },
  /** The four ready-made PDFs and the live print picker, straight under the cover. */
  downloads: {
    title: 'Download or print the profile.',
    body: 'Ready-made PDF snapshots of the group profile and of each company’s legal profile, for banks, suppliers and partners.',
    action: 'Download PDF',
    printTitle: 'Print the live profile',
    printBody: 'The PDFs are snapshots. To print the current page instead, choose a profile: it prints on A4, with its photographs.',
  },
  /** "Division 1", "Division 2", … */
  divisionLabel: 'Division',
  operations: {
    /** The foot of each operating company's card (the card links to the company page). */
    companyAction: 'Explore',
    branchesTitle: 'Branches and sites',
  },
  management: {
    structureTitle: 'Group structure',
    /** The parent's role in the structure diagram (from the ownership summary). */
    parentRole: 'Central strategic oversight, governance and coordination',
  },
  attachments: {
    /** To the enquiry form on the page. */
    request: 'Request documents',
  },
  contact: {
    heading: 'Group Contact',
    headOffice: 'Head Office',
    postal: 'Postal',
    phone: 'Phone',
    email: 'Email',
  },
} as const;

/**
 * The screen view's photographs besides the cover, both in "Operations and
 * Branches", and neither a forecourt canopy: the ITEMBA-HARDWARE storefront
 * under the WESTSIDES COMPANY LIMITED signboard (a portrait, in a tall cell
 * beside the Westsides branches) and the truck line at UZUNGUNI PARKING
 * YARD (a wide frame above the parking entry).
 */
export const operationsVisuals = {
  westsides: mediaImage('hardware-storefront'),
  parking: mediaImage('parking-truck-line'),
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
