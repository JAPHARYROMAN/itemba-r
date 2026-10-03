/**
 * Company profile §2: company overview.
 */
import 'server-only';
import { contact } from '../contact';

export const overviewParagraphs = [
  `Itemba Group is a Tanzanian holding group headquartered at ${contact.headOffice}. The group operates through three independently positioned companies: Mwanjalisi Oil Co Ltd, Westsides Company Ltd, and Itemba Enterprises Co Ltd.`,
  'The group model separates company-level operations from parent-level oversight. This allows each company to serve its market directly while maintaining a common identity, governance approach, and business development direction under Itemba Group.',
] as const;

export const overviewFacts = [
  { label: 'Business type', value: 'Multi-industry holding group' },
  { label: 'Primary location', value: 'Mpemba-Tunduma, Songwe Region, Tanzania' },
  { label: 'Public contact', value: contact.email },
] as const;
