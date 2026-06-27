import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group insights';

export default ogImageFor({
  eyebrow: 'Insights',
  title: 'Guides for suppliers, buyers & partners.',
  subtitle: 'Practical reading on fuel, trade, logistics and the Tunduma corridor.',
});
