import { InvoiceDesk } from '@/features/invoice-desk/invoice-desk';
export const metadata = { title: 'Invoice Desk · ITEMBA OS' };
export default async function InvoiceDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const { record } = await searchParams;
  return <InvoiceDesk targetRecordId={typeof record === 'string' ? record : undefined} />;
}
