import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = 'Itemba Group — frequently asked questions';

export default ogImageFor({
  eyebrow: 'Questions & Answers',
  title: 'How Itemba Group works.',
  subtitle: 'Common questions about the group, its companies, services and corridor location.',
});
