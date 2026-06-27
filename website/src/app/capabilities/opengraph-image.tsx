import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group capabilities';

export default ogImageFor({
  eyebrow: 'Capabilities',
  title: 'Built to move the southern corridor.',
  subtitle: 'Energy, trade, logistics, hospitality, construction and property — under one group.',
});
