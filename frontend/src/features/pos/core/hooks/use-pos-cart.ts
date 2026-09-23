'use client';

import { useEffect, useMemo, useState } from 'react';
import { backendGet } from '@/lib/api-client';
import type { MobilePosLiteBinding, MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';
import type { CartLine } from '../pos-types';
import { mergeProducts, terminalHeaders } from '../pos-utils';

type UsePosCartArgs = {
  binding: MobilePosLiteBinding | null;
  online: boolean;
  catalog: MobilePosLiteProduct[];
  updateCatalog: (terminalCode: string, products: MobilePosLiteProduct[]) => void;
  /** Owned by the orchestrator (the bootstrap boot effect seeds it). */
  frequents: Record<string, number>;
};

/**
 * The sale cart plus product lookup: cart lines, add/quantity mutations, the
 * debounced remote product search feeding `matches`, and the locally
 * personalized quick-pick grid.
 */
export function usePosCart({
  binding,
  online,
  catalog,
  updateCatalog,
  frequents,
}: UsePosCartArgs): {
  cart: CartLine[];
  setCart: (cart: CartLine[]) => void;
  query: string;
  setQuery: (query: string) => void;
  matches: MobilePosLiteProduct[];
  total: number;
  cartCount: number;
  quickPicks: MobilePosLiteProduct[];
  addProduct: (product: MobilePosLiteProduct) => void;
  setQuantity: (productId: string, next: number) => void;
} {
  const [query, setQuery] = useState('');
  const [remoteProducts, setRemoteProducts] = useState<MobilePosLiteProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);

  useEffect(() => {
    if (!binding || !online || query.trim().length < 2) {
      setRemoteProducts([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      backendGet<MobilePosLiteProduct[]>('/mobile-pos-lite/products', {
        headers: terminalHeaders(binding),
        query: { search: query.trim() },
      })
        .then((products) => {
          if (cancelled) return;
          setRemoteProducts(products);
          updateCatalog(binding.terminalCode, products);
        })
        .catch(() => {
          if (!cancelled) setRemoteProducts([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [binding, online, query, updateCatalog]);

  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const local =
      term.length < 2
        ? []
        : catalog
            .filter((product) =>
              [product.name, product.code, product.barcode ?? ''].some((value) =>
                value.toLocaleLowerCase().includes(term),
              ),
            )
            .slice(0, 12);
    return mergeProducts(local, remoteProducts).slice(0, 12);
  }, [catalog, query, remoteProducts]);

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.sellingPrice * line.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);

  // Quick-pick grid: this terminal's most-sold products, personalized locally
  // and available offline. Falls back to the first catalog items so a fresh
  // terminal still gets tappable tiles instead of an empty search box.
  const quickPicks = useMemo(() => {
    const ranked = [...catalog].sort(
      (a, b) => (frequents[b.id] ?? 0) - (frequents[a.id] ?? 0) || a.name.localeCompare(b.name),
    );
    return ranked.slice(0, 12);
  }, [catalog, frequents]);

  function addProduct(product: MobilePosLiteProduct) {
    setCart((current) => {
      const match = current.find((line) => line.product.id === product.id);
      if (match)
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      return [...current, { product, quantity: 1 }];
    });
    setQuery('');
    setRemoteProducts([]);
  }

  function setQuantity(productId: string, next: number) {
    setCart((current) =>
      next <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) =>
            line.product.id === productId ? { ...line, quantity: next } : line,
          ),
    );
  }

  return {
    cart,
    setCart,
    query,
    setQuery,
    matches,
    total,
    cartCount,
    quickPicks,
    addProduct,
    setQuantity,
  };
}
