import type { MobilePosLiteBinding, MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';

export function money(value: number) {
  return `TZS ${new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)}`;
}

export function newIdempotencyKey() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function terminalHeaders(binding: MobilePosLiteBinding) {
  return {
    'x-mobile-pos-terminal': binding.terminalCode,
    'x-mobile-pos-device': binding.deviceSecret,
  };
}

export function isConnectionProblem(error: unknown) {
  return !navigator.onLine || (error instanceof TypeError && /fetch|network/i.test(error.message));
}

export function mergeProducts(existing: MobilePosLiteProduct[], incoming: MobilePosLiteProduct[]) {
  const merged = new Map(existing.map((product) => [product.id, product]));
  incoming.forEach((product) => merged.set(product.id, product));
  return Array.from(merged.values());
}

export function pendingTime(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
