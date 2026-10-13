import { AccountType } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AuthUser } from '../src/common/decorators/current-user.decorator';
import { CustomerStatementsService } from '../src/modules/customer-statements/customer-statements.service';
import { canonicalJson } from '../src/modules/msaidizi/crud-execution-evidence';
import { PrismaService } from '../src/prisma/prisma.service';

export interface CrudCustomerAccountReadSeed {
  customerA: string;
  customerB: string;
  paymentA: string;
  paymentB: string;
  statementA: string;
  statementB: string;
}

/** Real posted sources and service-issued snapshots, owned by the disposable
 * schema. Setup completes before the read mutation sentinel is captured. */
export async function seedCrudCustomerAccountReadControls(
  prisma: PrismaService,
  statements: CustomerStatementsService,
  scope: {
    companyAId: string;
    companyBId: string;
    divisionAId: string;
    divisionBId: string;
    branchAId: string;
    branchBId: string;
    suffix: string;
  },
  issuer: AuthUser,
): Promise<CrudCustomerAccountReadSeed> {
  const seed = async (
    side: 'A' | 'B',
    companyId: string,
    divisionId: string,
    branchId: string,
    invoiceAmount: number,
    paymentAmount: number,
  ) => {
    const source = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          companyId,
          divisionId,
          branchId,
          customerCode: `CE-ACCOUNT-${side}-${scope.suffix}`,
          name: `CRUD Customer Account ${side} ${scope.suffix}`,
          currentBalance: invoiceAmount - paymentAmount,
        },
      });
      const [cash, ar, income] = await Promise.all([
        tx.chartOfAccount.create({
          data: {
            companyId,
            accountCode: `CE-ACCOUNT-CASH-${side}-${scope.suffix}`,
            accountName: 'Customer account evidence cash',
            accountType: AccountType.ASSET,
            accountSubType: 'CASH_ON_HAND',
          },
        }),
        tx.chartOfAccount.create({
          data: {
            companyId,
            accountCode: `CE-ACCOUNT-AR-${side}-${scope.suffix}`,
            accountName: 'Customer account evidence receivables',
            accountType: AccountType.ASSET,
            accountSubType: 'AR_CONTROL',
          },
        }),
        tx.chartOfAccount.create({
          data: {
            companyId,
            accountCode: `CE-ACCOUNT-INCOME-${side}-${scope.suffix}`,
            accountName: 'Customer account evidence income',
            accountType: AccountType.INCOME,
          },
        }),
      ]);
      const receivableId = randomUUID(),
        paymentId = randomUUID();
      const journal = async (
        kind: 'Receivable' | 'CustomerPayment',
        referenceId: string,
        transactionDate: Date,
        amount: number,
        debitAccountId: string,
        creditAccountId: string,
      ) =>
        tx.journalEntry.create({
          data: {
            companyId,
            divisionId,
            branchId,
            journalNumber: `CE-ACCOUNT-${kind}-${side}-${scope.suffix}`,
            description: `Reviewed ${kind} source for customer account read evidence`,
            referenceType: kind,
            referenceId,
            transactionDate,
            status: 'POSTED',
            postedAt: transactionDate,
            postedById: issuer.id,
            createdById: issuer.id,
            totalDebit: amount,
            totalCredit: amount,
            lines: {
              create: [
                {
                  companyId,
                  divisionId,
                  branchId,
                  accountId: debitAccountId,
                  debit: amount,
                  ...(debitAccountId === ar.id
                    ? { partyType: 'CUSTOMER', customerId: customer.id }
                    : {}),
                },
                {
                  companyId,
                  divisionId,
                  branchId,
                  accountId: creditAccountId,
                  credit: amount,
                  ...(creditAccountId === ar.id
                    ? { partyType: 'CUSTOMER', customerId: customer.id }
                    : {}),
                },
              ],
            },
          },
        });
      const invoiceDate = new Date('2026-08-10T00:00:00.000Z');
      const paymentDate = new Date('2026-08-20T00:00:00.000Z');
      const invoiceJournal = await journal(
        'Receivable',
        receivableId,
        invoiceDate,
        invoiceAmount,
        ar.id,
        income.id,
      );
      await tx.receivable.create({
        data: {
          id: receivableId,
          companyId,
          divisionId,
          branchId,
          customerId: customer.id,
          customerName: customer.name,
          receivableNumber: `CE-ACCOUNT-INVOICE-${side}-${scope.suffix}`,
          issueDate: invoiceDate,
          dueDate: new Date('2026-08-25T00:00:00.000Z'),
          amount: invoiceAmount,
          paidAmount: paymentAmount,
          outstandingAmount: invoiceAmount - paymentAmount,
          currency: 'TZS',
          status: 'PARTIALLY_PAID',
          journalEntryId: invoiceJournal.id,
        },
      });
      const paymentJournal = await journal(
        'CustomerPayment',
        paymentId,
        paymentDate,
        paymentAmount,
        cash.id,
        ar.id,
      );
      const payment = await tx.customerPayment.create({
        data: {
          id: paymentId,
          companyId,
          divisionId,
          branchId,
          customerId: customer.id,
          paymentNumber: `CE-ACCOUNT-PAYMENT-${side}-${scope.suffix}`,
          paymentDate,
          amount: paymentAmount,
          appliedAmount: paymentAmount,
          unappliedAmount: 0,
          currency: 'TZS',
          status: 'COMPLETED',
          method: 'CASH',
          journalEntryId: paymentJournal.id,
          createdById: issuer.id,
          allocations: {
            create: { receivableId, amount: paymentAmount, companyId, createdAt: paymentDate },
          },
        },
      });
      return { customer, payment };
    });
    const issued = await statements.generate(
      {
        companyId,
        customerId: source.customer.id,
        currency: 'TZS',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
      },
      issuer,
    );
    const retained = await prisma.customerStatementRun.findUniqueOrThrow({
      where: { id: issued.id },
    });
    const expectedBalance = (invoiceAmount - paymentAmount).toFixed(2);
    if (
      !retained.snapshot ||
      !retained.pdfContent?.length ||
      retained.snapshotHash !==
        createHash('sha256').update(canonicalJson(retained.snapshot)).digest('hex') ||
      (retained.snapshot as Record<string, unknown>).closingBalance !== expectedBalance ||
      (retained.snapshot as Record<string, unknown>).pdfSha256 !==
        createHash('sha256').update(retained.pdfContent).digest('hex')
    ) {
      throw new Error(
        `Customer account ${side} did not retain the service-issued statement and matching PDF.`,
      );
    }
    const audit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'CustomerStatementRun',
        entityId: retained.id,
        action: 'GENERATE',
        userId: issuer.id,
        companyId,
      },
    });
    if (!audit)
      throw new Error(`Customer account ${side} statement is missing its issuance audit.`);
    return { customer: source.customer.id, payment: source.payment.id, statement: retained.id };
  };
  const a = await seed('A', scope.companyAId, scope.divisionAId, scope.branchAId, 1000, 125);
  const b = await seed('B', scope.companyBId, scope.divisionBId, scope.branchBId, 3000, 777);
  return {
    customerA: a.customer,
    customerB: b.customer,
    paymentA: a.payment,
    paymentB: b.payment,
    statementA: a.statement,
    statementB: b.statement,
  };
}
