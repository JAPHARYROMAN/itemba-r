import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'PetroDollar · ITEMBA OS' };
/** Compatibility routes have no separate shell or authentication boundary. */
export default function LegacyFuelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
