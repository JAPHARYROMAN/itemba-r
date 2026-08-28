import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountingLock, AccountingPeriod, FiscalPeriodStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface AssertPostingAllowedInput {
  companyId: string;
  accountingPeriodId?: string | null;
  transactionDate: Date;
  moduleName?: string;
}

type AccountingControlClient = Pick<
  Prisma.TransactionClient,
  'accountingPeriod' | 'accountingLock'
>;

@Injectable()
export class AccountingControlService {
  constructor(private readonly prisma: PrismaService) {}

  async assertPostingAllowed(
    input: AssertPostingAllowedInput,
    client: AccountingControlClient = this.prisma,
  ): Promise<ResolvedAccountingPeriod> {
    const transactionDate = this.startOfDay(input.transactionDate);
    let period: ResolvedAccountingPeriod | null = null;

    if (input.accountingPeriodId) {
      period = await client.accountingPeriod.findUnique({
        where: { id: input.accountingPeriodId },
        include: { fiscalYear: { select: { id: true, status: true } } },
      });

      if (!period) {
        throw new BadRequestException('Accounting period not found');
      }
    } else {
      period = await client.accountingPeriod.findFirst({
        where: {
          companyId: input.companyId,
          startDate: { lte: transactionDate },
          endDate: { gte: transactionDate },
        },
        include: { fiscalYear: { select: { id: true, status: true } } },
        orderBy: { startDate: 'desc' },
      });

      if (!period) {
        throw new BadRequestException('No accounting period exists for this transaction date');
      }
    }

    this.assertPeriodAllowsPosting(period, input.companyId, transactionDate);

    await this.assertNoActiveLock(
      {
        companyId: input.companyId,
        accountingPeriodId: period.id,
        fiscalYearId: period.fiscalYearId,
        transactionDate,
        moduleName: input.moduleName,
      },
      client,
    );

    return period;
  }

  private assertPeriodAllowsPosting(
    period: ResolvedAccountingPeriod,
    companyId: string,
    transactionDate: Date,
  ) {
    if (period.companyId !== companyId) {
      throw new BadRequestException('Accounting period does not belong to the journal company');
    }
    if (period.status !== FiscalPeriodStatus.OPEN) {
      throw new BadRequestException('Accounting period is not OPEN');
    }
    if (period.fiscalYear?.status !== FiscalPeriodStatus.OPEN) {
      throw new BadRequestException('Fiscal year is not OPEN');
    }

    const startDate = this.startOfDay(period.startDate);
    const endDate = this.startOfDay(period.endDate);
    if (transactionDate < startDate || transactionDate > endDate) {
      throw new BadRequestException('Transaction date is outside the accounting period');
    }
  }

  private async assertNoActiveLock(
    input: AssertPostingAllowedInput & { fiscalYearId?: string },
    client: AccountingControlClient,
  ) {
    const scopeOr: Prisma.AccountingLockWhereInput[] = [];

    if (input.accountingPeriodId) {
      scopeOr.push({ accountingPeriodId: input.accountingPeriodId });
    }
    if (input.fiscalYearId) {
      // ITMB-048 (finding #11): a PERIOD_LOCK created by closing a single period
      // carries BOTH accountingPeriodId AND fiscalYearId. It must only freeze its
      // own period (handled by the exact-period branch above), never every other
      // OPEN period in the same fiscal year. So only treat a lock as fiscal-year
      // scoped when it is NOT also period-scoped (accountingPeriodId IS NULL).
      // A genuine year-wide lock (no period) still blocks the whole fiscal year.
      scopeOr.push({ accountingPeriodId: null, fiscalYearId: input.fiscalYearId });
    }

    // ITMB-048: a date-window lock should only act company-wide when it is NOT
    // scoped to a specific period or fiscal year. Period-/fiscal-year-scoped
    // locks that also carry a date window must only block their own scope
    // (handled by the exact-id branches above), not every posting whose date
    // falls inside the window. Require both scope ids to be null here so a
    // global date-range lock still blocks while scoped locks do not over-block.
    scopeOr.push({
      accountingPeriodId: null,
      fiscalYearId: null,
      AND: [
        { OR: [{ lockedFrom: null }, { lockedFrom: { lte: input.transactionDate } }] },
        { OR: [{ lockedTo: null }, { lockedTo: { gte: input.transactionDate } }] },
      ],
    });

    const moduleNames = input.moduleName
      ? [input.moduleName, 'accounting', 'finance']
      : ['accounting', 'finance'];

    const lock = await client.accountingLock.findFirst({
      where: {
        companyId: input.companyId,
        status: 'ACTIVE',
        deletedAt: null,
        AND: [{ OR: scopeOr }, { OR: [{ moduleName: null }, { moduleName: { in: moduleNames } }] }],
      },
    });

    if (lock) {
      throw new BadRequestException(this.lockMessage(lock));
    }
  }

  private lockMessage(lock: AccountingLock): string {
    if (lock.accountingPeriodId) {
      return 'Accounting period is locked';
    }
    if (lock.moduleName) {
      return `${lock.moduleName} is locked for this transaction date`;
    }
    return 'Accounting is locked for this transaction date';
  }

  private startOfDay(value: Date): Date {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('Transaction date is invalid');
    }
    d.setHours(0, 0, 0, 0);
    return d;
  }
}

export type ResolvedAccountingPeriod = AccountingPeriod & {
  fiscalYear: { id: string; status: FiscalPeriodStatus };
};
