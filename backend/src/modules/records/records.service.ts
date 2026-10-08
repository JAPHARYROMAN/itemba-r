import { accountPage, consolidateAccounts } from '../../common/utils/consolidate-accounts';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma, RecordEntry } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PartyExistsService } from '../../common/services/party-exists.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  CreateRecordDto,
  RecordPartyStatementQuery,
  RecordReasonDto,
  RecordSettlementDto,
  RecordStatementQuery,
  RecordsQuery,
  UpdateRecordDto,
} from './records.dto';
import { csvCell, isDebt, presentRecord, recordValues, requestKey, today } from './records.domain';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import { statementRows, statementCsv, statementPdf } from './records.statement';
import { recordsPdf, recordDetailPdf } from './records.pdf';

const names = {
  company: { select: { name: true } },
  division: { select: { name: true } },
  branch: { select: { name: true } },
} as const;
@Injectable()
export class RecordsService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly audit: AuditLogsService,
    private readonly documents: GeneratedDocumentsService,
    private readonly parties?: PartyExistsService,
  ) {}

  private async access(user: AuthUser): Promise<Prisma.RecordEntryWhereInput> {
    return {
      OR: [
        { companyId: null, ownerId: user.id },
        {
          AND: [
            { companyId: { not: null } },
            await this.companies.companyWhereFor(user),
            await this.org.recordWhereFor(user),
          ],
        },
      ],
    };
  }
  private async where(user: AuthUser, q: RecordsQuery): Promise<Prisma.RecordEntryWhereInput> {
    if (q.from && q.to && q.from > q.to)
      throw new BadRequestException('Start date must be on or before end date.');
    // Validate requested company independently even when no matching records exist.
    if (q.companyId) await this.companies.assertCanAccessCompany(user, q.companyId);
    const debt = { kind: { in: ['DEBTOR', 'CREDITOR'] } };
    const open = { ...debt, settledAmount: { lt: this.db.recordEntry.fields.amount } };
    const statuses: Record<string, Prisma.RecordEntryWhereInput> = {
      open,
      overdue: { ...open, dueDate: { lt: today() } },
      settled: { ...debt, settledAmount: { equals: this.db.recordEntry.fields.amount } },
    };
    return {
      AND: [
        await this.access(user),
        {
          kind: q.kind,
          companyId: q.scope === 'personal' ? null : q.companyId,
          divisionId: q.divisionId,
          branchId: q.branchId,
          currency: q.currency,
          supplierId: q.supplierId,
          customerId: q.customerId,
          voidedAt: q.status === 'void' ? { not: null } : null,
          recordDate: {
            gte: q.from ? new Date(q.from) : undefined,
            lte: q.to ? new Date(q.to) : undefined,
          },
        },
        statuses[q.status ?? ''] ?? {},
        q.search?.trim()
          ? {
              OR: ['title', 'counterparty', 'reference', 'category'].map((key) => ({
                [key]: { contains: q.search!.trim(), mode: 'insensitive' },
              })),
            }
          : {},
      ],
    };
  }
  async directory(user: AuthUser) {
    const companyIds = await this.companies.accessibleCompanyIds(user);
    const scope = await this.org.accessibleIds(user);
    const companies = await this.db.company.findMany({
      where: { id: { in: companyIds }, status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const divisions = await this.db.division.findMany({
      where: {
        companyId: { in: companies.map((c) => c.id) },
        deletedAt: null,
        isActive: true,
        ...(scope.unrestricted
          ? {}
          : {
              OR: [
                { id: { in: scope.divisionIds } },
                { branches: { some: { id: { in: scope.branchIds } } } },
              ],
            }),
      },
      select: { id: true, name: true, companyId: true },
      orderBy: { name: 'asc' },
    });
    const branches = await this.db.branch.findMany({
      where: {
        divisionId: { in: divisions.map((d) => d.id) },
        isActive: true,
        deletedAt: null,
        ...(scope.unrestricted
          ? {}
          : { OR: [{ id: { in: scope.branchIds } }, { divisionId: { in: scope.divisionIds } }] }),
      },
      select: { id: true, name: true, divisionId: true },
      orderBy: { name: 'asc' },
    });
    return { companies, divisions, branches };
  }
  async list(user: AuthUser, q: RecordsQuery) {
    const where = await this.where(user, q);
    const [rows, total] = await this.db.$transaction(
      [
        this.db.recordEntry.findMany({
          where,
          include: names,
          orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          ...(q.view === 'accounts' ? {} : { skip: ((q.page || 1) - 1) * 25, take: 25 }),
        }),
        this.db.recordEntry.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (q.view === 'accounts') {
      const accounts = consolidateAccounts(
        rows.map((row) => ({
          record: presentRecord(row),
          id: row.id,
          companyId: row.companyId,
          ownerId: row.ownerId,
          company: row.company,
          kind: row.kind,
          partyId: row.supplierId ?? row.customerId,
          partyName: row.counterparty,
          currency: row.currency,
          amount: row.amount,
          paidAmount: isDebt(row.kind) ? row.settledAmount : 0,
          outstandingAmount: isDebt(row.kind) ? row.amount.minus(row.settledAmount) : 0,
          issueDate: row.recordDate,
          dueDate: isDebt(row.kind) ? row.dueDate : null,
          inactive: !!row.voidedAt,
        })),
      );
      const page = accountPage(accounts, { page: q.page, limit: 25 });
      return { rows: page.data, total: page.total, page: page.page, pageSize: 25 };
    }
    return { rows: rows.map(presentRecord), total, page: q.page || 1, pageSize: 25 };
  }
  async summary(user: AuthUser, q: RecordsQuery) {
    const where = await this.where(user, q);
    const rows = await this.db.recordEntry.groupBy({
      by: ['kind', 'currency'],
      where,
      _sum: { amount: true, settledAmount: true },
      _count: true,
    });
    return rows.map((r) => ({
      kind: r.kind,
      currency: r.currency,
      count: r._count,
      amount: (r._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      balance:
        isDebt(r.kind) && q.status !== 'void'
          ? (r._sum.amount ?? new Prisma.Decimal(0)).minus(r._sum.settledAmount ?? 0).toFixed(2)
          : '0.00',
    }));
  }
  async detail(user: AuthUser, id: string) {
    const row = await this.db.recordEntry.findFirst({
      where: { AND: [{ id }, await this.access(user)] },
      include: {
        ...names,
        settlements: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] },
        events: { orderBy: { createdAt: 'desc' } },
        postings: { orderBy: [{ date: 'desc' }, { sequence: 'desc' }], take: 1 },
      },
    });
    if (!row) throw new NotFoundException('Record not found or no longer accessible.');
    return {
      ...presentRecord(row),
      lastActivityDate: row.postings[0]?.date ?? row.statementStartsOn ?? row.recordDate,
    };
  }
  private async scope(
    user: AuthUser,
    row: { companyId: string | null; divisionId: string | null; branchId: string | null },
    active = false,
  ) {
    if (!row.companyId) return; // Unlinked entries are owner-private, checked by access().
    await this.companies.assertCanAccessCompany(user, row.companyId, AccessLevel.WRITE);
    await this.org.assertCanAccessScope(user, row.divisionId, row.branchId, AccessLevel.WRITE);
    if (!active) return;
    const company = await this.db.company.findFirst({
      where: { id: row.companyId, status: 'ACTIVE', deletedAt: null },
    });
    const division = row.divisionId
      ? await this.db.division.findFirst({
          where: { id: row.divisionId, companyId: row.companyId, isActive: true, deletedAt: null },
        })
      : true;
    const branch = row.branchId
      ? await this.db.branch.findFirst({
          where: { id: row.branchId, divisionId: row.divisionId!, isActive: true, deletedAt: null },
        })
      : true;
    if (!company || !division || !branch)
      throw new BadRequestException(
        'Choose an active company, division and branch in the same organisation.',
      );
  }
  /** Party linkage (Phase 2, D2): identity only; the party must exist in the record's company. */
  private async assertParty(values: {
    companyId: string | null;
    supplierId: string | null;
    customerId: string | null;
  }) {
    if (values.supplierId) await this.parties?.assertSupplier(values.companyId, values.supplierId);
    if (values.customerId) await this.parties?.assertCustomer(values.companyId, values.customerId);
  }
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.db.$transaction(work, { timeout: 20000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code))
        throw new ConflictException(
          'This request was saved or another window changed the record. Refresh before retrying.',
        );
      throw e;
    }
  }
  private async lock(
    tx: Prisma.TransactionClient,
    row: RecordEntry,
    version: number,
    data: Prisma.RecordEntryUpdateManyMutationInput = {},
  ) {
    if (row.version !== version)
      throw new ConflictException(
        'This record changed. Close this form and refresh before trying again.',
      );
    const changed = await tx.recordEntry.updateMany({
      where: { id: row.id, version, voidedAt: null },
      data: { ...data, version: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ConflictException(
        'This record changed. Close this form and refresh before trying again.',
      );
  }
  private async event(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    row: RecordEntry,
    action: string,
    detail: string,
  ) {
    await tx.recordEvent.create({
      data: {
        recordId: row.id,
        actorId: user.id,
        actorName: user.fullName || user.email,
        action,
        detail,
      },
    });
    // Private contents stay in the scoped record history, never in a global audit payload.
    await this.audit.logStrictInTransaction(tx, {
      action: `RECORDS_${action}`,
      entityType: 'RecordEntry',
      entityId: row.id,
      userId: user.id,
      companyId: row.companyId,
    });
  }
  async create(user: AuthUser, d: CreateRecordDto) {
    const values = recordValues(d),
      key = requestKey(d);
    if (isDebt(values.kind) && values.recordDate > today())
      throw new BadRequestException(
        'A debt record cannot be dated in the future. Use the due date for a future payment.',
      );
    await this.scope(user, values, true);
    await this.assertParty(values);
    const existing = await this.db.recordEntry.findUnique({ where: { requestId: d.requestId } });
    if (existing) {
      if (existing.ownerId !== user.id || existing.payloadKey !== key)
        throw new ConflictException('This request reference was already used.');
      return this.detail(user, existing.id);
    }
    return this.transaction(async (tx) => {
      const row = await tx.recordEntry.create({
        data: { ...values, ownerId: user.id, requestId: d.requestId, payloadKey: key },
      });
      if (isDebt(row.kind))
        await this.post(
          tx,
          row,
          1,
          'DEBT',
          row.recordDate,
          row.amount,
          'Debt recorded',
          row.reference,
        );
      await this.event(tx, user, row, 'CREATED', 'Record created.');
      return presentRecord(row);
    });
  }
  async update(user: AuthUser, id: string, d: UpdateRecordDto) {
    const row = await this.detail(user, id),
      values = recordValues(d);
    await this.scope(user, row);
    await this.scope(user, values, true);
    await this.assertParty(values);
    // A linked register cannot be made private or moved to another scope after creation.
    if (
      (['companyId', 'divisionId', 'branchId', 'kind', 'currency'] as const).some(
        (key) => row[key] !== values[key],
      )
    )
      throw new BadRequestException(
        'Register, currency and organisation cannot be changed. Void and replace an incorrect record.',
      );
    if (values.amount.lt(row.settledAmount))
      throw new BadRequestException('The amount cannot be less than recorded settlements.');
    if (isDebt(row.kind) && values.recordDate.getTime() !== row.recordDate.getTime())
      throw new BadRequestException(
        'Debt dates are fixed to preserve the statement. Void and replace an incorrectly dated record.',
      );
    if (row.settlements.some((s) => !s.reversedAt && s.date < values.recordDate))
      throw new BadRequestException('Record date cannot follow an existing settlement.');
    return this.transaction(async (tx) => {
      await this.lock(tx, row, d.version, values);
      const adjustment = values.amount.minus(row.amount);
      if (isDebt(row.kind) && !adjustment.isZero())
        await this.post(
          tx,
          row,
          d.version + 1,
          'ADJUSTMENT',
          this.effectiveToday(row),
          adjustment,
          `Debt amount corrected from ${row.amount.toFixed(2)} to ${values.amount.toFixed(2)}`,
          values.reference,
        );
      await this.event(
        tx,
        user,
        row,
        'UPDATED',
        `Updated from version ${d.version}. Previous amount: ${row.currency} ${row.amount.toFixed(2)}. Previous title: ${row.title}`,
      );
      return presentRecord(await tx.recordEntry.findUniqueOrThrow({ where: { id } }));
    });
  }
  async settle(user: AuthUser, id: string, d: RecordSettlementDto) {
    const row = await this.detail(user, id);
    await this.scope(user, row);
    const key = requestKey({ ...d, recordId: id });
    const prior = await this.db.recordSettlement.findUnique({ where: { requestId: d.requestId } });
    if (prior) {
      if (prior.recordId !== id || prior.createdBy !== user.id || prior.payloadKey !== key)
        throw new ConflictException('This settlement request was already used.');
      return row;
    }
    const amount = new Prisma.Decimal(d.amount),
      date = new Date(d.date);
    if (!isDebt(row.kind) || row.voidedAt)
      throw new BadRequestException('Only active debtors and creditors accept settlements.');
    if (!amount.gt(0) || amount.gt(row.amount.minus(row.settledAmount)))
      throw new BadRequestException(
        'Settlement must be positive and no greater than the outstanding balance.',
      );
    if (date < row.recordDate || date > today())
      throw new BadRequestException('Settlement date must fall between the record date and today.');
    if (date < row.lastActivityDate)
      throw new BadRequestException(
        `Payment date cannot precede the latest statement movement (${row.lastActivityDate.toISOString().slice(0, 10)}).`,
      );
    return this.transaction(async (tx) => {
      await this.lock(tx, row, d.version, { settledAmount: { increment: amount } });
      await tx.recordSettlement.create({
        data: {
          recordId: id,
          requestId: d.requestId,
          payloadKey: key,
          amount,
          date,
          reference: d.reference?.trim(),
          notes: d.notes?.trim(),
          createdBy: user.id,
        },
      });
      await this.post(
        tx,
        row,
        d.version + 1,
        'PAYMENT',
        date,
        amount.negated(),
        row.kind === 'DEBTOR' ? 'Payment received' : 'Payment made',
        d.reference?.trim(),
      );
      await this.event(
        tx,
        user,
        row,
        'SETTLED',
        `${row.kind === 'DEBTOR' ? 'Collection' : 'Repayment'} recorded: ${row.currency} ${amount.toFixed(2)}.`,
      );
      return presentRecord(await tx.recordEntry.findUniqueOrThrow({ where: { id } }));
    });
  }
  async reverse(user: AuthUser, id: string, settlementId: string, d: RecordReasonDto) {
    const row = await this.detail(user, id);
    await this.scope(user, row);
    const settlement = row.settlements.find((s) => s.id === settlementId);
    if (!settlement || settlement.reversedAt)
      throw new BadRequestException('This settlement is missing or already reversed.');
    if (d.reason.trim().length < 3)
      throw new BadRequestException('Give a reason for the reversal.');
    return this.transaction(async (tx) => {
      await this.lock(tx, row, d.version, { settledAmount: { decrement: settlement.amount } });
      await tx.recordSettlement.update({
        where: { id: settlementId },
        data: { reversedAt: new Date(), reversalReason: d.reason.trim() },
      });
      await this.post(
        tx,
        row,
        d.version + 1,
        'REVERSAL',
        this.effectiveToday(row),
        settlement.amount,
        `Payment reversed: ${d.reason.trim()}`,
        settlement.reference,
      );
      await this.event(
        tx,
        user,
        row,
        'REVERSED',
        `${row.currency} ${settlement.amount.toFixed(2)}: ${d.reason.trim()}`,
      );
      return presentRecord(await tx.recordEntry.findUniqueOrThrow({ where: { id } }));
    });
  }
  async void(user: AuthUser, id: string, d: RecordReasonDto) {
    const row = await this.detail(user, id);
    await this.scope(user, row);
    if (!row.settledAmount.isZero())
      throw new BadRequestException('Reverse settlements before voiding this record.');
    if (d.reason.trim().length < 3) throw new BadRequestException('Give a reason for voiding.');
    return this.transaction(async (tx) => {
      await this.lock(tx, row, d.version, { voidedAt: new Date(), voidReason: d.reason.trim() });
      if (isDebt(row.kind))
        await this.post(
          tx,
          row,
          d.version + 1,
          'VOID',
          this.effectiveToday(row),
          row.amount.negated(),
          `Debt voided: ${d.reason.trim()}`,
          row.reference,
        );
      await this.event(tx, user, row, 'VOIDED', d.reason.trim());
      return presentRecord(await tx.recordEntry.findUniqueOrThrow({ where: { id } }));
    });
  }
  private effectiveToday(row: RecordEntry) {
    return new Date(
      Math.max(today().getTime(), row.recordDate.getTime(), row.statementStartsOn?.getTime() ?? 0),
    );
  }
  private post(
    tx: Prisma.TransactionClient,
    row: RecordEntry,
    sequence: number,
    kind: string,
    date: Date,
    delta: Prisma.Decimal,
    description: string,
    reference?: string | null,
  ) {
    return tx.recordPosting.create({
      data: { recordId: row.id, sequence, kind, date, delta, description, reference },
    });
  }
  async statement(user: AuthUser, id: string, q: RecordStatementQuery) {
    const to = q.to ?? today().toISOString().slice(0, 10);
    if (q.from && q.from > to)
      throw new BadRequestException('Start date must be on or before end date.');
    // One consistent snapshot: header, current balance and immutable movements.
    const where = { AND: [{ id }, await this.access(user)] };
    const row = await this.db.$transaction(
      (tx) =>
        tx.recordEntry.findFirst({
          where,
          include: { ...names, postings: { orderBy: [{ date: 'asc' }, { sequence: 'asc' }] } },
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (!row) throw new NotFoundException('Record not found or no longer accessible.');
    if (!isDebt(row.kind))
      throw new BadRequestException('Statements are available for debtors and creditors.');
    const startsOn = row.statementStartsOn?.toISOString().slice(0, 10) ?? null;
    if (startsOn && (to < startsOn || (q.from && q.from < startsOn)))
      throw new BadRequestException(
        `Statement history begins on ${startsOn}. Earlier payments remain in payment history.`,
      );
    const { postings, ...record } = row;
    return {
      record: presentRecord(record),
      from: q.from ?? startsOn,
      to,
      startsOn,
      ...statementRows(row.kind, postings, q.from, to),
    };
  }
  /**
   * Party linkage (Phase 2 PR-6): one statement across every NoteBook debtor record of a
   * customer or creditor record of a supplier, in one currency, with the same debit /
   * credit rules, brought-forward handling and "independent of the ledger" basis as a
   * single-record statement. Reads only records the reader may already see.
   */
  async partyStatement(user: AuthUser, q: RecordPartyStatementQuery) {
    if (!!q.supplierId === !!q.customerId)
      throw new BadRequestException('Choose one party: a supplier or a customer.');
    const kind = q.supplierId ? 'CREDITOR' : 'DEBTOR';
    const to = q.to ?? today().toISOString().slice(0, 10);
    if (q.from && q.from > to)
      throw new BadRequestException('Start date must be on or before end date.');
    if (q.companyId) await this.companies.assertCanAccessCompany(user, q.companyId);
    const partySelect = {
      id: true,
      name: true,
      phone: true,
      companyId: true,
      company: { select: { name: true } },
    } as const;
    const partyWhere = { deletedAt: null, ...(q.companyId ? { companyId: q.companyId } : {}) };
    const party = q.supplierId
      ? await this.db.supplier.findFirst({
          where: { id: q.supplierId, ...partyWhere },
          select: partySelect,
        })
      : await this.db.customer.findFirst({
          where: { id: q.customerId, ...partyWhere },
          select: partySelect,
        });
    if (!party) throw new NotFoundException('Party not found or no longer accessible.');
    await this.companies.assertCanAccessCompany(user, party.companyId);
    const access = await this.access(user);
    const records = await this.db.$transaction(
      (tx) =>
        tx.recordEntry.findMany({
          where: {
            AND: [
              access,
              {
                kind,
                voidedAt: null,
                ...(q.supplierId ? { supplierId: q.supplierId } : { customerId: q.customerId }),
                ...(q.companyId ? { companyId: q.companyId } : {}),
              },
            ],
          },
          include: { ...names, postings: { orderBy: [{ date: 'asc' }, { sequence: 'asc' }] } },
          orderBy: [{ recordDate: 'asc' }, { id: 'asc' }],
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const currencies = [...new Set(records.map((r) => r.currency))].sort();
    const currency = q.currency ?? currencies[0] ?? 'TZS';
    const selected = records.filter((r) => r.currency === currency);
    const postings = selected
      .flatMap((r) =>
        r.postings.map((p) => ({ ...p, description: `${r.title} · ${p.description}` })),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime() || a.sequence - b.sequence);
    const startsOn =
      selected
        .map((r) => r.statementStartsOn?.toISOString().slice(0, 10) ?? null)
        .filter((v): v is string => !!v)
        .sort()
        .at(-1) ?? null;
    const label = kind === 'DEBTOR' ? 'debtor' : 'creditor';
    return {
      record: {
        id: party.id,
        companyId: party.companyId,
        kind,
        title: `${selected.length} NoteBook ${label} record${selected.length === 1 ? '' : 's'}`,
        counterparty: party.name,
        contact: party.phone ?? null,
        currency,
        reference: null,
        dueDate: null,
        company: party.company ?? null,
        division: null,
        branch: null,
      },
      party: { kind: q.supplierId ? 'supplier' : 'customer', id: party.id, name: party.name },
      currencies,
      records: selected.map((r) => ({
        id: r.id,
        title: r.title,
        reference: r.reference,
        recordDate: r.recordDate,
        dueDate: r.dueDate,
        amount: r.amount.toFixed(2),
        settledAmount: r.settledAmount.toFixed(2),
      })),
      from: q.from ?? null,
      to,
      startsOn,
      ...statementRows(kind, postings, q.from, to),
    };
  }
  async exportPartyStatement(user: AuthUser, q: RecordPartyStatementQuery) {
    const statement = await this.partyStatement(user, q);
    if (statement.rows.length > 10000)
      throw new BadRequestException(
        'Choose a smaller date range to export up to 10,000 movements.',
      );
    const format = q.format ?? 'pdf';
    const buffer =
      format === 'csv'
        ? Buffer.from(statementCsv(statement), 'utf8')
        : await this.documents.renderLetterheadPdf(statement.record, statementPdf(statement), user);
    return {
      buffer,
      filename: `notebook-${statement.party.kind}-statement-${statement.party.id.slice(0, 8)}-${statement.to}.${format}`,
      mimeType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    };
  }
  async exportStatement(user: AuthUser, id: string, q: RecordStatementQuery) {
    const statement = await this.statement(user, id, q);
    if (statement.rows.length > 10000)
      throw new BadRequestException(
        'Choose a smaller date range to export up to 10,000 movements.',
      );
    const format = q.format ?? 'pdf';
    const buffer =
      format === 'csv'
        ? Buffer.from(statementCsv(statement), 'utf8')
        : await this.documents.renderLetterheadPdf(statement.record, statementPdf(statement), user);
    return {
      buffer,
      filename: `records-${statement.record.kind.toLowerCase()}-statement-${id.slice(0, 8)}-${statement.to}.${format}`,
      mimeType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
    };
  }
  private async exportRecords(user: AuthUser, q: RecordsQuery) {
    const rows = await this.db.recordEntry.findMany({
      where: await this.where(user, q),
      include: names,
      orderBy: [{ recordDate: 'desc' }, { id: 'desc' }],
      take: 10001,
    });
    if (rows.length > 10000)
      throw new BadRequestException('Choose a smaller date range to export up to 10,000 records.');
    return rows;
  }
  async exportPdf(user: AuthUser, q: RecordsQuery) {
    const rows = await this.exportRecords(user, q);
    return this.documents.renderLetterheadPdf(
      { companyId: q.scope === 'personal' ? null : q.companyId },
      recordsPdf(rows, q),
      user,
    );
  }
  async exportDetailPdf(user: AuthUser, id: string) {
    const row = await this.detail(user, id);
    if (isDebt(row.kind)) return (await this.exportStatement(user, id, {})).buffer;
    return this.documents.renderLetterheadPdf(row, recordDetailPdf(row), user);
  }
  async export(user: AuthUser, q: RecordsQuery) {
    const rows = await this.exportRecords(user, q);
    const headings = [
      'Register',
      'Date',
      'Title',
      'Party',
      'Contact',
      'Reference',
      'Category',
      'Currency',
      'Amount',
      'Settled',
      'Balance',
      'Due date',
      'Status',
      'Company',
      'Division',
      'Branch',
      'Notes',
    ];
    return {
      filename: `records-${new Date().toISOString().slice(0, 10)}.csv`,
      count: rows.length,
      csv:
        '\uFEFF' +
        [
          headings,
          ...rows.map((raw) => {
            const r = presentRecord(raw);
            return [
              r.kind,
              r.recordDate.toISOString().slice(0, 10),
              r.title,
              r.counterparty,
              r.contact,
              r.reference,
              r.category,
              r.currency,
              r.amount.toFixed(2),
              r.settledAmount.toFixed(2),
              r.balance,
              r.dueDate?.toISOString().slice(0, 10),
              r.status,
              r.company?.name,
              r.division?.name,
              r.branch?.name,
              r.notes,
            ];
          }),
        ]
          .map((r) => r.map(csvCell).join(','))
          .join('\r\n'),
    };
  }
}
