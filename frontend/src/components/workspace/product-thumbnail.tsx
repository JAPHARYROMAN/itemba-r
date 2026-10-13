'use client';

import Image from 'next/image';
import { Package } from 'lucide-react';
import { useState } from 'react';
import type { Product } from './product-types';

export function ProductThumbnail({ record, version }: { record: Product; version: number }) {
  const src = `/api/backend/products/${encodeURIComponent(record.id)}/image?v=${version}`;
  const [failed, setFailed] = useState('');
  return record.imageUrl && failed !== src ? (
    <Image
      src={src}
      alt=""
      width={44}
      height={44}
      unoptimized
      className="product-thumbnail"
      onError={() => setFailed(src)}
    />
  ) : (
    <span className="product-thumbnail product-thumbnail-empty">
      <Package size={20} aria-hidden="true" />
    </span>
  );
}
