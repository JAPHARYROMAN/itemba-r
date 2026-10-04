import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthUser } from '../decorators/current-user.decorator';

/** Direct ERP sessions must not bypass an enrolled worker's approval branch. */
export async function assertLegacyPosWriteAllowed(
  db: PrismaClient | Prisma.TransactionClient,
  user: AuthUser,
  companyId: string,
  branchId?: string | null,
) {
  if (
    user.tokenUse === 'mobile-pos' ||
    ['CASHIER', 'STOCKIST'].includes(user.mobilePosRole ?? '')
  ) {
    throw new ForbiddenException('Submit this transaction to POS Draft for approval.');
  }
  const enrolment = await db.mobilePosEnrollment.findFirst({
    where: {
      userId: user.id,
      companyId,
      ...(branchId ? { branchId } : {}),
      approvedRole: { in: ['CASHIER', 'STOCKIST'] },
      approvedAt: { not: null },
      branchSetup: { approvalRequired: true },
    },
    select: { id: true },
  });
  if (enrolment) throw new ForbiddenException('Submit this transaction to POS Draft for approval.');
  if (user.permissions?.includes('mobile_pos_lite.manage')) return;
  // A terminal assigned before enrollment remains subject to the branch policy.
  const legacyTerminals = await db.mobilePosTerminal.findMany({
    where: { assignedUserId: user.id, companyId, ...(branchId ? { branchId } : {}) },
    select: { branchId: true },
  });
  if (
    legacyTerminals.length &&
    (await db.mobilePosBranchSetup.findFirst({
      where: {
        branchId: { in: legacyTerminals.map((terminal) => terminal.branchId) },
        approvalRequired: true,
      },
      select: { id: true },
    }))
  ) {
    throw new ForbiddenException('Submit this transaction to POS Draft for approval.');
  }
}
