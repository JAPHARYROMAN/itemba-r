'use client';
import { useParams } from 'next/navigation';
import { BusinessSalePrint } from '@/features/sales-desk/business-sale-print';
export default function SalesOrderPrintPage() {
  const params = useParams<{ id: string }>();
  return <BusinessSalePrint saleId={params.id} />;
}
