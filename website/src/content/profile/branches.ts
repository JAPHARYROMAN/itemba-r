/**
 * Company profile §7: branches and sites per company (`companyId` for the
 * accent on screen). The rebuilt screen view sets the branch schedule as
 * type, with two photographs of its own (./screen `operationsVisuals`); the
 * per-branch photographs are kept for reuse and are not rendered.
 */
import 'server-only';
import { mediaImage } from '../media';
import type { CompanyId } from '../types';

export const branchOperations = [
  {
    companyId: 'westsides' as CompanyId,
    company: 'Westsides Company Ltd',
    summary:
      'Westsides Company Ltd operates four main branches within Songwe Region across wholesale beverage distribution, hardware, and construction equipment sales.',
    branches: [
      {
        name: 'Mpemba Main Branch',
        focus: 'Beverage distribution in wholesale only.',
        coverage: 'Wholesale beverage customers in Mpemba and the surrounding business area.',
        image: mediaImage('westsides-order-truck', { alt: 'Customer beverage order loaded for Westsides Company Ltd wholesale distribution' }),
      },
      {
        name: 'Mlowo Branch',
        focus: 'Beverage distribution centre.',
        coverage: 'Mlowo town and its neighboring villages and wards.',
        image: mediaImage('westsides-warehouse-stock', { alt: 'Large beverage stock supplied through Westsides Company Ltd Mlowo Branch' }),
      },
      {
        name: 'Sogea Branch',
        focus: 'Beverage distribution branch.',
        coverage: 'Sogea and Tunduma town as a whole.',
        image: mediaImage('westsides-softdrinks', { alt: 'Soft drink stock supplied through Westsides Company Ltd Sogea Branch' }),
      },
      {
        name: 'Tunduma Main Branch',
        focus: 'Hardware and construction equipment sales.',
        coverage:
          'Songwe Region, supported by warehouses in Tunduma town and the Sogea area.',
        image: mediaImage('hardware-storefront', { alt: 'ITEMBA-HARDWARE storefront and construction supply stock in Tunduma' }),
      },
    ],
  },
  {
    companyId: 'mwanjalisi' as CompanyId,
    company: 'Mwanjalisi Oil Company Ltd',
    summary:
      'Mwanjalisi Oil Company Ltd manages the retail fuel station business. Each filling station carries the ITEMBA brand name followed by its location name only.',
    branches: [
      {
        name: 'ITEMBA-UZUNGUNI',
        focus: 'Operating retail fuel station managed by Mwanjalisi Oil Company Ltd.',
        coverage: 'Located along the TANZAM Highway in Uzunguni Area, Mpemba.',
        image: mediaImage('uzunguni-pump-island', { alt: 'ITEMBA-UZUNGUNI filling station managed by Mwanjalisi Oil Company Ltd' }),
      },
      {
        name: 'ITEMBA-MPEMBA',
        focus: 'Operating retail fuel station managed by Mwanjalisi Oil Company Ltd.',
        coverage: 'Located near the Tunduma Bus Station along the Tunduma-Ileje Highway.',
        image: mediaImage('mpemba-service-yard', { alt: 'ITEMBA-MPEMBA filling station managed by Mwanjalisi Oil Company Ltd' }),
      },
      {
        name: 'Three Upcoming ITEMBA-Branded Fuel Station Locations',
        focus: 'Planned expansion locations.',
        coverage: 'Additional retail fuel station locations will follow the ITEMBA-location naming system while remaining under Mwanjalisi Oil Company Ltd management.',
      },
    ],
  },
  {
    companyId: 'mwanjalisi' as CompanyId,
    company: 'Mwanjalisi Oil Company Ltd - Parking Facilities',
    summary:
      'Parking facilities trade publicly as UZUNGUNI PARKING YARD and are managed by Mwanjalisi Oil Company Ltd for corridor movement and fuel customers.',
    branches: [
      {
        name: 'UZUNGUNI PARKING YARD',
        focus: 'Parking yard facility managed by Mwanjalisi Oil Company Ltd.',
        coverage: 'Located in Uzunguni Area, Mpemba-Tunduma.',
        image: mediaImage('parking-container-trucks', { alt: 'Container trucks parked at UZUNGUNI PARKING YARD' }),
      },
    ],
  },
] as const;
