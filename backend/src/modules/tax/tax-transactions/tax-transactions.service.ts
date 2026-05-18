import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CreateTaxTransactionDto } from './dto/create-tax-transaction.dto';
import { UpdateTaxTransactionDto } from './dto/update-tax-transaction.dto';
import { applyCompanyScopeWhere } from '../../../common/services';
import { AccountResolverService } from '../../../common/services/account-resolver.service';
import { PostingEngineService } from '../../accounting-engine/posting-engine.service';

@Injectable()
export class TaxTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
  ) {}

  private companyFilter(user: any) {
    if (user.role?.scope === 'GROUP') return {};
    return { companyId: user.companyId };
  }

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, taxTypeId, direction, status, startDate, endDate } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null, ...this.companyFilter(user) };
    applyCompanyScopeWhere(where, user, companyId);
    if (taxTypeId) where.taxTypeId = taxTypeId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) where.transactionDate.gte = new Date(startDate);
      if (endDate) where.transactionDate.lte = new Date(endDate);
    }
    const [data, total] = await Promise.all([
      this.prisma.taxTransaction.findMany({ where, skip, take: Number(limit), orderBy: { transactionDate: 'desc' } }),
      this.prisma.taxTransaction.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.taxTransaction.findFirst({ where: { id, deletedAt: null, ...this.companyFilter(user) } });
    if (!record) throw new NotFoundException('Tax transaction not found');
    return record;
  }

  async create(dto: CreateTaxTransactionDto, user: any) {
    const record = await this.prisma.taxTransaction.create({ data: { ...dto } as any });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'TaxTransaction', entityId: record.id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  async update(id: string, dto: UpdateTaxTransactionDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxTransaction.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxTransaction', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return record;
  }

  /**
   * Phase 2 — post a tax transaction to the GL.
   *
   * Direction = OUTPUT (sales, withholding owed): liability increases
   *   DR Tax Source Account (counterpart) / CR VAT/WHT Payable
   *
   * Direction = INPUT (purchases, recoverable VAT): asset increases
   *   DR VAT Receivable / CR Tax Source Account (counterpart)
   *
   * For sales/purchase-derived transactions the counterpart side is usually
   * handled by the underlying invoice's own posting (SupplierInvoice posts
   * the AP side; this just establishes the tax leg). For MANUAL transactions,
   * the offset routes to a generic balance-sheet clearing account (AR for
   * OUTPUT, AP for INPUT) so the JE balances cleanly.
   */
  async post(id: string, user: any) {
    const existing = await this.findOne(id, user);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT tax transactions can be posted');
    }
    const taxAmount = new Prisma.Decimal(existing.taxAmount);
    const shouldPost = taxAmount.gt(0);

    const result = await this.prisma.$transaction(async (tx) => {
      let journalEntryId: string | null = null;

      if (shouldPost) {
        const taxAccountRole =
          existing.direction === 'INPUT' ? 'TAX_VAT_RECEIVABLE' : 'TAX_VAT_PAYABLE';
        const counterpartRole =
          existing.direction === 'INPUT' ? 'AP_CONTROL' : 'AR_CONTROL';

        const [taxAccount, counterpart] = await Promise.all([
          this.accountResolver.resolve(existing.companyId, taxAccountRole as any, tx),
          this.accountResolver.resolve(existing.companyId, counterpartRole as any, tx),
        ]);

        const lines =
          existing.direction === 'INPUT'
            ? [
                {
                  accountId: taxAccount.id,
                  debit: taxAmount,
                  description: `Input VAT — ${existing.taxTransactionNumber}`,
                },
                {
                  accountId: counterpart.id,
                  credit: taxAmount,
                  description: `Tax offset — ${existing.taxTransactionNumber}`,
                },
              ]
            : [
                {
                  accountId: counterpart.id,
                  debit: taxAmount,
                  description: `Tax offset — ${existing.taxTransactionNumber}`,
                },
                {
                  accountId: taxAccount.id,
                  credit: taxAmount,
                  description: `Output VAT/WHT — ${existing.taxTransactionNumber}`,
                },
              ];

        const journalEntry = await this.postingEngine.postLines(
          {
            companyId: existing.companyId,
            transactionDate: existing.transactionDate,
            description: `Tax transaction ${existing.taxTransactionNumber}`,
            referenceType: 'TaxTransaction',
            referenceId: existing.id,
            moduleName: 'tax-transactions',
            userId: user.id,
            lines,
          },
          tx,
        );
        journalEntryId = journalEntry.id;
      }

      return tx.taxTransaction.update({
        where: { id },
        data: {
          status: 'POSTED' as any,
          postedById: user.id,
          postedAt: new Date(),
          ...(journalEntryId && { journalEntryId }),
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'TaxTransaction',
      entityId: id,
      newValue: { status: 'POSTED', journalEntryId: result.journalEntryId },
    });
    return result;
  }

  async reverse(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.taxTransaction.update({ where: { id }, data: { status: 'REVERSED' as any } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'TaxTransaction', entityId: id, newValue: { status: 'REVERSED' } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.taxTransaction.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'TaxTransaction', entityId: id, newValue: {} });
    return { message: 'Tax transaction deleted' };
  }
}
