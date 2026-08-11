import type { Metadata, Viewport } from 'next';
import { MobilePosLite } from '@/components/westsides/mobile-pos-lite/mobile-pos-lite';

export const metadata: Metadata = {
  title: 'Itemba POS',
  manifest: '/westsides-mobile-pos.webmanifest',
};

// Kaunta chrome: warm-paper theme color and edge-to-edge viewport so the
// Phase-2 slab can pad with env(safe-area-inset-bottom) on notched phones.
export const viewport: Viewport = {
  themeColor: '#faf7f0',
  viewportFit: 'cover',
};

export default function MobilePosLitePage() {
  return <MobilePosLite />;
}
