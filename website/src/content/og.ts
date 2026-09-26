/**
 * Open Graph card copy per route (1200x630 cards rendered by src/lib/og-card).
 * `alt` is the card's og:image:alt. Dynamic routes build their card from the
 * company, service, location or article and fall back to `fallbacks`.
 * Small and edge-safe (no server-only import).
 */
export type OgCardCopy = {
  alt: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
};

export const ogCards = {
  root: {
    alt: "Itemba Group - Tanzania's Diversified Business Group",
    eyebrow: 'Diversified Business Group',
    title: 'Energy. Trade. Logistics. Hospitality.',
    subtitle: 'Three independent companies, six business sectors, one unified vision.',
  },
  about: {
    alt: 'About Itemba Group',
    eyebrow: 'About Itemba Group',
    title: 'One group, three companies, one corridor.',
    subtitle: 'A Tanzanian holding group built on the Tunduma trade corridor in Songwe Region.',
  },
  capabilities: {
    alt: 'Itemba Group capabilities',
    eyebrow: 'Capabilities',
    title: 'Built to move the southern corridor.',
    subtitle: 'Energy, trade, logistics, hospitality, construction and property — under one group.',
  },
  companies: {
    alt: 'Itemba Group companies',
    eyebrow: 'Our Companies',
    title: 'Three companies. Six sectors.',
    subtitle: 'Mwanjalisi Oil · Westsides Company · Itemba Enterprises.',
  },
  companyProfile: {
    alt: 'Itemba Group company profile',
    eyebrow: 'Company Profile',
    title: 'The Itemba Group company profile.',
    subtitle: 'The full profile of the group, its companies, operations and corridor location.',
  },
  contact: {
    alt: 'Contact Itemba Group',
    eyebrow: 'Contact',
    title: 'Talk to the group office.',
    subtitle: 'Route any enquiry to the right Itemba Group company or division.',
  },
  faq: {
    alt: 'Itemba Group — frequently asked questions',
    eyebrow: 'Questions & Answers',
    title: 'How Itemba Group works.',
    subtitle: 'Common questions about the group, its companies, services and corridor location.',
  },
  insights: {
    alt: 'Itemba Group insights',
    eyebrow: 'Insights',
    title: 'Guides for suppliers, buyers & partners.',
    subtitle: 'Practical reading on fuel, trade, logistics and the Tunduma corridor.',
  },
  locations: {
    alt: 'Itemba Group locations',
    eyebrow: 'Locations',
    title: 'Based in Songwe. Connected through Tunduma.',
    subtitle: 'Headquartered in Mpemba-Tunduma on the Tanzania-Zambia trade corridor.',
  },
  partnerships: {
    alt: 'Partner with Itemba Group',
    eyebrow: 'Partnerships',
    title: 'Build with Itemba Group.',
    subtitle: 'Supplier, bulk-purchase, logistics and construction-supply partnerships.',
  },
  services: {
    alt: 'Itemba Group services',
    eyebrow: 'Services',
    title: 'Energy, trade, logistics & more.',
    subtitle: 'Six service areas across the three Itemba Group companies.',
  },
} as const satisfies Record<string, OgCardCopy>;

/** Dynamic-route cards: alt text and the copy used when a slug is unknown. */
export const ogFallbacks = {
  company: { alt: 'Itemba Group company profile', eyebrow: 'Our Companies', title: 'Itemba Group' },
  service: { alt: 'Itemba Group service area', eyebrow: 'Services', title: 'Itemba Group Services' },
  location: { alt: 'Itemba Group location', eyebrow: 'Locations', title: 'Itemba Group Location' },
  insight: { alt: 'Itemba Group insight article', eyebrow: 'Insights', title: 'Itemba Group Insights' },
} as const satisfies Record<string, OgCardCopy>;
