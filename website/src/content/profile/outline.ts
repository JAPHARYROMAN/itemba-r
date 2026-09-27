/**
 * The company profile's 17 sections, in document order. The ids are anchor
 * ids (linked from other pages and the contents navigation) and must not
 * change. The titles are the screen view's headings, in the site's sentence
 * case; the print documents set their own (Title Case, ./print.ts).
 */
import 'server-only';

export const outline = [
  { id: 'cover-page', title: 'Cover page' },
  { id: 'company-overview', title: 'Company overview' },
  { id: 'vision-mission', title: 'Vision and mission' },
  { id: 'business-activities', title: 'Business activities' },
  { id: 'products-services', title: 'Products and services' },
  { id: 'target-market', title: 'Target market' },
  { id: 'operations-branches', title: 'Operations and branches' },
  { id: 'management-ownership', title: 'Management and ownership' },
  { id: 'company-history', title: 'Company history' },
  { id: 'assets-capacity', title: 'Assets and capacity' },
  { id: 'financial-overview', title: 'Financial overview' },
  { id: 'compliance-information', title: 'Compliance information' },
  { id: 'competitive-strengths', title: 'Competitive strengths' },
  { id: 'future-plans', title: 'Future plans' },
  { id: 'banking-purpose', title: 'Purpose of banking relationship' },
  { id: 'contact-information', title: 'Contact information' },
  { id: 'attachments', title: 'Attachments' },
] as const;

export type ProfileSectionId = (typeof outline)[number]['id'];

/** The screen view's one-line introduction under a section heading, where it has one. */
export const sectionLeads: Partial<Record<ProfileSectionId, string>> = {
  'company-overview':
    'Itemba Group is presented as a practical multi-industry business group with separate operating companies and a shared parent structure.',
  'business-activities':
    'The group covers multiple operating areas through named subsidiaries and divisions, with Westsides Company Ltd structured around three major divisions.',
  'products-services': 'Visitors can identify the right product or service category before contacting the group.',
  'operations-branches':
    'The public profile identifies the group head office and the operating companies responsible for specific business lines.',
  'competitive-strengths':
    'These strengths show why the group is commercially well positioned across fuel, beverages, distribution, and operating governance.',
  'banking-purpose':
    'The profile gives banks a concise view of why the group needs formal banking support and what business activities the relationship supports.',
  attachments: 'The website can list supporting documents without publishing sensitive files publicly.',
};

/** Section title by id. */
export function sectionTitle(id: ProfileSectionId): string {
  return outline.find((item) => item.id === id)?.title ?? id;
}

/** 1-based position of a section in the document. */
export function sectionNumber(id: ProfileSectionId): number {
  return outline.findIndex((item) => item.id === id) + 1;
}
