import { BadRequestException, Injectable } from '@nestjs/common';
import { CurrencyCode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { DeskReportQuery } from './desk-reports.dto';
import { reportPeriod } from './desk-reports.domain';
import { financingReport, internalReport } from './financing.domain';
import { recordValidatedCompanyScope } from '../../common/context/request-context';

@Injectable()
export class FinancingReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly accounts: AccountResolverService,
  ) {}
  private check(n: number) {
    if (n > 20000)
      throw new BadRequestException(
        'More than 20,000 financing records. Narrow the company or branch scope.',
      );
  }
  private async scope(user: AuthUser, q: DeskReportQuery) {
    return {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { divisionId: q.divisionId, branchId: q.branchId },
      ],
    };
  }
  async borrowings(user: AuthUser, q: DeskReportQuery) {
    const period = reportPeriod(q),
      scope = await this.scope(user, q);
    const includeGroup =
      user.roleScopes?.includes('GROUP') && !q.companyId && !q.divisionId && !q.branchId;
    if (includeGroup) recordValidatedCompanyScope('GROUP');
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.LoanWhereInput = {
          AND: [
            includeGroup ? { OR: [scope, { companyId: null, borrowerLevel: 'GROUP' }] } : scope,
            {
              deletedAt: null,
              currency: q.currency as CurrencyCode | undefined,
              disbursementDate: { lte: new Date(`${period.to}T23:59:59.999Z`) },
            },
          ],
        };
        this.check(await tx.loan.count({ where }));
        this.check(await tx.loanRepayment.count({ where: { loan: where } }));
        const loans = await tx.loan.findMany({
          where,
          include: {
            company: { select: { name: true } },
            group: { select: { name: true } },
            repayments: { include: { financialEvent: true } },
            financialEvents: { include: { reversal: true } },
          },
          orderBy: { id: 'asc' },
        });
        const scheduleWhere = { loanDebtId: { in: loans.map((l) => l.id) } };
        this.check(await tx.loanRepaymentSchedule.count({ where: scheduleWhere }));
        this.check(
          await tx.loanRepaymentPayment.count({
            where: { loanRepaymentSchedule: scheduleWhere, deletedAt: null },
          }),
        );
        const schedules = await tx.loanRepaymentSchedule.findMany({
          where: scheduleWhere,
          include: {
            payments: {
              where: { deletedAt: null },
              include: { financialEvent: { include: { reversal: true } } },
            },
          },
        });
        const principalAccounts = new Map<string, string>();
        for (const companyId of [
          ...new Set(
            schedules
              .filter((s) => s.payments.some((p) => !p.financialEvent))
              .map((s) => s.companyId),
          ),
        ]) {
          try {
            principalAccounts.set(
              companyId,
              (await this.accounts.resolve(companyId, 'LOAN_PRINCIPAL_PAYABLE', tx)).id,
            );
          } catch (error) {
            if (!(error instanceof BadRequestException)) throw error;
          }
        }
        const ids = schedules.flatMap((s) =>
          s.payments.flatMap((p) => (p.journalEntryId ? [p.journalEntryId] : [])),
        );
        const journals = await tx.journalEntry.findMany({
          where: {
            id: { in: ids },
            companyId: { in: [...principalAccounts.keys()] },
            status: 'POSTED',
            deletedAt: null,
          },
          include: { lines: true },
        });
        const byJournal = new Map(journals.map((j) => [j.id, j]));
        const plans = new Map<string, typeof schedules>();
        for (const schedule of schedules) {
          const key = `${schedule.loanDebtId}:${schedule.companyId}`;
          const plan = plans.get(key) ?? [];
          plan.push(schedule);
          plans.set(key, plan);
        }
        const normalized = loans.map((l) => {
          const recognitionReversal = (l.financialEvents ?? []).find(
            (e) => e.kind === 'REVERSAL_OPENING' || e.kind === 'REVERSAL_DISBURSEMENT',
          );
          const closedAtDate =
            recognitionReversal && recognitionReversal.businessDate <= new Date(period.to);
          const plan = closedAtDate
            ? []
            : (plans.get(`${l.id}:${l.companyId}`) ?? []).filter(
                (s) =>
                  !s.deletedAt ||
                  (l.fundingMode && l.fundingMode !== 'LEGACY' && recognitionReversal),
              );
          const funding = (l.financialEvents ?? []).find((e) =>
            ['DISBURSEMENT', 'OPENING'].includes(e.kind),
          );
          return {
            id: l.id,
            reference: l.loanReference || l.lenderName,
            lender: l.lenderName,
            company: l.company?.name || l.group?.name || 'Group',
            currency: l.currency,
            type: l.obligationType,
            status: l.status,
            date: funding?.businessDate ?? l.disbursementDate,
            principalAtDate:
              l.fundingMode && l.fundingMode !== 'LEGACY'
                ? (l.financialEvents ?? [])
                    .filter((e) => e.businessDate <= new Date(`${period.to}T23:59:59.999Z`))
                    .reduce(
                      (n, e) =>
                        n.plus(
                          e.principal.mul(
                            (e.kind.includes('REPAYMENT') ? -1 : 1) * (e.reversalOfId ? -1 : 1),
                          ),
                        ),
                      new Prisma.Decimal(0),
                    )
                : undefined,
            maturity: l.maturityDate,
            current: l.outstandingBalance,
            payments: [
              ...(l.financialEvents ?? [])
                .filter((e) => e.kind.includes('REPAYMENT'))
                .map((e) => ({
                  id: e.id,
                  date: e.businessDate,
                  amount: e.amount.mul(e.reversalOfId ? -1 : 1),
                  principal: e.principal.mul(e.reversalOfId ? -1 : 1),
                  interest: e.interest.mul(e.reversalOfId ? -1 : 1),
                  fees: e.fees.mul(e.reversalOfId ? -1 : 1),
                  penalties: e.penalties.mul(e.reversalOfId ? -1 : 1),
                  reversal: !!e.reversalOfId,
                  reference: e.reversalOfId ? 'Payment reversal' : 'Loan payment',
                  currency: e.currency,
                })),
              ...l.repayments
                .filter((p) => !p.financialEvent)
                .map((p) => ({
                  id: p.id,
                  date: p.repaymentDate,
                  amount: p.amount,
                  principal: p.principal ?? p.amount,
                  reference: p.referenceNumber || '',
                  currency: p.currency,
                })),
              ...plan.flatMap((s) =>
                s.payments
                  .filter((p) => !p.financialEvent)
                  .map((p) => {
                    const journal = p.journalEntryId ? byJournal.get(p.journalEntryId) : undefined;
                    const lines =
                      journal?.companyId === l.companyId && journal.referenceId === s.id
                        ? journal.lines.filter(
                            (line) => line.accountId === principalAccounts.get(s.companyId),
                          )
                        : [];
                    const principal = lines.length
                      ? lines.reduce(
                          (n, line) => n.plus(line.debit).minus(line.credit),
                          new Prisma.Decimal(0),
                        )
                      : null;
                    return {
                      id: p.id,
                      date: p.paymentDate,
                      amount: p.amount,
                      principal,
                      reference: p.reference || p.repaymentPaymentNumber,
                      currency: p.currency,
                    };
                  }),
              ),
            ],
            installments: plan.map((s) => ({
              id: s.id,
              due: s.dueDate,
              amount: s.totalAmount,
              payments: s.payments.flatMap((p) => [
                { date: p.paymentDate, amount: p.amount },
                ...(p.financialEvent?.reversal
                  ? [{ date: p.financialEvent.reversal.businessDate, amount: p.amount.negated() }]
                  : []),
              ]),
            })),
          };
        });
        return financingReport(normalized, q);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  async internal(user: AuthUser, q: DeskReportQuery) {
    const period = reportPeriod(q),
      selected = await this.scope(user, q),
      accessible = await this.scope(user, {});
    return this.db.$transaction(
      async (tx) => {
        const where: Prisma.CashDeskLoanWhereInput = {
          currency: q.currency,
          loanDate: { lte: new Date(period.to) },
          OR: [{ lender: selected }, { borrower: selected }],
        };
        this.check(await tx.cashDeskLoan.count({ where }));
        this.check(
          await tx.cashDeskMovement.count({
            where: { loan: where, kind: 'LOAN_REPAYMENT' },
          }),
        );
        const loans = await tx.cashDeskLoan.findMany({
          where,
          include: {
            lender: { include: { company: { select: { name: true } } } },
            borrower: { include: { company: { select: { name: true } } } },
            movements: {
              where: { kind: { in: ['LOAN', 'LOAN_REPAYMENT'] } },
              include: { reversal: true },
            },
          },
          orderBy: { id: 'asc' },
        });
        const involved = {
          id: { in: loans.flatMap((l) => [l.lenderAccountId, l.borrowerAccountId]) },
        };
        const accounts = await tx.cashDeskAccount.findMany({
          where: { AND: [accessible, involved] },
          select: { id: true },
        });
        const selectedAccounts = await tx.cashDeskAccount.findMany({
          where: { AND: [selected, involved] },
          select: { id: true },
        });
        const visible = new Set(accounts.map((a) => a.id));
        return internalReport(
          loans.map((l) => ({
            id: l.id,
            currency: l.currency,
            principal: l.principal,
            recognitionReversalDate: l.movements.find((p) => p.kind === 'LOAN')?.reversal
              ?.businessDate,
            current: l.outstanding,
            date: l.loanDate,
            due: l.dueDate,
            description: l.description,
            lenderId: l.lenderAccountId,
            borrowerId: l.borrowerAccountId,
            lender: visible.has(l.lenderAccountId)
              ? `${l.lender.company.name} · ${l.lender.name}`
              : 'Counterparty outside your access',
            borrower: visible.has(l.borrowerAccountId)
              ? `${l.borrower.company.name} · ${l.borrower.name}`
              : 'Counterparty outside your access',
            payments: l.movements
              .filter((p) => p.kind === 'LOAN_REPAYMENT')
              .flatMap((p) => {
                const original = {
                  id: p.id,
                  date: p.businessDate,
                  amount: p.amount,
                  principal: p.loanPrincipal ?? p.amount,
                  interest: p.loanInterest ?? new Prisma.Decimal(0),
                  fees: p.loanFees ?? new Prisma.Decimal(0),
                  reference: p.reference,
                };
                return [
                  original,
                  ...(p.reversal
                    ? [
                        {
                          ...original,
                          id: p.reversal.id,
                          date: p.reversal.businessDate,
                          amount: original.amount.negated(),
                          principal: original.principal.negated(),
                          interest: original.interest.negated(),
                          fees: original.fees.negated(),
                          reference: 'Reversal · ' + p.reference,
                        },
                      ]
                    : []),
                ];
              }),
          })),
          new Set(selectedAccounts.map((a) => a.id)),
          q,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
}
