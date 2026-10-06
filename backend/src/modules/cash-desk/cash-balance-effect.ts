import { BadRequestException, ConflictException } from '@nestjs/common';
import { CashDeskAccount, Prisma } from '@prisma/client';
import { assertCashAccountScopeCompatible } from '../../common/services/cash-account-scope.helper';

/** All owned cash writers lock the ERP account before its drawer. */
export async function lockDeskCashAccount(tx: Prisma.TransactionClient, id: string) {
  const before = await tx.cashDeskAccount.findUnique({ where: { id } });
  if (before?.erpCashAccountId)
    await tx.$queryRaw`SELECT id FROM cash_accounts WHERE id = ${before.erpCashAccountId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM cash_desk_accounts WHERE id = ${id} FOR UPDATE`;
  const account = await tx.cashDeskAccount.findUnique({ where: { id } });
  if (account?.erpCashAccountId !== before?.erpCashAccountId)
    throw new ConflictException(
      'The cash account connection changed. Refresh before trying again.',
    );
  return account;
}

/** Apply a new signed desk entry to its ERP mirror, once, in the same transaction. */
export async function applyDeskCashEffect(
  tx: Prisma.TransactionClient,
  desk: CashDeskAccount,
  amount: Prisma.Decimal,
  reversalOfId?: string,
) {
  if (reversalOfId) {
    const original = await tx.cashDeskEntry.findFirst({
      where: { movementId: reversalOfId, accountId: desk.id },
      select: { erpBalanceApplied: true },
    });
    if (!original) throw new BadRequestException('The original cash entry is missing.');
    if (!original.erpBalanceApplied) return false;
  }
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
