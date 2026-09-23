import { LegacyLogin } from '@/components/auth/legacy-login';
import { OsLogin } from '@/components/auth/os-login';
import { ITEMBA_OS_ENABLED } from '@/lib/itemba-os-flag';

export default function LoginPage() {
  return ITEMBA_OS_ENABLED ? <OsLogin /> : <LegacyLogin />;
}
