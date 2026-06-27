import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Contact Itemba Group';

export default ogImageFor({
  eyebrow: 'Contact',
  title: 'Talk to the group office.',
  subtitle: 'Route any enquiry to the right Itemba Group company or division.',
});
