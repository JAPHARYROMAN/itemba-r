import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { OrganizationScopeService } from '../../common/services/organization-scope.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DeskReportQuery } from './desk-reports.dto';
import { reportPeriod } from './desk-reports.domain';
import {
  DeskPostingSource,
  postingStatus,
  sourceFingerprint,
  sourceReference,
} from './desk-posting.domain';

@Injectable()
export class DeskPostingService {
  constructor(
    private readonly db: PrismaService,
    private readonly companies: CompanyScopeService,
    private readonly org: OrganizationScopeService,
    private readonly engine: PostingEngineService,
    private readonly audit: AuditLogsService,
  ) {}

  private allowed(user: AuthUser, kind: DeskPostingSource['kind']) {
    if (!user.permissions?.includes(kind === 'sales' ? 'sales_desk.view' : 'invoice_desk.view'))
      throw new ForbiddenException('Source app access is required.');
  }
  private async sources(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    kind: DeskPostingSource['kind'],
    q: DeskReportQuery,
    id?: string,
  ) {
    this.allowed(user, kind);
    const period = reportPeriod(q);
    const scope = {
      AND: [
        await this.companies.companyWhereFor(user, q.companyId),
        await this.org.recordWhereFor(user),
        { id, divisionId: q.divisionId, branchId: q.branchId, currency: q.currency },
      ],
    };
    const date = id ? undefined : { gte: new Date(period.from), lte: new Date(period.to) };
    const rows =
      kind === 'sales'
        ? await tx.salesDeskSale.findMany({
            where: { ...scope, saleDate: date },
            take: 1001,
            orderBy: { saleDate: 'desc' },
          })
        : await tx.invoiceDeskInvoice.findMany({
            where: { ...scope, invoiceDate: date },
            take: 1001,
            orderBy: { invoiceDate: 'desc' },
          });
    if (rows.length > 1000)
      throw new BadRequestException(
        'Select a narrower date range or organisation (maximum 1,000 documents).',
      );
    return rows.map((row) => {
      const sale = 'saleDate' in row;
      return {
        id: row.id,
        kind,
        companyId: row.companyId,
        divisionId: row.divisionId,
        branchId: row.branchId,
        reference: sale ? row.saleNumber : row.invoiceNumber,
        currency: row.currency,
        date: (sale ? row.saleDate : row.invoiceDate).toISOString().slice(0, 10),
        amount: row.totalAmount.toFixed(2),
        partyId: sale ? row.customerId : row.supplierId,
        voided: !!row.voidedAt,
      } satisfies DeskPostingSource;
    });
  }
  private journals(tx: Prisma.TransactionClient, kind: DeskPostingSource['kind'], ids: string[]) {
    return tx.journalEntry.findMany({
      where: { referenceType: sourceReference(kind), referenceId: { in: ids }, deletedAt: null },
    });
  }
  async list(user: AuthUser, kind: DeskPostingSource['kind'], q: DeskReportQuery) {
    return this.db.$transaction(
      async (tx) => {
        const sources = await this.sources(tx, user, kind, q);
        const journals = await this.journals(
          tx,
          kind,
          sources.map((s) => s.id),
        );
        return sources.map((source) => {
          const linked = journals.filter(
            (j) => j.referenceId === source.id && j.companyId === source.companyId,
          );
          return {
            ...source,
            fingerprint: sourceFingerprint(source),
            status: postingStatus(source, linked),
            journalId: linked.find((j) => !j.reversalOfId)?.id ?? null,
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  async review(user: AuthUser, kind: DeskPostingSource['kind'], id: string) {
    const source = (await this.sources(this.db, user, kind, {}, id))[0];
    if (!source) throw new NotFoundException('Source document not found.');
    const profile = await this.db.companyProfile.findUnique({
      where: { companyId: source.companyId },
      select: { currency: true },
    });
    const accounts = await this.db.chartOfAccount.findMany({
      where: {
        companyId: source.companyId,
        isActive: true,
        deletedAt: null,
        AND: [
          { OR: [{ divisionId: null }, { divisionId: source.divisionId }] },
          { OR: [{ branchId: null }, { branchId: source.branchId }] },
        ],
      },
      select: { id: true, accountCode: true, accountName: true, accountType: true },
      orderBy: { accountCode: 'asc' },
    });
    const journals = (await this.journals(this.db, kind, [id])).filter(
      (j) => j.companyId === source.companyId,
    );
    return {
      source,
      fingerprint: sourceFingerprint(source),
      accounts,
      journals: journals.map((j) => ({ id: j.id, number: j.journalNumber, status: j.status })),
      status: postingStatus(source, journals),
      blocked:
        !profile || profile.currency !== source.currency
          ? 'The document currency must match the company accounting currency. Foreign-currency posting is not available here.'
          : null,
    };
  }
  async post(
    user: AuthUser,
    kind: DeskPostingSource['kind'],
    id: string,
    input: { fingerprint: string; debitAccountId: string; creditAccountId: string },
  ) {
    this.allowed(user, kind);
    return this.db.$transaction(
      async (tx) => {
        // Source row locks serialize competing requests, including retries from different users.
        if (kind === 'sales')
          await tx.$queryRaw`SELECT id FROM sales_desk_sales WHERE id = ${id} FOR UPDATE`;
        else await tx.$queryRaw`SELECT id FROM invoice_desk_invoices WHERE id = ${id} FOR UPDATE`;
        const source = (await this.sources(tx, user, kind, {}, id))[0];
        if (!source) throw new NotFoundException('Source document not found.');
        await this.companies.assertCanAccessCompany(user, source.companyId, AccessLevel.WRITE);
        await this.org.assertCanAccessScope(
          user,
          source.divisionId,
          source.branchId,
          AccessLevel.WRITE,
        );
        if (sourceFingerprint(source) !== input.fingerprint)
          throw new ConflictException('The source changed. Review it again.');
        if (source.voided) throw new BadRequestException('Voided documents cannot be posted.');
        const amount = new Prisma.Decimal(source.amount);
        const cents = Math.round(Number(source.amount) * 100);
        if (
          !amount.gt(0) ||
          !Number.isSafeInteger(cents) ||
          !new Prisma.Decimal(cents / 100).eq(amount)
        )
          throw new BadRequestException(
            'This amount exceeds the exact precision supported by the ledger posting engine.',
          );
        const journals = (await this.journals(tx, kind, [id])).filter(
          (j) => j.companyId === source.companyId,
        );
        if (journals.length)
          throw new ConflictException(
            'This source already has a journal. Review the existing journal; it will not be posted twice.',
          );
        const profile = await tx.companyProfile.findUnique({
          where: { companyId: source.companyId },
          select: { currency: true },
        });
        if (!profile || profile.currency !== source.currency)
          throw new BadRequestException('Company and source currencies must match.');
        if (input.debitAccountId === input.creditAccountId)
          throw new BadRequestException('Select two different accounts.');
        const accounts = await tx.chartOfAccount.findMany({
          where: {
            id: { in: [input.debitAccountId, input.creditAccountId] },
            companyId: source.companyId,
            isActive: true,
            deletedAt: null,
            AND: [
              { OR: [{ divisionId: null }, { divisionId: source.divisionId }] },
              { OR: [{ branchId: null }, { branchId: source.branchId }] },
            ],
          },
        });
        if (accounts.length !== 2)
          throw new BadRequestException(
            'Both accounts must be active and belong to this organisation.',
          );
        const debit = accounts.find((a) => a.id === input.debitAccountId)!;
        const credit = accounts.find((a) => a.id === input.creditAccountId)!;
        if (
          kind === 'sales'
            ? debit.accountType !== 'ASSET' || credit.accountType !== 'INCOME'
            : !['ASSET', 'EXPENSE', 'COST_OF_GOODS_SOLD'].includes(debit.accountType) ||
              credit.accountType !== 'LIABILITY'
        )
          throw new BadRequestException(
            'Sales require a receivable asset and revenue account; purchases require an expense/asset and payable liability account.',
          );
        const result = await this.engine.postLines(
          {
            ...source,
            transactionDate: new Date(source.date),
            description: `${kind === 'sales' ? 'Sales Desk' : 'Invoice Desk'} ${source.reference} [desk-source:${input.fingerprint}]`,
            referenceType: sourceReference(kind),
            referenceId: id,
            journalNumber: `JE-DESK-${randomUUID()}`,
            userId: user.id,
            moduleName: 'DeskPosting',
            lines: [
              { accountId: debit.id, debit: new Prisma.Decimal(source.amount) },
              { accountId: credit.id, credit: new Prisma.Decimal(source.amount) },
            ],
          },
          tx,
        );
        await this.audit.logStrictInTransaction(tx, {
          action: 'POST',
          entityType: sourceReference(kind),
          entityId: id,
          companyId: source.companyId,
          userId: user.id,
          metadata: { ...input, journalEntryId: result.id },
        });
        return result;
      },
      { timeout: 30000 },
    );
  }
}
