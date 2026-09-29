import { InvoiceWorkspace } from '@/features/invoice-desk/invoice-workspace';
export const metadata = { title: 'Invoice Desk · ITEMBA OS' };
export default async function InvoiceWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ record?: string | string[] }>;
}) {
  const { record } = await searchParams;
  return <InvoiceWorkspace targetRecordId={typeof record === 'string' ? record : undefined} />;
}
