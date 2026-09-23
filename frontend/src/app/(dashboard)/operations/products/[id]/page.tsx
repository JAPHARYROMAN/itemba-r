'use client';
import { useParams, useSearchParams } from 'next/navigation';
import { ProductProfile } from '@/components/workspace/product-profile';
export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const back = new URLSearchParams({ tab: 'catalog', view: 'products' });
  for (const key of ['companyId', 'divisionId', 'branchId', 'q']) {
    const value = search.get(key);
    if (value) back.set(key, value);
  }
  return <ProductProfile key={id} productId={id} backHref={`/inventory?${back}`} />;
}
