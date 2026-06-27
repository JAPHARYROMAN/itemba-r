import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group services';

export default ogImageFor({
  eyebrow: 'Services',
  title: 'Energy, trade, logistics & more.',
  subtitle: 'Six service areas across the three Itemba Group companies.',
});
