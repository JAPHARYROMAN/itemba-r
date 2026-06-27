import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group locations';

export default ogImageFor({
  eyebrow: 'Locations',
  title: 'Based in Songwe. Connected through Tunduma.',
  subtitle: 'Headquartered in Mpemba-Tunduma on the Tanzania-Zambia trade corridor.',
});
