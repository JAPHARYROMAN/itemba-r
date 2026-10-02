import { redirect } from 'next/navigation';
import { legacyFuelReportingHref } from '@/lib/petrodollar-navigation';
export default async function LegacyFuelLogin({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  redirect(
    legacyFuelReportingHref('/fuel-reporting/login', new URLSearchParams(from ? { from } : {})),
  );
}
