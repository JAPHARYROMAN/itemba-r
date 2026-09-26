/**
 * The company profile's 17 sections, in document order. The ids are anchor
 * ids (linked from other pages and the contents navigation) and must not
 * change.
 */
import 'server-only';

export const outline = [
  { id: 'cover-page', title: 'Cover Page' },
  { id: 'company-overview', title: 'Company Overview' },
  { id: 'vision-mission', title: 'Vision and Mission' },
  { id: 'business-activities', title: 'Business Activities' },
  { id: 'products-services', title: 'Products and Services' },
  { id: 'target-market', title: 'Target Market' },
  { id: 'operations-branches', title: 'Operations and Branches' },
  { id: 'management-ownership', title: 'Management and Ownership' },
  { id: 'company-history', title: 'Company History' },
  { id: 'assets-capacity', title: 'Assets and Capacity' },
  { id: 'financial-overview', title: 'Financial Overview' },
  { id: 'compliance-information', title: 'Compliance Information' },
  { id: 'competitive-strengths', title: 'Competitive Strengths' },
  { id: 'future-plans', title: 'Future Plans' },
  { id: 'banking-purpose', title: 'Purpose of Banking Relationship' },
  { id: 'contact-information', title: 'Contact Information' },
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
