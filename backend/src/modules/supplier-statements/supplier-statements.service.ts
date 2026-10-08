import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, CurrencyCode, Prisma, SupplierStatementRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { dateRangeStart, dateRangeEnd } from '../../common/utils/date-range';
import {
  loadSettlementJournals,
  recoverSettlementHistory,
  reversalJournalSelection,
  summarizeDatedMovements,
} from '../../common/utils/settlement-history';
import { GenerateSupplierStatementDto } from './dto/generate-supplier-statement.dto';
import { QuerySupplierStatementDto } from './dto/query-supplier-statement.dto';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import {
  buildSupplierStatement,
  supplierStatementCsv,
  supplierStatementPdf,
  SupplierStatementMovement,
} from './supplier-statement-export';

const ZERO = new Prisma.Decimal(0);

@Injectable()
export class SupplierStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    // Party linkage (Phase 3): the shared letterhead renderer, optional so the existing
    // specs keep constructing the service; CSV export never needs it.
    private readonly documents?: GeneratedDocumentsService,
  ) {}

  /**
   * Party linkage (Phase 3 PR-6): a statement run's period as a document, with the run's
   * recorded balances and the period's payables (by issue date) and payments (by payment
   * date). Read-only.
   */
  async export(id: string, format: 'pdf' | 'csv', user: AuthUser) {
    const run = await this.findOne(id, user);
    const supplier = run.supplierId
      ? await this.prisma.supplier.findFirst({
          where: { id: run.supplierId },
          select: { id: true, name: true, supplierCode: true },
        })
      : null;
    const ledger = await this.loadMovements(
      run.companyId,
      run.supplierId ?? undefined,
      run.currency as CurrencyCode,
    );
    const periodEnd =
      run.periodEnd.getUTCHours() === 0 && run.periodEnd.getUTCMinutes() === 0
        ? dateRangeEnd(run.periodEnd.toISOString().slice(0, 10))
        : run.periodEnd;
    const totals = summarizeDatedMovements(ledger.movements, run.periodStart, periodEnd);
    if (totals.inPeriod.length > 10000)
      throw new BadRequestException(
        'This statement period has more than 10,000 lines; generate a shorter period to export it.',
      );
    const statement = buildSupplierStatement(
      { ...run, ...totals, periodEnd },
      supplier,
      [],
      [],
      totals.inPeriod,
      ledger.history,
    );
    const base = `supplier-statement-${run.statementRunNumber}`;
    if (format === 'csv')
      return {
        buffer: Buffer.from(supplierStatementCsv(statement), 'utf8'),
        filename: `${base}.csv`,
        mimeType: 'text/csv; charset=utf-8',
      };
    if (!this.documents)
      throw new BadRequestException('PDF export is unavailable in this deployment.');
    const buffer = await this.documents.renderLetterheadPdf(
      { companyId: run.companyId },
      supplierStatementPdf(statement),
      user,
    );
    return { buffer, filename: `${base}.pdf`, mimeType: 'application/pdf' };
  }

  async findAll(query: QuerySupplierStatementDto, user: AuthUser) {
    const { companyId, supplierId, page = 1, limit = 20 } = query;
    const take = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (Number(page) - 1) * take;
    const where: Prisma.SupplierStatementRunWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (supplierId) where.supplierId = supplierId;
    const [data, total] = await Promise.all([
      this.prisma.supplierStatementRun.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          // Party linkage (Phase 2): the run names its supplier so the list can link the profile.
          supplier: { select: { id: true, name: true, supplierCode: true } },
          generatedBy: { select: { id: true, fullName: true, email: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplierStatementRun.count({ where }),
    ]);
    const projected = await Promise.all(data.map((run) => this.projectRun(run)));
    return {
      data: projected,
      total,
      page: Number(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierStatementRun.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        generatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Supplier statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return this.projectRun(item);
  }

  /** Project already-selected runs through the same scoped ledger as statement detail. */
  async projectSavedRuns<T extends SupplierStatementRun>(runs: T[], user: AuthUser) {
    await Promise.all(
      [...new Set(runs.map((run) => run.companyId))].map((companyId) =>
        this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ),
      ),
    );
    const ledgers = new Map<string, ReturnType<SupplierStatementsService['loadMovements']>>();
    return Promise.all(
      runs.map(async (run) => {
        const key = JSON.stringify([run.companyId, run.supplierId, run.currency]);
        let ledger = ledgers.get(key);
        if (!ledger) {
          ledger = this.loadMovements(
            run.companyId,
            run.supplierId ?? undefined,
            run.currency as CurrencyCode,
          );
          ledgers.set(key, ledger);
        }
        return this.projectRun(run, await ledger);
      }),
    );
  }

  async generate(dto: GenerateSupplierStatementDto, user: AuthUser) {
    const periodStart = dateRangeStart(dto.periodStart);
    const periodEnd = dateRangeEnd(dto.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart > periodEnd) {
      throw new BadRequestException('Statement start date cannot be after end date');
    }

    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!supplier) {
        throw new BadRequestException('Supplier does not belong to the selected company');
      }
    }

    // A statement is single-currency by design: summing AP across TZS/USD/… is
    // meaningless. Scope every figure to one currency (default TZS) and persist
    // it on the run so consumers know what the totals are denominated in.
    const currency: CurrencyCode = dto.currency ?? CurrencyCode.TZS;

    const ledger = await this.loadMovements(dto.companyId, dto.supplierId, currency);
    if (ledger.history.status === 'INCOMPLETE') {
      throw new BadRequestException({
        message: 'Statement cannot be generated until settlement history is reconciled',
        settlementHistory: ledger.history,
      });
    }
    const { openingBalance, totalDebits, totalCredits, closingBalance } = summarizeDatedMovements(
      ledger.movements,
      periodStart,
      periodEnd,
    );

    const run = await this.prisma.supplierStatementRun.create({
      data: {
        statementRunNumber: `SSTAT-${Date.now()}`,
        companyId: dto.companyId,
        // NULL = whole-company run (the former "ALL" sentinel is gone; supplierId is a real FK).
        supplierId: dto.supplierId ?? null,
        periodStart,
        periodEnd,
        openingBalance,
        totalDebits,
        totalCredits,
        closingBalance,
        currency,
        generatedById: user.id,
        status: 'GENERATED',
      },
    });

    await this.auditLogs.log({
      action: 'SUPPLIER_STATEMENT_GENERATE',
      entityType: 'SupplierStatementRun',
      entityId: run.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: run as any,
    });
    return run;
  }
  /** The exact same dated AP ledger feeds saved balances and rendered activity. */
  private async loadMovements(
    companyId: string,
    supplierId: string | undefined,
    currency: CurrencyCode,
  ) {
    const scope = { companyId, currency, deletedAt: null, ...(supplierId ? { supplierId } : {}) };
    const [payables, payments] = await Promise.all([
      this.prisma.payable.findMany({
        where: {
          ...scope,
          OR: [{ status: { not: 'CANCELLED' } }, { journalEntryId: { not: null } }],
        },
        select: {
          id: true,
          payableNumber: true,
          issueDate: true,
          amount: true,
          paidAmount: true,
          outstandingAmount: true,
          status: true,
          supplierName: true,
          journalEntryId: true,
        },
        orderBy: { issueDate: 'asc' },
      }),
      this.prisma.supplierPayment.findMany({
        where: {
          ...scope,
          status: { in: ['COMPLETED', 'REVERSED'] },
          OR: [
            { sourceType: { notIn: ['InvoiceDeskInvoice', 'CashDesk'] } },
            { sourceType: null },
            { allocations: { some: {} } },
            { purchaseAdvance: { isNot: null } },
          ],
        },
        select: {
          id: true,
          paymentNumber: true,
          paymentDate: true,
          amount: true,
          method: true,
          reference: true,
          status: true,
          reversedAt: true,
          journalEntryId: true,
          reversalJournalEntryId: true,
          reversalJournalEntry: { select: reversalJournalSelection },
          supplier: { select: { name: true } },
          allocations: { select: { payableId: true, amount: true } },
        },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);
    const documents = payables.map((p) => ({ ...p, reference: p.payableNumber }));
    const recovered = recoverSettlementHistory({
      kind: 'supplier',
      documents,
      journals: await loadSettlementJournals(this.prisma, 'supplier', companyId, documents),
      modernJournalIds: payments.flatMap((p) => [p.journalEntryId, p.reversalJournalEntryId]),
      completedAllocations: payments
        .filter((p) => p.status !== 'REVERSED')
        .flatMap((p) =>
          (p.allocations ?? []).map((a) => ({ documentId: a.payableId, amount: a.amount })),
        ),
    });
    const movements: SupplierStatementMovement[] = [...recovered.movements];
    for (const p of payables)
      movements.push({
        date: p.issueDate,
        type: 'PAYABLE',
        reference: p.payableNumber,
        description: supplierId
          ? 'Payable raised'
          : `Payable raised · ${p.supplierName ?? 'Supplier'}`,
        debit: p.amount,
        credit: ZERO,
      });
    for (const p of payments) {
      movements.push({
        date: p.paymentDate,
        type: 'PAYMENT',
        reference: p.paymentNumber,
        description: [
          'Payment',
          p.method,
          p.reference ? `ref ${p.reference}` : null,
          supplierId ? null : p.supplier?.name,
        ]
          .filter(Boolean)
          .join(' · '),
        debit: ZERO,
        credit: p.amount,
      });
      if (p.status === 'REVERSED') {
        const date =
          p.reversalJournalEntry?.status === 'POSTED'
            ? p.reversalJournalEntry.transactionDate
            : p.reversedAt;
        if (date)
          movements.push({
            date,
            type: 'ADJUSTMENT',
            reference: p.paymentNumber,
            description: `Payment reversal ${p.paymentNumber}`,
            debit: p.amount,
            credit: ZERO,
          });
        else
          recovered.history.gaps.push({
            documentId: p.id,
            reference: p.paymentNumber,
            amount: p.amount.toFixed(2),
            reason: 'Reversed payment has no dated reversal',
          });
      }
    }
    recovered.history.status = recovered.history.gaps.length ? 'INCOMPLETE' : 'COMPLETE';
    recovered.history.unresolvedAmount = recovered.history.gaps
      .reduce((sum, gap) => sum.plus(new Prisma.Decimal(gap.amount).abs()), ZERO)
      .toFixed(2);
    return { movements, history: recovered.history };
  }

  /** Preserve the saved evidence while projecting period-correct balances on every read. */
  private async projectRun<T extends SupplierStatementRun>(
    run: T,
    loadedLedger?: Awaited<ReturnType<SupplierStatementsService['loadMovements']>>,
  ) {
    const ledger =
      loadedLedger ??
      (await this.loadMovements(
        run.companyId,
        run.supplierId ?? undefined,
        run.currency as CurrencyCode,
      ));
    const periodEnd =
      run.periodEnd.getUTCHours() === 0 && run.periodEnd.getUTCMinutes() === 0
        ? dateRangeEnd(run.periodEnd.toISOString().slice(0, 10))
        : run.periodEnd;
    const { openingBalance, totalDebits, totalCredits, closingBalance } = summarizeDatedMovements(
      ledger.movements,
      run.periodStart,
      periodEnd,
    );
    const storedBalances = {
      openingBalance: run.openingBalance,
      totalDebits: run.totalDebits,
      totalCredits: run.totalCredits,
      closingBalance: run.closingBalance,
    };
    const datedBalances = { openingBalance, totalDebits, totalCredits, closingBalance };
    return {
      ...run,
      ...datedBalances,
      storedBalances,
      datedBalances,
      settlementHistory: ledger.history,
    };
  }
}
