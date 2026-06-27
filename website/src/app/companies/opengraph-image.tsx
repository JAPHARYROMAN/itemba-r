import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group companies';

export default ogImageFor({
  eyebrow: 'Our Companies',
  title: 'Three companies. Six sectors.',
  subtitle: 'Mwanjalisi Oil · Westsides Company · Itemba Enterprises.',
});
