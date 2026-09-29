'use client';

import { useParams } from 'next/navigation';
import { SupplierProfile } from '../_components/SupplierProfile';

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const supplierId = Array.isArray(params.id) ? params.id[0] : params.id;
  return <SupplierProfile key={supplierId} supplierId={supplierId} />;
}
