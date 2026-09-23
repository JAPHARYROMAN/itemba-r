import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function mappedCashAccount(
  tx: Prisma.TransactionClient,
  companyId: string,
  cashAccountId: string,
  currency?: string,
) {
  const cash = await tx.cashAccount.findFirst({
    where: { id: cashAccountId, companyId, isActive: true, deletedAt: null },
    include: { ledgerAccount: true },
  });
  const gl = cash?.ledgerAccount;
  if (
    !cash ||
    !gl ||
    !gl.isActive ||
    gl.deletedAt ||
    gl.accountType !== 'ASSET' ||
    gl.companyId !== companyId ||
    (currency && cash.currency !== currency) ||
    (gl.divisionId && gl.divisionId !== cash.divisionId) ||
    (gl.branchId && gl.branchId !== cash.branchId)
  )
    throw new BadRequestException(
      'Connect this cash/bank account to its own active asset ledger account in Reports → Accounting → Account connections.',
    );
  return { cash, ledger: gl };
}
