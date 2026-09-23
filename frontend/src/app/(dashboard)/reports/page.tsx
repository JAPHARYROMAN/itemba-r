import { Suspense } from 'react';
import { ReportsApp } from '@/features/reports/reports-app';
export const metadata = { title: 'Reports · ITEMBA OS' };
export default function ReportsPage() {
  return (
    <Suspense fallback={<p role="status">Loading Reports…</p>}>
      <ReportsApp />
    </Suspense>
  );
}
