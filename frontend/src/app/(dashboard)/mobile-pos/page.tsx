import type { Metadata } from 'next';
import { MobilePosLite } from '@/components/westsides/mobile-pos-lite/mobile-pos-lite';

export const metadata: Metadata = {
  title: 'Itemba Mobile POS Lite',
  manifest: '/westsides-mobile-pos.webmanifest',
};

export default function MobilePosLitePage() {
  return <MobilePosLite />;
}
