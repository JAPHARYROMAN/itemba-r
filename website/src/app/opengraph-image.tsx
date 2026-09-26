import { ogCards } from '@/content/og';
import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

// Node runtime (the default): the shared card reads its fonts and crest from disk.
const { alt: cardAlt, ...card } = ogCards.root;

export const alt = cardAlt;
export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;

export default ogImageFor(card);
