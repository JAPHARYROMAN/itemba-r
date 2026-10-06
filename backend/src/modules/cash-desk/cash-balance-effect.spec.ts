import { Prisma } from '@prisma/client';
import { applyDeskCashEffect, lockDeskCashAccount } from './cash-balance-effect';

const d = (value: number) => new Prisma.Decimal(value);
function setup() {
  const desk: any = {
    id: 'desk',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    erpCashAccountId: 'cash',
    currency: 'TZS',
  };
  const cash: any = {
    id: 'cash',
    companyId: 'company',
    divisionId: 'division',
    branchId: 'branch',
    currency: 'TZS',
    accountType: 'CASH_ON_HAND',
    currentBalance: d(100),
    ledgerAccount: {
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      isActive: true,
      deletedAt: null,
      accountType: 'ASSET',
    },
  };
  const tx: any = {
    cashDeskEntry: { findFirst: jest.fn().mockResolvedValue({ erpBalanceApplied: true }) },
    cashDeskAccount: { findUnique: jest.fn().mockResolvedValue(desk) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    cashAccount: {
      findFirst: jest.fn(async () => cash),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  return { tx, desk, cash };
}
it('deducts an expense from the connected balance with an atomic sufficient-funds condition', async () => {
  const { tx, desk } = setup();
  await expect(applyDeskCashEffect(tx, desk, d(-30))).resolves.toBe(true);
  expect(tx.cashAccount.updateMany).toHaveBeenCalledWith({
    where: { id: 'cash', currentBalance: { gte: d(30) } },
    data: { currentBalance: { increment: d(-30) } },
  });
});
it('restores a recorded owned payment but leaves an old unapplied reversal out of ERP cash', async () => {
  const { tx, desk } = setup();
  await expect(applyDeskCashEffect(tx, desk, d(30), 'original')).resolves.toBe(true);
  expect(tx.cashAccount.updateMany).toHaveBeenCalledTimes(1);
  tx.cashDeskEntry.findFirst.mockResolvedValue({ erpBalanceApplied: false });
  await expect(applyDeskCashEffect(tx, desk, d(30), 'old-original')).resolves.toBe(false);
  expect(tx.cashAccount.updateMany).toHaveBeenCalledTimes(1);
  tx.cashDeskEntry.findFirst.mockResolvedValue(null);
  await expect(applyDeskCashEffect(tx, desk, d(30), 'missing-original')).rejects.toThrow('missing');
});
it('refuses a cash mapping changed while acquiring the account locks', async () => {
  const { tx, desk } = setup();
  tx.cashDeskAccount.findUnique
    .mockResolvedValueOnce(desk)
    .mockResolvedValueOnce({ ...desk, erpCashAccountId: 'other' });
  await expect(lockDeskCashAccount(tx, desk.id)).rejects.toThrow('connection changed');
});
it('adds incoming cash or a reversal to the same connected account', async () => {
  const { tx, desk } = setup();
  await applyDeskCashEffect(tx, desk, d(30));
  expect(tx.cashAccount.updateMany).toHaveBeenCalledWith({
    where: { id: 'cash' },
    data: { currentBalance: { increment: d(30) } },
  });
});
it('keeps an unconnected desk account standalone', async () => {
  const { tx, desk } = setup();
  desk.erpCashAccountId = null;
  await expect(applyDeskCashEffect(tx, desk, d(-30))).resolves.toBe(false);
  expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
});
it.each(['branch', 'ledger', 'currency', 'funds'])(
  'refuses invalid %s without accepting a balance effect',
  async (problem) => {
    const { tx, desk, cash } = setup();
    if (problem === 'branch') cash.branchId = 'other';
    if (problem === 'ledger') cash.ledgerAccount.accountType = 'EXPENSE';
    if (problem === 'currency') cash.currency = 'USD';
    if (problem === 'funds') tx.cashAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(applyDeskCashEffect(tx, desk, d(-30))).rejects.toThrow();
    if (problem !== 'funds') expect(tx.cashAccount.updateMany).not.toHaveBeenCalled();
  },
);
