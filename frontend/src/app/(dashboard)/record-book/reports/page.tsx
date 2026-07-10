import { RecordBookReportsClient, type ReportKey } from '../record-book-reports-client';

const REPORT_KEYS = new Set([
  'daily-sales',
  'receipt-methods',
  'expenses-by-category',
  'expenses-by-payee',
  'net-movement',
  'branch-comparison',
  'monthly-trend',
]);

export default async function RecordBookReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string }>;
}) {
  const { report } = await searchParams;
  const initialReportKey = REPORT_KEYS.has(report ?? '') ? report : 'daily-sales';
  return <RecordBookReportsClient initialReportKey={initialReportKey as ReportKey} />;
}
