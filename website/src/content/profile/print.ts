/**
 * The four print documents behind /company-profile (group, Westsides,
 * Mwanjalisi Oil, Itemba Enterprises): what Print and the committed PDFs
 * contain. Rendered by src/print/ProfileDocuments.tsx; the ids are the
 * data-profile values scripts/generate-profile-pdfs.mjs selects.
 */
import 'server-only';
import { contact } from '../contact';
import { flags } from '../flags';
import { mediaFigure, mediaImage, type MediaFigure, type MediaImage } from '../media';
import { site } from '../site';
import type { CompanyId } from '../types';
import { businessActivities } from './activities';
import { assetCapacity } from './assets';
import { attachments } from './attachments';
import { bankingPurposes } from './banking';
import { branchOperations } from './branches';
import { complianceItems } from './compliance';
import { companyFinancialStatement, groupFinancialStatement } from './financial';
import { futurePlans } from './futurePlans';
import { history } from './history';
import { legalCompanyProfiles } from './legal';
import { targetMarketGroups } from './markets';
import { strengths } from './strengths';
import { visionMission } from './vision';

export type PrintProfileId = 'group' | CompanyId;

export type PrintSectionColumn = {
  title: string;
  body?: string;
  points?: readonly string[];
};

export type PrintSection = {
  title: string;
  body?: string;
  points?: readonly string[];
  columns?: readonly PrintSectionColumn[];
  pageBreakBefore?: boolean;
};

export type PrintProfile = {
  id: PrintProfileId;
  title: string;
  subject: string;
  subtitle: string;
  coverImage: MediaImage;
  facts: readonly { label: string; value: string }[];
  /** Company documents list their directors; the group document has a legal-companies table instead. */
  directors?: readonly string[];
  images: readonly MediaFigure[];
  sections: readonly PrintSection[];
};

/** The profiles a visitor can print or download, in selector order. */
export const printProfileOptions = [
  {
    id: 'group',
    label: 'Itemba Group Profile',
    description: 'Full group profile for banks, suppliers, customers, partners, and broad institutional review.',
  },
  {
    id: 'westsides',
    label: 'Westsides Company Ltd',
    description: 'Legal company profile for beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
  },
  {
    id: 'mwanjalisi',
    label: 'Mwanjalisi Oil Company Ltd',
    description: 'Legal company profile for ITEMBA fuel stations, lubricants, and UZUNGUNI PARKING YARD.',
  },
  {
    id: 'enterprises',
    label: 'Itemba Enterprises Co Ltd',
    description: 'Legal company profile for logistics, cross-border transit, and emerging businesses.',
  },
] as const;

/**
 * The print picker's labels (src/islands/PrintProfileButton.tsx). The island
 * keeps these as its defaults, so the page may pass them or omit them.
 */
export const printButtonCopy = {
  label: 'Select profile to print',
  action: 'Print selected profile',
  /** Shown on the button while the chosen profile's photos load (4 s at most). */
  preparing: 'Preparing profile…',
} as const;

