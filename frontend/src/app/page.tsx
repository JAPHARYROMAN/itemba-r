import { redirect } from 'next/navigation';
import { ITEMBA_OS_ENABLED } from '@/lib/itemba-os-flag';

export default function Home() {
  redirect(ITEMBA_OS_ENABLED ? '/desktop' : '/dashboard');
}
