import { ConflictException } from '@nestjs/common';
import { Prisma, Receivable } from '@prisma/client';

/** Payment paths take receivables before sales orders. Fail instead of inverting that wait order. */
export async function lockReceivableWithoutWaiting(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<Receivable | null> {
  try {
    const rows = await tx.$queryRaw<Receivable[]>(Prisma.sql`
      SELECT * FROM receivables WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE NOWAIT
    `);
    return rows[0] ?? null;
  } catch (error) {
    const failure = error as { code?: unknown; meta?: { code?: unknown } } | null;
    if (failure?.code === '55P03' || failure?.meta?.code === '55P03')
      throw new ConflictException(
        'The linked receivable is being updated. Your changes were not applied; refresh and retry.',
      );
    throw error;
  }
}

/** Write-off posts its journal before syncing the order; preflight before any accounting locks. */
export async function preflightSalesOrderReceivables(
  tx: Prisma.TransactionClient,
  companyId: string,
  salesOrderIds: string[],
  explicitReceivableIds: string[] = [],
): Promise<void> {
  if (!salesOrderIds.length && !explicitReceivableIds.length) return;
  const rows = await tx.receivable.findMany({
    where: {
      companyId,
      deletedAt: null,
      OR: [
        ...(explicitReceivableIds.length ? [{ id: { in: explicitReceivableIds } }] : []),
        ...(salesOrderIds.length
          ? [
              { sourceType: 'SalesOrder', sourceId: { in: salesOrderIds } },
              { salesOrders: { some: { id: { in: salesOrderIds } } } },
            ]
          : []),
      ],
    },
    select: { id: true },
  });
  for (const id of [...new Set([...explicitReceivableIds, ...rows.map((row) => row.id)])].sort()) {
    const row = await lockReceivableWithoutWaiting(tx, id);
    if (row && row.companyId !== companyId)
      throw new ConflictException('The linked receivable belongs to another company.');
  }
}
