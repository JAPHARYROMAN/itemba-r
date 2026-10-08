import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AccessLevel, CurrencyCode, Prisma, CustomerStatementRun } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { EmailService } from '../../common/services/email.service';
import { PrintEngineService } from '../print-engine/print-engine.service';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { utcToday } from '../../common/utils/source-settlement';
import { GenerateCustomerStatementDto } from './dto/generate-customer-statement.dto';
import { QueryCustomerStatementDto } from './dto/query-customer-statement.dto';
import { DetailStatementQueryDto } from './dto/detail-statement.dto';
import { ExportStatementDto } from './dto/export-statement.dto';
import { EmailStatementDto } from './dto/email-statement.dto';
import { CustomerStatement, StatementAging, StatementLine } from './statement.types';
import {
  loadSettlementJournals,
  recoverSettlementHistory,
  reversalJournalSelection,
  summarizeDatedMovements,
} from '../../common/utils/settlement-history';

const ZERO = new Prisma.Decimal(0);
const DAY_MS = 1000 * 60 * 60 * 24;

interface StatementSelection {
  companyId: string;
  customerId: string;
  dateFrom: string;
  dateTo: string;
  currency?: string;
}

@Injectable()
export class CustomerStatementsService {
  private readonly logger = new Logger(CustomerStatementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    // Optional so existing 3-arg constructions (e.g. the cross-company
    // isolation regression spec that only exercises findAll) keep compiling.
    // NestJS DI always injects both at runtime; the detail/export/email paths
    // guard against a missing injection defensively.
    private readonly printEngine?: PrintEngineService,
    private readonly email?: EmailService,
  ) {}

  // Saved runs retain their original evidence and expose recomputed dated balances.

  async findAll(query: QueryCustomerStatementDto, user: AuthUser) {
    const { companyId, customerId, page = 1, limit = 20 } = query;
    const take = Math.min(Math.max(Number(limit), 1), 100);
    const skip = (Number(page) - 1) * take;
    const where: Prisma.CustomerStatementRunWhereInput = {
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (customerId) where.customerId = customerId;
    const [data, total] = await Promise.all([
      this.prisma.customerStatementRun.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          generatedBy: { select: { id: true, fullName: true, email: true } },
        },
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customerStatementRun.count({ where }),
    ]);
    const projected = await Promise.all(data.map((run) => this.projectRun(run)));
    return {
      data: projected,
      items: projected,
      total,
      page: Number(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.customerStatementRun.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, name: true, code: true } },
        generatedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!item) throw new NotFoundException('Customer statement run not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return this.projectRun(item);
  }

  /** Project already-selected runs through the same scoped ledger as statement detail. */
  async projectSavedRuns<T extends CustomerStatementRun>(runs: T[], user: AuthUser) {
    await Promise.all(
      [...new Set(runs.map((run) => run.companyId))].map((companyId) =>
        this.companyScope.assertCanAccessCompany(user, companyId, AccessLevel.READ),
      ),
    );
    const ledgers = new Map<string, ReturnType<CustomerStatementsService['loadMovements']>>();
    return Promise.all(
      runs.map(async (run) => {
        const key = JSON.stringify([run.companyId, run.customerId, run.currency]);
        let ledger = ledgers.get(key);
        if (!ledger) {
          ledger = this.loadMovements(
            run.companyId,
            run.customerId ?? undefined,
            run.currency as CurrencyCode,
          );
          ledgers.set(key, ledger);
        }
        return this.projectRun(run, await ledger);
      }),
    );
  }

