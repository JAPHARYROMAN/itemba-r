import type { Metadata } from 'next';
import { MobilePosSaleEntry } from '@/components/westsides/mobile-pos/mobile-pos-sale-entry';
import {
  WESTSIDES_MOBILE_POS_MANIFEST_PATH,
  WESTSIDES_MOBILE_POS_NAME,
} from '@/components/westsides/mobile-pos-install/routes';

export const metadata: Metadata = {
  title: `Operations ${WESTSIDES_MOBILE_POS_NAME}`,
  description: 'Minimal Westsides counter-sale entry through Operations Sales Orders.',
  manifest: WESTSIDES_MOBILE_POS_MANIFEST_PATH,
};

export default function OperationsMobilePosPage() {
  return <MobilePosSaleEntry />;
}
