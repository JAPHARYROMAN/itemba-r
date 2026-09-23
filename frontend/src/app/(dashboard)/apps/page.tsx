import { redirect } from 'next/navigation';
import { ITEMBA_OS_ENABLED } from '@/lib/itemba-os-flag';

// The OS shell draws the app library itself; this route only exists for it.
export default function AppsPage() {
  if (!ITEMBA_OS_ENABLED) redirect('/dashboard');
  return null;
}