  async generate(dto: GenerateCustomerStatementDto, user: AuthUser) {
    const periodStart = dateRangeStart(dto.periodStart);
    const periodEnd = dateRangeEnd(dto.periodEnd);
    if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodStart > periodEnd) {
      throw new BadRequestException('Statement start date cannot be after end date');
    }

    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);

    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId: dto.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer does not belong to the selected company');
      }
    }

    // A statement must never sum across currencies. Scope every source to a
    // single currency (base TZS by default) and persist it on the run.
    const currency: CurrencyCode = dto.currency ?? CurrencyCode.TZS;

    // Net the SAME movement set the detail path (buildStatement) uses —
    // receivables (debit), COMPLETED customer payments (credit), ISSUED credit
    // notes (credit) and PAID cash refunds (debit) — with a real opening
    // balance from strictly-before-period activity. This replaces the legacy
    // receivable.paidAmount aggregate, which ignored credit notes/refunds and
    // counted cumulative (not period-scoped) payments.
    const { openingBalance, totalDebits, totalCredits, closingBalance } = await this.netMovements({
      companyId: dto.companyId,
      customerId: dto.customerId,
      currency,
      periodStart,
      periodEnd,
    });

    const run = await this.prisma.customerStatementRun.create({
      data: {
        statementRunNumber: `CSTAT-${Date.now()}`,
        companyId: dto.companyId,
        // NULL = whole-company run (the former "ALL" sentinel is gone; customerId is a real FK).
        customerId: dto.customerId ?? null,
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
      action: 'GENERATE',
      entityType: 'CustomerStatementRun',
      entityId: run.id,
      userId: user.id,
      companyId: dto.companyId,
      newValue: run as any,
    });
    return run;
  }

  /**
   * Compute the reconciling summary totals for the persisted statement run.
   *
   * Nets the same movement set as {@link buildStatement} — original receivables (debit), dated payments and legacy settlement
   * journals (credit), credit notes, cash refunds, write-offs and their dated reversals — so the saved CustomerStatementRun ties out to the detail
   * statement and the customer's real balance:
   *   closingBalance === openingBalance + totalDebits - totalCredits
   *
   * `customerId` is optional (a whole-company run, stored with customerId NULL, nets across every
   * customer). Every source is scoped to `companyId` and a single `currency`
   * (statements never sum across currencies). Opening balance is the net of all
   * activity strictly BEFORE `periodStart`; debits/credits are the in-period
   * movements only, so post-period payments never leak in.
   */
  private async netMovements(args: {
    companyId: string;
    customerId?: string;
    currency: CurrencyCode;
    periodStart: Date;
    periodEnd: Date;
  }) {
    const ledger = await this.loadMovements(args.companyId, args.customerId, args.currency);
    if (ledger.history.status === 'INCOMPLETE') {
      throw new BadRequestException({
        message: 'Statement cannot be generated until settlement history is reconciled',
        settlementHistory: ledger.history,
      });
    }
    return summarizeDatedMovements(ledger.movements, args.periodStart, args.periodEnd);
  }

  /** Full dated history: cumulative paid amounts are diagnostic, never dated credits. */
  private async loadMovements(
    companyId: string,
    customerId: string | undefined,
    currency: CurrencyCode,
  ) {
    const scope = { companyId, currency, ...(customerId ? { customerId } : {}) };
    const journal = {
      select: {
        ...reversalJournalSelection,
        reversedBy_: {
          where: { companyId, deletedAt: null, status: 'POSTED' as const },
          select: reversalJournalSelection,
        },
      },
    };
    const [receivables, payments, creditNotes, refunds] = await Promise.all([
      this.prisma.receivable.findMany({
        where: {
          ...scope,
          deletedAt: null,
          OR: [{ status: { not: 'CANCELLED' } }, { journalEntryId: { not: null } }],
        },
        select: {
          id: true,
          receivableNumber: true,
          amount: true,
          paidAmount: true,
          issueDate: true,
          dueDate: true,
          outstandingAmount: true,
          status: true,
          journalEntryId: true,
          sourceType: true,
          sourceId: true,
        },
        orderBy: { issueDate: 'asc' },
      }),
      this.prisma.customerPayment.findMany({
        where: { ...scope, deletedAt: null, status: { in: ['COMPLETED', 'REVERSED'] } },
        select: {
          id: true,
          paymentNumber: true,
          amount: true,
          paymentDate: true,
          reference: true,
          status: true,
          reversedAt: true,
          journalEntryId: true,
          reversalJournalEntryId: true,
          reversalJournalEntry: { select: reversalJournalSelection },
          allocations: { select: { receivableId: true, amount: true } },
        },
        orderBy: { paymentDate: 'asc' },
      }),
      this.prisma.creditNote.findMany({
        where: { ...scope, deletedAt: null, status: { in: ['ISSUED', 'VOID'] } },
        select: {
          id: true,
          creditNoteNumber: true,
          totalAmount: true,
          issueDate: true,
          reason: true,
          status: true,
          journalEntryId: true,
          journalEntry: journal,
        },
        orderBy: { issueDate: 'asc' },
      }),
      this.prisma.refund.findMany({
        where: { ...scope, deletedAt: null, status: { in: ['PAID', 'VOID'] } },
        select: {
          id: true,
          refundNumber: true,
          amount: true,
          refundDate: true,
          reason: true,
          status: true,
          journalEntryId: true,
          reversalJournalEntryId: true,
          journalEntry: journal,
        },
        orderBy: { refundDate: 'asc' },
      }),
    ]);
    const refundReversalIds = refunds.flatMap((r) =>
      r.status === 'VOID' && r.reversalJournalEntryId ? [r.reversalJournalEntryId] : [],
    );
    const refundReversals = refundReversalIds.length
      ? await this.prisma.journalEntry.findMany({
          where: {
            id: { in: refundReversalIds },
            companyId,
            deletedAt: null,
            status: 'POSTED',
          },
          select: reversalJournalSelection,
        })
      : [];
    const refundReversalById = new Map(refundReversals.map((j) => [j.id, j]));
    const documents = receivables.map((r) => ({ ...r, reference: r.receivableNumber }));
    const recovered = recoverSettlementHistory({
      kind: 'customer',
      documents,
      journals: await loadSettlementJournals(this.prisma, 'customer', companyId, documents),
      modernJournalIds: payments.flatMap((p) => [p.journalEntryId, p.reversalJournalEntryId]),
      completedAllocations: payments
        .filter((p) => p.status !== 'REVERSED')
        .flatMap((p) =>
          (p.allocations ?? []).map((a) => ({ documentId: a.receivableId, amount: a.amount })),
        ),
    });
    const movements: StatementLine[] = [...recovered.movements];
    const add = (
      date: Date,
      type: StatementLine['type'],
      reference: string,
      description: string,
      sourceId: string,
      debit: Prisma.Decimal,
      credit: Prisma.Decimal,
    ) => {
      movements.push({
        date,
        type,
        reference,
        description,
        sourceId,
        debit,
        credit,
        balance: ZERO,
      });
    };
    const missingReversal = (id: string, reference: string, amount: Prisma.Decimal) => {
      recovered.history.gaps.push({
        documentId: id,
        reference,
        amount: amount.toFixed(2),
        reason: 'Reversed or voided transaction has no dated accounting reversal',
      });
    };
    for (const r of receivables)
      add(
        r.issueDate,
        'INVOICE',
        r.receivableNumber,
        `Invoice ${r.receivableNumber}`,
        r.id,
        r.amount,
        ZERO,
      );
    for (const p of payments) {
      add(
        p.paymentDate,
        'PAYMENT',
        p.paymentNumber,
        p.reference ? `Payment ${p.paymentNumber} (${p.reference})` : `Payment ${p.paymentNumber}`,
        p.id,
        ZERO,
        p.amount,
      );
      if (p.status === 'REVERSED') {
        const date =
          p.reversalJournalEntry?.status === 'POSTED'
            ? p.reversalJournalEntry.transactionDate
            : p.reversedAt;
        if (date)
          add(
            date,
            'ADJUSTMENT',
            p.paymentNumber,
            `Payment reversal ${p.paymentNumber}`,
            p.reversalJournalEntryId ?? p.id,
            p.amount,
            ZERO,
          );
        else missingReversal(p.id, p.paymentNumber, p.amount);
      }
    }
    for (const c of creditNotes) {
      if (c.status === 'VOID' && !c.journalEntryId) continue;
      add(
        c.issueDate,
        'CREDIT_NOTE',
        c.creditNoteNumber,
        c.reason
          ? `Credit note ${c.creditNoteNumber} (${c.reason})`
          : `Credit note ${c.creditNoteNumber}`,
        c.id,
        ZERO,
        c.totalAmount,
      );
      if (c.status === 'VOID') {
        const reversal = c.journalEntry?.reversedBy_?.[0];
        if (reversal)
          add(
            reversal.transactionDate,
            'ADJUSTMENT',
            c.creditNoteNumber,
            `Credit note reversal ${c.creditNoteNumber}`,
            reversal.id,
            c.totalAmount,
            ZERO,
          );
        else missingReversal(c.id, c.creditNoteNumber, c.totalAmount);
      }
    }
    for (const r of refunds) {
      if (r.status === 'VOID' && !r.journalEntryId) continue;
      add(
        r.refundDate,
        'REFUND',
        r.refundNumber,
        r.reason ? `Refund ${r.refundNumber} (${r.reason})` : `Refund ${r.refundNumber}`,
        r.id,
        r.amount,
        ZERO,
      );
      if (r.status === 'VOID') {
        const reversal =
          refundReversalById.get(r.reversalJournalEntryId ?? '') ??
          r.journalEntry?.reversedBy_?.[0];
        if (reversal)
          add(
            reversal.transactionDate,
            'ADJUSTMENT',
            r.refundNumber,
            `Refund reversal ${r.refundNumber}`,
            reversal.id,
            ZERO,
            r.amount,
          );
        else missingReversal(r.id, r.refundNumber, r.amount);
      }
    }
    recovered.history.status = recovered.history.gaps.length ? 'INCOMPLETE' : 'COMPLETE';
    recovered.history.unresolvedAmount = recovered.history.gaps
      .reduce((sum, gap) => sum.plus(new Prisma.Decimal(gap.amount).abs()), ZERO)
      .toFixed(2);
    return { receivables, movements, history: recovered.history };
  }

  // ─── Professional statement of account (detail) ──────────────────────────────

  /**
   * Public detail endpoint: full statement of account for one customer over a
   * range — opening balance, chronological ledger lines with running balance,
   * closing balance, and a LIVE aging summary (see `agingAsOf`). Read-only;
   * company scoped (assertCanAccessCompany + companyId in every query).
   *
   * Note: the ledger figures (opening/closing/lines) are period-correct as of
   * `dateTo`, but the aging block is a current snapshot of what the customer
   * owes today — it is NOT reconstructed as-of `dateTo` and, for a backdated
   * statement, will not tie out to `closingBalance`.
   */
  async getDetail(query: DetailStatementQueryDto, user: AuthUser) {
    return this.serializeStatement(await this.buildStatement(query, user));
  }

  /**
   * Core computation. Returns a Decimal-typed statement so downstream callers
   * (export/email/spec) can assert exact money reconciliation:
   *   openingBalance + totalDebits - totalCredits === closingBalance.
   *
   * Sign convention (customer AR ledger — what the customer owes us):
   *   DEBIT raises balance: original invoices, cash refunds, reversed settlements.
   *   CREDIT lowers balance: payments, credit notes, write-offs and cancellations.
   *   Reversals affect their own dates; later lifecycle changes never erase history.
   *
   * Scoped to a single currency (base TZS by default) exactly like the persisted
   * generate()/netMovements path so the detail statement reconciles with the
   * saved CustomerStatementRun.
   */
  async buildStatement(sel: StatementSelection, user: AuthUser): Promise<CustomerStatement> {
    await this.companyScope.assertCanAccessCompany(user, sel.companyId, AccessLevel.READ);

    const from = dateRangeStart(sel.dateFrom);
    const to = dateRangeEnd(sel.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid dateFrom / dateTo');
    }
    if (from > to) {
      throw new BadRequestException('dateFrom cannot be after dateTo');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: sel.customerId, companyId: sel.companyId, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
    if (!customer) {
      throw new NotFoundException('Customer does not belong to the selected company');
    }

    // Pull every ledger-affecting movement up to and including `to`, then split
    // into pre-period (opening) vs in-period. One fetch per source keeps the
    // company+customer scope explicit on each query. A statement must never sum
    // across currencies, so — exactly like the persisted generate()/netMovements
    // path — scope every source to a single currency (base TZS by default) so
    // the detail statement reconciles with the saved run.
    const currency: CurrencyCode = this.resolveCurrency(sel.currency);
    const { receivables, movements, history } = await this.loadMovements(
      sel.companyId,
      sel.customerId,
      currency,
    );

    // Chronological, with a stable secondary sort so equal-dated lines are
    // deterministic (invoices before the credits that offset them, etc.).
    const typeRank: Record<StatementLine['type'], number> = {
      INVOICE: 0,
      REFUND: 1,
      PAYMENT: 2,
      CREDIT_NOTE: 3,
      ADJUSTMENT: 4,
    };
    movements.sort((a, b) => {
      const d = a.date.getTime() - b.date.getTime();
      if (d !== 0) return d;
      const t = typeRank[a.type] - typeRank[b.type];
      if (t !== 0) return t;
      return a.reference.localeCompare(b.reference);
    });

    const { openingBalance, totalDebits, totalCredits, closingBalance, inPeriod } =
      summarizeDatedMovements(movements, from, to);
    let running = openingBalance;
    for (const line of inPeriod) {
      running = running.plus(line.debit).minus(line.credit);
      line.balance = running;
    }

    // Aging is a LIVE snapshot, NOT period-consistent. It is fed each
    // receivable's current `outstandingAmount`, which already reflects
    // payments / credit notes applied AFTER `dateTo`. We therefore age it
    // as of TODAY (not `dateTo`) and label it with `agingAsOf` so consumers
    // know it describes the current position, not the position at `dateTo`.
    // For a same-day statement (`dateTo` effectively today) this is a no-op.
    // A true as-of-`dateTo` reconstruction would require rewinding each
    // receivable's outstanding balance over the movement history and is
    // deliberately out of scope here.
    const agingAsOf = new Date();
    const aging = this.computeAging(
      receivables.map((r) => ({
        outstandingAmount: r.outstandingAmount,
        dueDate: r.dueDate,
        status: r.status,
      })),
      agingAsOf,
    );

    return {
      companyId: sel.companyId,
      customerId: sel.customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      currency,
      dateFrom: from,
      dateTo: to,
      openingBalance,
      totalDebits,
      totalCredits,
      closingBalance,
      lineCount: inPeriod.length,
      lines: inPeriod,
      settlementHistory: history,
      aging,
      agingAsOf,
      generatedAt: new Date(),
    };
  }

  /**
   * Age open receivables into days-past-due bands as of `asOf` (a LIVE
   * snapshot — see caller: `asOf` is today, and `outstandingAmount` is the
   * current balance). Bucket boundaries are IDENTICAL to
   * FinancialReportsService.getCustomerAgingDetail
   * (days <= 0 -> current, <= 30, <= 60, <= 90, else over90; null due = current)
   * so statement aging ties out to the current aging reports.
   */
  private computeAging(
    rows: Array<{ outstandingAmount: Prisma.Decimal; dueDate: Date | null; status: string }>,
    asOf: Date,
  ): StatementAging {
    const buckets: StatementAging = {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      over90: 0,
      total: 0,
      oldestDaysOverdue: 0,
    };
    const OPEN_STATUSES = new Set(['OPEN', 'PARTIALLY_PAID', 'OVERDUE']);
    for (const r of rows) {
      if (!OPEN_STATUSES.has(r.status)) continue;
      const amount = Number(r.outstandingAmount);
      if (amount === 0) continue;
      const days = r.dueDate
        ? Math.floor((utcToday(asOf).getTime() - utcToday(r.dueDate).getTime()) / DAY_MS)
        : 0;
      if (days <= 0) buckets.current += amount;
      else if (days <= 30) buckets.days1_30 += amount;
      else if (days <= 60) buckets.days31_60 += amount;
      else if (days <= 90) buckets.days61_90 += amount;
      else buckets.over90 += amount;
      buckets.total += amount;
      buckets.oldestDaysOverdue = Math.max(buckets.oldestDaysOverdue, Math.max(0, days));
    }
    return buckets;
  }

  private serializeStatement(s: CustomerStatement) {
    return {
      companyId: s.companyId,
      customerId: s.customerId,
      customerName: s.customerName,
      customerEmail: s.customerEmail,
      currency: s.currency,
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
      openingBalance: s.openingBalance.toFixed(2),
      totalDebits: s.totalDebits.toFixed(2),
      totalCredits: s.totalCredits.toFixed(2),
      closingBalance: s.closingBalance.toFixed(2),
      lineCount: s.lineCount,
      lines: s.lines.map((l) => ({
        date: l.date,
        type: l.type,
        reference: l.reference,
        description: l.description,
        sourceId: l.sourceId,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        balance: l.balance.toFixed(2),
      })),
      settlementHistory: s.settlementHistory,
      aging: s.aging,
      agingAsOf: s.agingAsOf,
      generatedAt: s.generatedAt,
    };
  }

  // ─── Export (PDF / Excel) ────────────────────────────────────────────────────

  async exportPdf(dto: ExportStatementDto, user: AuthUser) {
    const statement = await this.buildStatement(dto, user);
    const result = await this.renderPdf(statement, dto.templateId, user);
    await this.auditLogs.log({
      action: 'EXPORT',
      entityType: 'CustomerStatement',
      entityId: statement.customerId,
      userId: user.id,
      companyId: statement.companyId,
      metadata: {
        format: 'PDF',
        filename: result.filename,
        documentId: result.documentId,
        dateFrom: statement.dateFrom.toISOString(),
        dateTo: statement.dateTo.toISOString(),
      } as any,
    });
    return result;
  }

  async exportExcel(dto: ExportStatementDto, user: AuthUser) {
    const statement = await this.buildStatement(dto, user);
    const result = await this.renderExcel(statement, dto.templateId, user);
    await this.auditLogs.log({
      action: 'EXPORT',
      entityType: 'CustomerStatement',
      entityId: statement.customerId,
      userId: user.id,
      companyId: statement.companyId,
      metadata: {
        format: 'EXCEL',
        filename: result.filename,
        documentId: result.documentId,
        dateFrom: statement.dateFrom.toISOString(),
        dateTo: statement.dateTo.toISOString(),
      } as any,
    });
    return result;
  }

  /**
   * Render a PDF. When `templateId` is supplied we delegate to the print-engine
   * (it fills the stored DocumentTemplate body and persists a GeneratedDocument),
   * passing the statement as structured pdfSections so the engine's own pdfkit
   * pipeline lays it out. When no template is given we fall back to the same
   * pdfkit library locally so export never hard-depends on a seeded template.
   */
  private async renderPdf(
    statement: CustomerStatement,
    templateId: string | undefined,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string; documentId?: string }> {
    const sections = this.pdfSections(statement);
    if (templateId && this.printEngine) {
      const r = await this.printEngine.renderPdf(
        {
          templateId,
          entityType: 'CustomerStatement',
          entityId: statement.customerId,
          data: this.templateData(statement),
          pdfSections: sections,
        },
        user,
      );
      return {
        buffer: r.buffer,
        filename: r.filename,
        mimeType: r.mimeType,
        documentId: r.id,
      };
    }
    const buffer = await this.buildPdfBuffer(statement, sections);
    return {
      buffer,
      filename: this.statementFilename(statement, 'pdf'),
      mimeType: 'application/pdf',
    };
  }

  private async renderExcel(
    statement: CustomerStatement,
    templateId: string | undefined,
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string; documentId?: string }> {
    const sheetData = this.sheetRows(statement);
    if (templateId && this.printEngine) {
      const r = await this.printEngine.renderExcel(
        {
          templateId,
          entityType: 'CustomerStatement',
          entityId: statement.customerId,
          data: this.templateData(statement),
          sheetName: 'Statement',
          sheetData,
        },
        user,
      );
      return {
        buffer: r.buffer,
        filename: r.filename,
        mimeType: r.mimeType,
        documentId: r.id,
      };
    }
    const buffer = await this.buildExcelBuffer(statement, sheetData);
    return {
      buffer,
      filename: this.statementFilename(statement, 'xlsx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ─── Email to customer ───────────────────────────────────────────────────────

  /**
   * Render the statement PDF and email it to the customer. Uses the shared
   * EmailService; if SMTP is not configured that service no-ops + logs, so this
   * still resolves with `emailed: false` (no throw). The PDF is embedded as a
   * base64 download link in the HTML body — the shared EmailService.sendEmail
   * signature does not expose MIME attachments, so a true attachment requires a
   * future EmailService extension (out of this module's scope).
   */
  async emailToCustomer(dto: EmailStatementDto, user: AuthUser) {
    const statement = await this.buildStatement(dto, user);
    const to = dto.to ?? statement.customerEmail ?? undefined;
    const rendered = await this.renderPdf(statement, dto.templateId, user);

    const smtpConfigured = !!process.env.SMTP_HOST;
    let emailed = false;

    if (!to) {
      this.logger.warn(
        `Statement email skipped: customer ${statement.customerId} has no email and no override was supplied`,
      );
    } else {
      const subject = `Statement of account — ${statement.customerName ?? 'Customer'} (${this.fmtDate(
        statement.dateFrom,
      )} to ${this.fmtDate(statement.dateTo)})`;
      const dataUri = `data:application/pdf;base64,${rendered.buffer.toString('base64')}`;
      const html = this.emailHtml(statement, dataUri, rendered.filename);
      const text = this.emailText(statement);
      // sendEmail is best-effort and never throws; it no-ops when SMTP is unset.
      await this.email?.sendEmail(to, subject, html, text);
      emailed = smtpConfigured && !!this.email;
    }

    await this.auditLogs.log({
      action: 'EMAIL',
      entityType: 'CustomerStatement',
      entityId: statement.customerId,
      userId: user.id,
      companyId: statement.companyId,
      metadata: {
        to: to ?? null,
        emailed,
        smtpConfigured,
        filename: rendered.filename,
        documentId: rendered.documentId,
      } as any,
    });

    return {
      emailed,
      smtpConfigured,
      to: to ?? null,
      filename: rendered.filename,
      documentId: rendered.documentId ?? null,
      closingBalance: statement.closingBalance.toString(),
      message: !to
        ? 'No recipient email available for this customer'
        : smtpConfigured
          ? 'Statement emailed to customer'
          : 'SMTP not configured — statement email skipped and logged',
    };
  }

  // ─── Rendering helpers (shared by print-engine delegation + local fallback) ──

  private templateData(s: CustomerStatement): Record<string, unknown> {
    return {
      settlementHistory: s.settlementHistory,
      customerName: s.customerName ?? '',
      currency: s.currency,
      dateFrom: this.fmtDate(s.dateFrom),
      dateTo: this.fmtDate(s.dateTo),
      openingBalance: this.money(s.openingBalance),
      totalDebits: this.money(s.totalDebits),
      totalCredits: this.money(s.totalCredits),
      closingBalance: this.money(s.closingBalance),
    };
  }

  private pdfSections(s: CustomerStatement) {
    return [
      {
        heading: `Statement of Account — ${s.customerName ?? s.customerId}`,
        paragraph: `Currency ${s.currency}    Period ${this.fmtDate(s.dateFrom)} to ${this.fmtDate(
          s.dateTo,
        )}\nOpening balance: ${this.money(s.openingBalance)} ${s.currency}`,
      },
      ...(s.settlementHistory.status === 'INCOMPLETE'
        ? [
            {
              heading: 'Settlement history is incomplete',
              paragraph: `Unresolved evidence: ${s.currency} ${s.settlementHistory.unresolvedAmount}. This statement is not reconciled.`,
              rows: s.settlementHistory.gaps.map((g) => [g.reference, g.reason, g.amount]),
            },
          ]
        : []),
      {
        heading: 'Transactions',
        rows: [
          ['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Balance'],
          ...s.lines.map((l) => [
            this.fmtDate(l.date),
            l.type,
            l.reference,
            this.money(l.debit),
            this.money(l.credit),
            this.money(l.balance),
          ]),
        ],
      },
      {
        heading: 'Summary',
        rows: [
          ['Opening balance', this.money(s.openingBalance)],
          ['Total debits', this.money(s.totalDebits)],
          ['Total credits', this.money(s.totalCredits)],
          ['Closing balance', this.money(s.closingBalance)],
        ],
      },
      {
        heading: `Aging (live, as of ${this.fmtDate(s.agingAsOf)})`,
        rows: [
          ['Current', this.num(s.aging.current)],
          ['1-30 days', this.num(s.aging.days1_30)],
          ['31-60 days', this.num(s.aging.days31_60)],
          ['61-90 days', this.num(s.aging.days61_90)],
          ['Over 90 days', this.num(s.aging.over90)],
          ['Total outstanding', this.num(s.aging.total)],
        ],
      },
    ];
  }

  private sheetRows(s: CustomerStatement): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    rows.push({
      Date: this.fmtDate(s.dateFrom),
      Type: 'OPENING',
      Reference: '',
      Description: 'Opening balance',
      Debit: '',
      Credit: '',
      Balance: this.money(s.openingBalance),
    });
    for (const l of s.lines) {
      rows.push({
        Date: this.fmtDate(l.date),
        Type: l.type,
        Reference: l.reference,
        Description: l.description,
        Debit: l.debit.isZero() ? '' : this.money(l.debit),
        Credit: l.credit.isZero() ? '' : this.money(l.credit),
        Balance: this.money(l.balance),
      });
    }
    rows.push({
      Date: this.fmtDate(s.dateTo),
      Type: 'CLOSING',
      Reference: '',
      Description: 'Closing balance',
      Debit: this.money(s.totalDebits),
      Credit: this.money(s.totalCredits),
      Balance: this.money(s.closingBalance),
    });
    if (s.settlementHistory.status === 'INCOMPLETE') {
      rows.push({
        Type: 'HISTORY_INCOMPLETE',
        Description: 'Settlement evidence is incomplete; this statement is not reconciled',
        Balance: s.settlementHistory.unresolvedAmount,
      });
      for (const gap of s.settlementHistory.gaps)
        rows.push({
          Type: 'HISTORY_GAP',
          Reference: gap.reference,
          Description: gap.reason,
          Balance: gap.amount,
        });
    }
    return rows;
  }

  private async buildPdfBuffer(
    s: CustomerStatement,
    sections: Array<{ heading?: string; paragraph?: string; rows?: string[][] }>,
  ): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit');
    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 48 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        doc.fontSize(16).font('Helvetica-Bold').text('Statement of Account');
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor('gray')
          .text(`Generated ${new Date().toISOString()}`);
        doc.fillColor('black').moveDown(1);

        for (const section of sections) {
          if (section.heading) {
            doc.fontSize(12).font('Helvetica-Bold').text(section.heading);
            doc.font('Helvetica').moveDown(0.3);
          }
          if (section.paragraph) {
            doc.fontSize(10).text(section.paragraph);
            doc.moveDown(0.4);
          }
          if (section.rows?.length) {
            doc.fontSize(9);
            for (const row of section.rows) doc.text(row.join('    '));
            doc.moveDown(0.5);
          }
        }
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async buildExcelBuffer(
    s: CustomerStatement,
    rows: Array<Record<string, unknown>>,
  ): Promise<Buffer> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ITEMBA-R';
    workbook.created = new Date();
    const ws = workbook.addWorksheet('Statement');

    ws.addRow([`Statement of Account — ${s.customerName ?? s.customerId}`]).font = {
      bold: true,
      size: 14,
    };
    ws.addRow([`${s.currency}   ${this.fmtDate(s.dateFrom)} to ${this.fmtDate(s.dateTo)}`]).font = {
      italic: true,
    };
    ws.addRow([]);

    const headers = ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell: any) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    });
    for (const r of rows) {
      ws.addRow(headers.map((h) => this.neutralize(r[h] ?? '')));
    }
    headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = Math.max(h.length + 2, 14);
    });

    ws.addRow([]);
    ws.addRow(['Aging (live, as of ' + this.fmtDate(s.agingAsOf) + ')']).font = { bold: true };
    ws.addRow(['Current', this.num(s.aging.current)]);
    ws.addRow(['1-30 days', this.num(s.aging.days1_30)]);
    ws.addRow(['31-60 days', this.num(s.aging.days31_60)]);
    ws.addRow(['61-90 days', this.num(s.aging.days61_90)]);
    ws.addRow(['Over 90 days', this.num(s.aging.over90)]);
    ws.addRow(['Total outstanding', this.num(s.aging.total)]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private emailHtml(s: CustomerStatement, dataUri: string, filename: string): string {
    const rowsHtml = s.lines
      .map(
        (l) =>
          `<tr><td>${this.fmtDate(l.date)}</td><td>${l.type}</td><td>${this.escape(
            l.reference,
          )}</td><td style="text-align:right">${this.money(
            l.debit,
          )}</td><td style="text-align:right">${this.money(
            l.credit,
          )}</td><td style="text-align:right">${this.money(l.balance)}</td></tr>`,
      )
      .join('');
    const historyWarning =
      s.settlementHistory.status === 'INCOMPLETE'
        ? `<p><strong>Settlement history is incomplete.</strong> Unresolved evidence: ${this.escape(s.currency)} ${this.escape(s.settlementHistory.unresolvedAmount)}. This statement is not reconciled.</p>`
        : '';
    return `
      ${historyWarning}
      <p>Dear ${this.escape(s.customerName ?? 'Customer')},</p>
      <p>Please find your statement of account for the period
      <strong>${this.fmtDate(s.dateFrom)}</strong> to <strong>${this.fmtDate(s.dateTo)}</strong>.</p>
      <p>Opening balance: <strong>${this.money(s.openingBalance)} ${s.currency}</strong><br/>
      Closing balance: <strong>${this.money(s.closingBalance)} ${s.currency}</strong></p>
      <table border="1" cellpadding="4" cellspacing="0">
        <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p><a href="${dataUri}" download="${this.escape(filename)}">Download PDF statement (${this.escape(
        filename,
      )})</a></p>
      <p>Thank you for your business.</p>`;
  }

  private emailText(s: CustomerStatement): string {
    const lines = s.lines.map(
      (l) =>
        `${this.fmtDate(l.date)}  ${l.type}  ${l.reference}  Dr ${this.money(
          l.debit,
        )}  Cr ${this.money(l.credit)}  Bal ${this.money(l.balance)}`,
    );
    return [
      `Dear ${s.customerName ?? 'Customer'},`,
      '',
      `Statement of account ${this.fmtDate(s.dateFrom)} to ${this.fmtDate(s.dateTo)} (${s.currency})`,
      ...(s.settlementHistory.status === 'INCOMPLETE'
        ? [
            `Settlement history is incomplete. Unresolved evidence: ${s.currency} ${s.settlementHistory.unresolvedAmount}. This statement is not reconciled.`,
          ]
        : []),
      `Opening balance: ${this.money(s.openingBalance)}`,
      ...lines,
      `Closing balance: ${this.money(s.closingBalance)}`,
    ].join('\n');
  }

  // ─── Small formatters ────────────────────────────────────────────────────────

  /**
   * Coerce an optional currency label into a concrete {@link CurrencyCode} for
   * single-currency scoping. Mirrors the persisted generate() path (base TZS by
   * default). An unrecognised label falls back to TZS rather than throwing so a
   * stale presentation label never breaks the read-only detail endpoint.
   */
  private resolveCurrency(currency?: string): CurrencyCode {
    if (currency && (Object.values(CurrencyCode) as string[]).includes(currency)) {
      return currency as CurrencyCode;
    }
    return CurrencyCode.TZS;
  }

  private money(d: Prisma.Decimal): string {
    return d.toFixed(2);
  }

  private num(n: number): string {
    return n.toFixed(2);
  }

  private fmtDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private escape(v: string): string {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private neutralize(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
    return value;
  }

  private statementFilename(s: CustomerStatement, ext: string): string {
    const name = (s.customerName ?? s.customerId)
      .replace(/[^a-z0-9-]+/gi, '_')
      .replace(/^_+|_+$/g, '');
    return `statement_${name || 'customer'}_${this.fmtDate(s.dateFrom)}_${this.fmtDate(
      s.dateTo,
    )}.${ext}`;
  }
  /** Preserve the saved evidence while projecting period-correct balances on every read. */
  private async projectRun<T extends CustomerStatementRun>(
    run: T,
    loadedLedger?: Awaited<ReturnType<CustomerStatementsService['loadMovements']>>,
  ) {
    const ledger =
      loadedLedger ??
      (await this.loadMovements(
        run.companyId,
        run.customerId ?? undefined,
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
