import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'About Itemba Group';

export default ogImageFor({
  eyebrow: 'About Itemba Group',
  title: 'One group, three companies, one corridor.',
  subtitle: 'A Tanzanian holding group built on the Tunduma trade corridor in Songwe Region.',
});
