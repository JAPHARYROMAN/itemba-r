import { CashDesk } from '@/features/cash-desk/cash-desk';
export const metadata = { title: 'Cash Desk · ITEMBA OS' };
export default async function CashDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const { record } = await searchParams;
  return <CashDesk targetRecordId={typeof record === 'string' ? record : undefined} />;
}
