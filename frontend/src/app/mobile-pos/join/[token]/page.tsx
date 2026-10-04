import type { Metadata, Viewport } from 'next';
import { MobileJoin } from '@/features/pos-draft/mobile-join';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return {
    title: 'Install Itemba POS',
    manifest: `/westsides-mobile-pos.webmanifest?setup=${encodeURIComponent(token)}`,
  };
}
export const viewport: Viewport = { themeColor: '#f4f6f2', viewportFit: 'cover' };
export default async function MobileJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MobileJoin token={token} />;
}
