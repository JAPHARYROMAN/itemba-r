import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Partner with Itemba Group';

export default ogImageFor({
  eyebrow: 'Partnerships',
  title: 'Build with Itemba Group.',
  subtitle: 'Supplier, bulk-purchase, logistics and construction-supply partnerships.',
});
