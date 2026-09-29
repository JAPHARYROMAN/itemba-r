import { CashWorkspace } from '@/features/cash-desk/cash-workspace';
export const metadata = { title: 'Cash Desk · ITEMBA OS' };
export default async function CashWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const { record } = await searchParams;
  return <CashWorkspace targetRecordId={typeof record === 'string' ? record : undefined} />;
}
