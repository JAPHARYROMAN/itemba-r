import { redirect } from 'next/navigation';
import { ITEMBA_OS_ENABLED } from '@/lib/itemba-os-flag';

export const metadata = { title: 'Desktop · ITEMBA OS' };

// The OS shell draws the desktop itself; this route only exists for it.
export default function DesktopPage() {
  if (!ITEMBA_OS_ENABLED) redirect('/dashboard');
  return null;
}
