import type { Metadata } from 'next';
import { MobilePosActivation } from '@/components/westsides/mobile-pos-lite/mobile-pos-activation';

export const metadata: Metadata = {
  title: 'Set up Mobile POS',
  manifest: '/westsides-mobile-pos.webmanifest',
};

export default function MobilePosActivationPage() {
  return <MobilePosActivation />;
}
