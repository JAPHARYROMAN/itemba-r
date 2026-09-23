'use client';
import { Suspense } from 'react';
import { PageSpinner } from '@/components/ui';
import { ReportViewer } from '@/features/reports/report-viewer';
export default function ReportRunPage() {
  return (
    <Suspense fallback={<PageSpinner label="Opening report" />}>
      <ReportViewer />
    </Suspense>
  );
}
