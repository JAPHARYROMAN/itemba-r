import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group company profile';

export default ogImageFor({
  eyebrow: 'Company Profile',
  title: 'The Itemba Group company profile.',
  subtitle: 'The full profile of the group, its companies, operations and corridor location.',
});