export const groupPrintProfile: PrintProfile = {
  id: 'group',
  title: 'Itemba Group Company Profile',
  subject: 'Itemba Group',
  subtitle:
    'A Tanzanian multi-sector group headquartered in Mpemba-Tunduma, Songwe Region, operating through legally independent companies.',
  coverImage: mediaImage('profile-cover', {
    alt: 'Itemba Group operating profile cover image',
  }),
  facts: [
    { label: 'Profile Type', value: 'Group profile and capability statement' },
    { label: 'Head Office', value: contact.headOffice },
    { label: 'Operating Companies', value: 'Mwanjalisi Oil Company Ltd, Westsides Company Ltd, Itemba Enterprises Co Ltd' },
    { label: 'Website', value: site.domain },
    { label: 'Public Contact', value: `${contact.primaryPhoneDisplay} / ${contact.email}` },
  ],
  images: [
    mediaFigure('mpemba-station-wide', {
      alt: 'ITEMBA fuel station forecourt',
      caption: 'Fuel retail operations under Mwanjalisi Oil Company Ltd.',
    }),
    mediaFigure('westsides-warehouse-stock', {
      alt: 'Westsides beverage warehouse stock',
      caption: 'Wholesale beverage distribution under Westsides Company Ltd.',
    }),
    mediaFigure('logistics-tanker', {
      alt: 'Itemba Logistics tanker',
      caption: 'Logistics and cross-border transit under Itemba Enterprises Co Ltd.',
    }),
    mediaFigure('parking-container-trucks', {
      alt: 'Container trucks at UZUNGUNI PARKING YARD',
      caption: 'Parking and staging facilities under Mwanjalisi Oil Company Ltd.',
    }),
  ],
  sections: [
    {
      title: 'Company Overview',
      body:
        'Itemba Group operates as a shared business identity and governance platform for legally independent Tanzanian companies active in fuel, parking, trade, logistics, construction supply, hospitality, real estate-related services, and emerging businesses.',
    },
    {
      title: 'Vision and Mission',
      columns: visionMission.map((item) => ({ title: item.title, body: item.body })),
    },
    {
      title: 'Business Activities',
      columns: businessActivities.map((activity) => ({
        title: `${activity.company}: ${activity.title}`,
        body: activity.summary,
      })),
    },
    {
      title: 'Target Market',
      pageBreakBefore: true,
      columns: targetMarketGroups.map(({ title, points }) => ({ title, points })),
    },
    {
      title: 'Operations and Branches',
      pageBreakBefore: true,
      columns: branchOperations.map((operation) => ({
        title: operation.company,
        points: operation.branches.map((branch) => `${branch.name}: ${branch.focus} ${branch.coverage}`),
      })),
    },
    {
      title: 'Company History',
      pageBreakBefore: true,
      points: history.map((item) => `${item.date} - ${item.title}: ${item.body}`),
    },
    {
      title: 'Assets and Capacity',
      points: assetCapacity.map((item) => `${item.title}: ${item.body}`),
    },
    {
      title: 'Financial Overview',
      body: groupFinancialStatement,
    },
    {
      title: 'Compliance Information',
      points: complianceItems,
    },
    {
      title: 'Competitive Strengths',
      pageBreakBefore: true,
      points: strengths,
    },
    {
      title: 'Future Plans',
      points: futurePlans,
    },
    {
      title: 'Purpose of Banking Relationship',
      points: bankingPurposes,
    },
    {
      title: 'Attachments Available on Request',
      points: attachments,
    },
  ],
};

export const companyPrintProfiles: PrintProfile[] = legalCompanyProfiles.map((company) => ({
  id: company.id,
  title: company.profileTitle,
  subject: company.name,
  subtitle: `${company.sector}. ${company.summary}`,
  coverImage: company.coverImage,
  facts: [
    { label: 'Legal Name', value: company.name },
    // The statutory identifiers print only while the owner allows them (flags.publishLegalIdentifiers).
    ...(flags.publishLegalIdentifiers
      ? [
          { label: 'TIN', value: company.tin },
          { label: 'Incorporated', value: company.incorporationDate },
          { label: 'Incorporation No.', value: company.incorporationNumber },
        ]
      : []),
    { label: 'Legal Status', value: company.status },
    { label: 'Website', value: site.domain },
    { label: 'Head Office Contact', value: contact.headOffice },
  ],
  directors: company.directors,
  images: company.images,
  sections: [
    {
      title: 'Company Overview',
      body: company.summary,
    },
    ...company.sections,
    {
      title: 'Financial Overview',
      body: companyFinancialStatement,
    },
    {
      title: 'Compliance Information',
      points: [
        `${company.name} maintains company-level statutory, tax, licensing, and business records.`,
        ...(flags.publishLegalIdentifiers ? [`TIN: ${company.tin}. Incorporation number: ${company.incorporationNumber}.`] : []),
        'Supporting compliance documents can be provided directly to authorized counterparties when required.',
      ],
    },
    {
      title: 'Purpose of Banking Relationship',
      points: bankingPurposes,
    },
    {
      title: 'Attachments Available on Request',
      points: attachments,
    },
  ],
}));

export const printableProfiles: readonly PrintProfile[] = [groupPrintProfile, ...companyPrintProfiles];

/** Fixed labels of the print documents (letterhead, cover, fact and legal blocks). */
export const printCopy = {
  logoAlt: 'Itemba Group logo',
  /** Tag under the logo mark. */
  established: `EST. ${site.established}`,
  letterheadTitle: 'ITEMBA GROUP',
  letterheadSubtitle: 'Company Profile and Capability Statement',
  kicker: 'Prepared for institutional review',
  factsHeading: 'Key Profile Facts',
  legalCompaniesHeading: 'Independent Legal Companies',
  legalTableHeads: ['Company', 'TIN', 'Incorporation', 'Directors'],
  directorsHeading: 'Directors',
  imagesHeading: 'Related Operating Images',
  /** "<date>; No. <number>" */
  numberPrefix: 'No.',
} as const;
