import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type LockedBalance = {
  id: string;
  companyId: string;
  branchId: string;
  productId: string;
  quantityReserved: Prisma.Decimal;
};

/** Caller must hold this inventory balance's row lock for the entire transaction. */
export async function releaseExpiredPosReservations(
  tx: Prisma.TransactionClient,
  balance: LockedBalance,
): Promise<Prisma.Decimal> {
  // Read expiry and quantity only after the balance lock. A stale pre-lock read
  // could otherwise release a hold which another reviewer has just renewed.
  const expired = await tx.$queryRaw<{ releasedQuantity: Prisma.Decimal | null }[]>(Prisma.sql`
    WITH released AS (
      UPDATE "pos_draft_reservations" SET "releasedAt" = statement_timestamp()
      WHERE "companyId" = ${balance.companyId} AND "branchId" = ${balance.branchId}
        AND "productId" = ${balance.productId} AND "releasedAt" IS NULL
        AND "expiresAt" <= statement_timestamp()
      RETURNING quantity
    ) SELECT SUM(quantity) AS "releasedQuantity" FROM released
  `);
  const releasedQuantity = new Prisma.Decimal(expired[0]?.releasedQuantity ?? 0);
  if (releasedQuantity.gt(balance.quantityReserved)) {
    // Throwing rolls back the reservation claims as well as any balance writes.
    throw new BadRequestException(
      'Inventory reservations require reconciliation before releasing stock.',
    );
  }
  if (releasedQuantity.gt(0)) {
    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { quantityReserved: { decrement: releasedQuantity } },
    });
  }
  return new Prisma.Decimal(balance.quantityReserved).minus(releasedQuantity);
}
