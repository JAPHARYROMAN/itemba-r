import { redirect } from 'next/navigation';
import { legacyFuelReportingHref } from '@/lib/petrodollar-navigation';
export default async function LegacyFuelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(key, value);
  }
  redirect(legacyFuelReportingHref('/fuel-reporting', params));
}
