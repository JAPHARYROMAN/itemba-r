import { Prisma } from '@prisma/client';

/** Shares Products.update's row lock and protects even an absent balance tuple. */
export async function lockInventoryProducts(db: Prisma.TransactionClient, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  if (!ids.length) return;
  await db.$queryRaw(Prisma.sql`
    SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE
  `);
}
