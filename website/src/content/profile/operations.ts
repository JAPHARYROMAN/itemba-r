/**
 * Company profile §7: the operating companies and what each runs.
 */
import 'server-only';

export const profileCompanyOperations = [
  {
    slug: 'mwanjalisi-oil',
    name: 'Mwanjalisi Oil Co Ltd',
    sector: 'Petroleum Retail, Fuel Supply, and Parking',
    companyId: 'mwanjalisi',
    detail:
      'Petroleum retail and parking operations managed by Mwanjalisi Oil Company Ltd. The public-facing filling station brands are ITEMBA-MPEMBA and ITEMBA-UZUNGUNI, while the parking facility trades as UZUNGUNI PARKING YARD.',
  },
  {
    slug: 'westsides-company',
    name: 'Westsides Company Ltd',
    sector: 'Beverages, ITEMBA-HARDWARE, and UZUNGUNI INN',
    companyId: 'westsides',
    detail:
      'Westsides Company Ltd manages beverage distribution, ITEMBA-HARDWARE, and UZUNGUNI INN.',
  },
  {
    slug: 'itemba-enterprises',
    name: 'Itemba Enterprises Co Ltd',
    sector: 'Logistics and Emerging Businesses',
    companyId: 'enterprises',
    detail:
      'Local logistics, cross-border transit, and emerging business activities after trading and hospitality operations moved under Westsides Company Ltd and UZUNGUNI PARKING YARD came under Mwanjalisi Oil Company Ltd management.',
  },
] as const;

export const operationsNote =
  'Branch, site, and division-level details are managed by the relevant operating company. Formal branch schedules can be provided for authorized due diligence where required.';
