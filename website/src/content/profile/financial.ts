/**
 * Company profile §11: financial overview. No figures are published; the
 * documents are shared directly with authorized reviewers.
 */
import 'server-only';

/** Screen view paragraphs. */
export const financialOverview = [
  'Itemba Group operates across fuel retail, trade distribution, wholesale beverages, hardware supply, logistics, lodging, restaurant, bar, property and related services. The public profile describes the businesses and their operating responsibilities.',
  'For banking, supplier, investor or partner due diligence, contact the group office with the financial statements, management accounts, bank statements or supporting schedules required for your review.',
] as const;

/** Group print document. */
export const groupFinancialStatement =
  'The group operates across fuel retail, trade distribution, wholesale beverages, hardware supply, logistics, lodging, restaurant, bar and property-related services. Contact the group office with the financial statements, bank records, tax filings or asset schedules required for your review.';

/** Each company's print document. */
export const companyFinancialStatement =
  'The company operates within Itemba Group. Contact the group office with the financial statements, tax filings, management accounts, bank records or supporting schedules required for your review.';
