import { redirect } from 'next/navigation';

export default function MobilePosTerminalsPage() {
  redirect('/pos-draft?view=devices');
}
