'use client';

import { useParams } from 'next/navigation';
import { SupplierProfile } from '@/app/(dashboard)/operations/suppliers/_components/SupplierProfile';

export default function InvoiceDeskSupplierPage() {
  const params = useParams<{ id: string }>();
  const supplierId = Array.isArray(params.id) ? params.id[0] : params.id;
  return (
    <SupplierProfile
      key={supplierId}
      supplierId={supplierId}
      backHref="/invoice-desk?view=suppliers"
    />
  );
}
