import { SalesDesk } from '@/features/sales-desk/sales-desk';
export const metadata = { title: 'Sales Desk · ITEMBA OS' };
export default async function SalesDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const { record } = await searchParams;
  return <SalesDesk targetRecordId={typeof record === 'string' ? record : undefined} />;
}
