import type { Metadata } from 'next';
import { MobilePosSaleEntry } from '@/components/westsides/mobile-pos/mobile-pos-sale-entry';
import {
  WESTSIDES_MOBILE_POS_MANIFEST_PATH,
  WESTSIDES_MOBILE_POS_NAME,
} from '@/components/westsides/mobile-pos-install/routes';

export const metadata: Metadata = {
  title: WESTSIDES_MOBILE_POS_NAME,
  description: 'Minimal Westsides counter-sale entry for phones and tablets.',
  manifest: WESTSIDES_MOBILE_POS_MANIFEST_PATH,
};

export default function WestsidesMobilePosPage() {
  return <MobilePosSaleEntry />;
}
