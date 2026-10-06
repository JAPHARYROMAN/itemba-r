import { BadRequestException } from '@nestjs/common';
import { CashDeskAccount, Prisma } from '@prisma/client';
import { assertCashAccountScopeCompatible } from '../../common/services/cash-account-scope.helper';

/** Apply a new signed desk entry to its ERP mirror, once, in the same transaction. */
export async function applyDeskCashEffect(
  tx: Prisma.TransactionClient,
  desk: CashDeskAccount,
  amount: Prisma.Decimal,
) {
  if (!desk.erpCashAccountId) return false;
  const cash = await tx.cashAccount.findFirst({
    where: {
      id: desk.erpCashAccountId,
      companyId: desk.companyId,
      deletedAt: null,
      isActive: true,
    },
    include: { ledgerAccount: true },
  });
  if (
    !cash ||
    cash.currency !== desk.currency ||
    !cash.ledgerAccount ||
    !cash.ledgerAccount.isActive ||
    cash.ledgerAccount.deletedAt ||
    cash.ledgerAccount.companyId !== desk.companyId ||
    cash.ledgerAccount.accountType !== 'ASSET'
  )
    throw new BadRequestException(
      'Connect an active cash and asset ledger account in this company and currency.',
    );
  assertCashAccountScopeCompatible(cash, desk);
  if (
    (cash.ledgerAccount.divisionId && cash.ledgerAccount.divisionId !== desk.divisionId) ||
    (cash.ledgerAccount.branchId && cash.ledgerAccount.branchId !== desk.branchId)
  )
    throw new BadRequestException('The connected ledger belongs to another branch or division.');
  const updated = await tx.cashAccount.updateMany({
    where: {
      id: cash.id,
      ...(amount.lt(0) ? { currentBalance: { gte: amount.negated() } } : {}),
    },
    data: { currentBalance: { increment: amount } },
  });
  if (updated.count !== 1)
    throw new BadRequestException('Insufficient funds in the connected cash account.');
  return true;
}
