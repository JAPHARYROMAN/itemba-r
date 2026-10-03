import { CashWorkspace } from '@/features/cash-desk/cash-workspace';
export const metadata = { title: 'Cash Desk · ITEMBA OS' };
type Param = string | string[] | undefined;
const single = (value: Param) => (typeof value === 'string' ? value : undefined);
export default async function CashWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ record?: Param; supplierId?: Param; customerId?: Param }>;
}) {
  const { record, supplierId, customerId } = await searchParams;
  return (
    <CashWorkspace
      targetRecordId={single(record)}
      targetSupplierId={single(supplierId)}
      targetCustomerId={single(customerId)}
    />
  );
}
