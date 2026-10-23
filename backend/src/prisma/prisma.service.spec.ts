import { Prisma } from '@prisma/client';
import { EphemeralSecretFingerprintRegistry, PersistenceSecretGuard } from '../common/services';
import { PrismaService } from './prisma.service';

describe('PrismaService soft-delete unique lookups', () => {
  let prisma: PrismaService;
  let execute: jest.Mock;

  beforeEach(() => {
    prisma = new PrismaService(
      new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry()),
    );
    // Capture the final request after the real middleware chain, without a DB.
    execute = jest.fn().mockResolvedValue(null);
    prisma.$use(execute);
  });

  afterEach(async () => {
    await prisma.$disconnect();
  });

  it('keeps the compound journal key valid for the payment replay check', async () => {
    const key = { companyId: 'company-1', journalNumber: 'AR-PAY-request-1' };
    await prisma.journalEntry.findUnique({ where: { companyId_journalNumber: key } });

    expect(execute.mock.calls[0][0]).toMatchObject({
      model: 'JournalEntry',
      action: 'findUnique',
      args: { where: { companyId_journalNumber: key, deletedAt: null } },
    });
    expect(execute.mock.calls[0][0].args.where.AND).toBeUndefined();
  });

  it('keeps scalar unique keys at the top level while excluding deleted rows', async () => {
    await prisma.receivable.findUnique({ where: { id: 'receivable-1' } });

    expect(execute.mock.calls[0][0]).toMatchObject({
      model: 'Receivable',
      action: 'findUnique',
      args: { where: { id: 'receivable-1', deletedAt: null } },
    });
  });

  it('preserves an explicit deleted-row lookup', async () => {
    const where: Prisma.JournalEntryWhereUniqueInput = {
      companyId_journalNumber: { companyId: 'company-1', journalNumber: 'AP-PAY-request-1' },
      deletedAt: { not: null },
    };
    await prisma.journalEntry.findUnique({ where });

    expect(execute.mock.calls[0][0]).toMatchObject({
      action: 'findUnique',
      args: { where },
    });
  });

  it('leaves unique reads on models without soft deletion unchanged', async () => {
    await prisma.accountingPeriod.findUnique({ where: { id: 'period-1' } });

    expect(execute.mock.calls[0][0]).toMatchObject({
      model: 'AccountingPeriod',
      action: 'findUnique',
      args: { where: { id: 'period-1' } },
    });
    expect(execute.mock.calls[0][0].args.where.deletedAt).toBeUndefined();
  });
});
