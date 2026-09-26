import { ogCards } from '@/content/og';
import { OG_CONTENT_TYPE, OG_SIZE, ogImageFor } from '@/lib/og-card';

const { alt: cardAlt, ...card } = ogCards.services;

export const size = { width: OG_SIZE.width, height: OG_SIZE.height };
export const contentType = OG_CONTENT_TYPE;
export const alt = cardAlt;

export default ogImageFor(card);
