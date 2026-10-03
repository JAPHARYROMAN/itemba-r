/**
 * Company profile §11: financial overview. No figures are published; the
 * documents are shared directly with authorized reviewers.
 */
import 'server-only';

/** Screen view paragraphs. */
export const financialOverview = [
  'Itemba Group operates revenue-generating companies across fuel retail, trade distribution, wholesale beverages, hardware supply, logistics, lodging, restaurant, bar, property, and related services. Public-facing financial figures are not displayed on the website because detailed financial statements, bank records, tax filings, and asset schedules are sensitive business documents.',
  'For banking, supplier, investor, or partner due diligence, management accounts, audited financial statements, bank statements, and supporting schedules can be provided directly through the appropriate authorized channel.',
] as const;

/** Group print document. */
export const groupFinancialStatement =
  'The group operates revenue-generating companies across fuel retail, trade distribution, wholesale beverages, hardware supply, logistics, lodging, restaurant, bar, property-related services, and emerging businesses. Detailed financial statements, bank records, tax filings, and asset schedules are controlled documents and can be provided directly to authorized reviewers.';

/** Each company's print document. */
export const companyFinancialStatement =
  'The company operates as a revenue-generating legal entity within Itemba Group. Detailed financial statements, tax filings, management accounts, bank records, and supporting schedules are treated as controlled documents and can be shared directly with authorized banks, suppliers, partners, and reviewers.';
