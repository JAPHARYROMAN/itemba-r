import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { CreateSubcontractorDto } from './dto/create-subcontractor.dto';
import { UpdateSubcontractorDto } from './dto/update-subcontractor.dto';
import { applyCompanyScopeWhere } from '../../common/services';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class SubcontractorsService {
  private readonly logger = new Logger(SubcontractorsService.name);
  constructor(
    private prisma: PrismaService,
    private audit: AuditLogsService,
    private codes: EntityCodeGeneratorService,
    private postingEngine: PostingEngineService,
  ) {}

  async create(dto: CreateSubcontractorDto, userId: string) {
    const existing = await this.prisma.subcontractorRecord.findFirst({
      where: { companyId: dto.companyId, subcontractorCode: dto.subcontractorCode, deletedAt: null },
    });
    if (existing) throw new BadRequestException('Subcontractor code already exists');
    const sub = await this.prisma.subcontractorRecord.create({ data: dto });
    await this.audit.log({ userId, action: 'CREATE', entityType: 'SubcontractorRecord', entityId: sub.id, newValue: dto as unknown as Record<string, unknown> });
    return sub;
  }

  async findAll(projectId?: string, companyId?: string, page = 1, limit = 20, user?: any) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    applyCompanyScopeWhere(where, user, companyId);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.subcontractorRecord.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: { project: { select: { projectName: true } }, supplier: { select: { name: true } } },
      }),
      this.prisma.subcontractorRecord.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const s = await this.prisma.subcontractorRecord.findFirst({ where: { id, deletedAt: null } });
    if (!s) throw new NotFoundException('Subcontractor not found');
    return s;
  }

  /**
   * Record a milestone claim from the subcontractor — creates a Payable
   * (tagged with `sourceType='SubcontractorRecord'` so the AP team can see
   * the link), posts a balanced JE booking the cost, increments the
   * project's `actualCost`, and the subcontractor's `outstandingAmount`.
   *
   * JE shape:
   *   Dr 5300 Direct Project Subcontractor Cost   amount
   *      Cr 2000 Accounts Payable                  amount
   *
   * Soft-fails if the COA accounts are missing — the Payable is still
   * created so AP isn't blocked, but the GL warning is logged.
   */
  async recordClaim(
    id: string,
    dto: { amount: number; description: string; dueDate?: string; supplierId?: string },
    userId: string,
  ) {
    if (!dto.amount || dto.amount <= 0) throw new BadRequestException('Claim amount must be greater than zero');
    const sub = await this.prisma.subcontractorRecord.findFirst({
      where: { id, deletedAt: null },
      include: { project: { select: { id: true, projectName: true } } },
    });
    if (!sub) throw new NotFoundException('Subcontractor not found');
    if (sub.status !== 'ACTIVE') throw new BadRequestException('Only ACTIVE subcontractors can submit claims');

    const amount = round2(dto.amount);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create the Payable.
      const payableNumber = await this.codes.next({ entityType: 'Payable', companyId: sub.companyId, tx });
      const payable = await tx.payable.create({
        data: {
          payableNumber,
          companyId: sub.companyId,
          supplierId: dto.supplierId ?? sub.supplierId ?? null,
          supplierName: sub.name,
          sourceType: 'SubcontractorRecord',
          sourceId: sub.id,
          amount,
          paidAmount: 0,
          outstandingAmount: amount,
          currency: (sub.currency ?? 'TZS') as any,
          issueDate: new Date(),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          status: 'OPEN',
          notes: dto.description,
        },
      });

      // 2. Bump subcontractor outstanding + project actualCost.
      await tx.subcontractorRecord.update({
        where: { id: sub.id },
        data: { outstandingAmount: { increment: amount } },
      });
      if (sub.projectId) {
        await tx.constructionProject.update({
          where: { id: sub.projectId },
          data: { actualCost: { increment: amount } },
        });
      }

      // 3. GL — Dr 5300 / Cr 2000.
      const accounts = await tx.chartOfAccount.findMany({
        where: { companyId: sub.companyId, deletedAt: null, accountCode: { in: ['5300', '2000'] } },
        select: { id: true, accountCode: true },
      });
      const subcontractorCostId = accounts.find((a) => a.accountCode === '5300')?.id;
      const accountsPayableId = accounts.find((a) => a.accountCode === '2000')?.id;
      let journalEntryId: string | null = null;
      if (subcontractorCostId && accountsPayableId) {
        const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: sub.companyId, tx });
        const je = await this.postingEngine.postLines({
          journalNumber,
          companyId: sub.companyId,
          transactionDate: new Date(),
          description: `Subcontractor claim — ${sub.name}${sub.project ? ` (${sub.project.projectName})` : ''}`,
          referenceType: 'SubcontractorClaim',
          referenceId: payable.id,
          status: 'DRAFT',
          userId,
          moduleName: 'subcontractor_claim',
          lines: [
            {
              accountId: subcontractorCostId,
              description: `Subcontractor work — ${dto.description}`,
              debit: amount,
              credit: 0,
            },
            {
              accountId: accountsPayableId,
              description: `Payable to ${sub.name}`,
              debit: 0,
              credit: amount,
            },
          ],
        }, tx);
        journalEntryId = je.id;
        await tx.payable.update({ where: { id: payable.id }, data: { journalEntryId } });
      } else {
        this.logger.warn(
          `Subcontractor claim ${payable.payableNumber}: COA missing 5300 or 2000 — JE skipped`,
        );
      }

      return { payable, journalEntryId };
    });

    await this.audit.log({
      userId,
      action: 'RECORD_CLAIM',
      entityType: 'SubcontractorRecord',
      entityId: sub.id,
      companyId: sub.companyId,
      newValue: { amount, payableId: result.payable.id, journalEntryId: result.journalEntryId } as unknown as Record<string, unknown>,
    });

    return { subcontractor: await this.findOne(id), payable: result.payable };
  }

  /**
   * Record a payment against a subcontractor — settles a specific Payable
   * (or any open subcontractor Payable, oldest-first) and posts the cash
   * journal: Dr Accounts Payable / Cr Cash. Updates `paidAmount` and
   * `outstandingAmount` on both the Payable and the Subcontractor record.
   *
   * If `payableId` is omitted, allocates the payment to the oldest open
   * Payable for this subcontractor (FIFO settlement). Throws if there's no
   * open Payable to settle.
   *
   * If `cashAccountId` is omitted, the JE is skipped (legacy behavior —
   * just updates the bookkeeping fields). For full closure the operator
   * should provide it.
   */
  async recordPayment(
    id: string,
    dto: { paymentAmount: number; payableId?: string; cashAccountId?: string; reference?: string },
    userId: string,
  ) {
    if (!dto.paymentAmount || dto.paymentAmount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }
    const sub = await this.findOne(id);
    const amount = round2(dto.paymentAmount);

    // Resolve which Payable to settle.
    const targetPayable = dto.payableId
      ? await this.prisma.payable.findFirst({
          where: {
            id: dto.payableId,
            companyId: sub.companyId,
            sourceType: 'SubcontractorRecord',
            sourceId: sub.id,
            deletedAt: null,
          },
        })
      : await this.prisma.payable.findFirst({
          where: {
            companyId: sub.companyId,
            sourceType: 'SubcontractorRecord',
            sourceId: sub.id,
            status: { in: ['OPEN', 'PARTIALLY_PAID'] as any },
            deletedAt: null,
          },
          orderBy: { issueDate: 'asc' },
        });

    if (!targetPayable) {
      throw new BadRequestException(
        'No open Payable found for this subcontractor. Record a claim first, or pass a specific payableId.',
      );
    }
    if (amount > Number(targetPayable.outstandingAmount)) {
      throw new BadRequestException(
        `Payment (${amount}) exceeds Payable outstanding (${Number(targetPayable.outstandingAmount)}).`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Settle the Payable.
      const newPaid = round2(Number(targetPayable.paidAmount) + amount);
      const newOutstanding = round2(Number(targetPayable.amount) - newPaid);
      const newStatus = newOutstanding <= 0.005 ? 'CLOSED' : 'PARTIALLY_PAID';
      await tx.payable.update({
        where: { id: targetPayable.id },
        data: { paidAmount: newPaid, outstandingAmount: newOutstanding, status: newStatus as any },
      });

      // 2. Update subcontractor totals.
      await tx.subcontractorRecord.update({
        where: { id: sub.id },
        data: {
          paidAmount: { increment: amount },
          outstandingAmount: { decrement: amount },
        },
      });

      // 3. Cash account credit + GL (only when cashAccountId is provided).
      let journalEntryId: string | null = null;
      if (dto.cashAccountId) {
        const cashAcct = await tx.cashAccount.findFirst({
          where: { id: dto.cashAccountId, companyId: sub.companyId, deletedAt: null },
          select: { id: true, accountName: true },
        });
        if (!cashAcct) {
          throw new BadRequestException('Selected cash account does not belong to this company');
        }

        await tx.cashAccount.update({
          where: { id: cashAcct.id },
          data: { currentBalance: { decrement: amount } },
        });

        // Find AP account + the cashAccount's linked ChartOfAccount. The
        // schema doesn't tie CashAccount → ChartOfAccount directly; use the
        // generic Bank account (1010) as the credit side. Future: link
        // CashAccount.gl_account_id to remove this assumption.
        const accounts = await tx.chartOfAccount.findMany({
          where: { companyId: sub.companyId, deletedAt: null, accountCode: { in: ['2000', '1010'] } },
          select: { id: true, accountCode: true },
        });
        const accountsPayableId = accounts.find((a) => a.accountCode === '2000')?.id;
        const bankId = accounts.find((a) => a.accountCode === '1010')?.id;
        if (accountsPayableId && bankId) {
          const journalNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: sub.companyId, tx });
          const je = await this.postingEngine.postLines({
            journalNumber,
            companyId: sub.companyId,
            transactionDate: new Date(),
            description: `Subcontractor payment — ${sub.name} (${targetPayable.payableNumber})`,
            referenceType: 'SubcontractorPayment',
            referenceId: targetPayable.id,
            status: 'DRAFT',
            userId,
            moduleName: 'subcontractor_payment',
            lines: [
              {
                accountId: accountsPayableId,
                description: `Settle ${targetPayable.payableNumber}`,
                debit: amount,
                credit: 0,
              },
              {
                accountId: bankId,
                description: `Cash paid to ${sub.name}${dto.reference ? ` (ref ${dto.reference})` : ''}`,
                debit: 0,
                credit: amount,
              },
            ],
          }, tx);
          journalEntryId = je.id;
        } else {
          this.logger.warn(
            `Subcontractor payment ${targetPayable.payableNumber}: COA missing 2000 or 1010 — JE skipped`,
          );
        }

        // Bump project's receivedAmount? No — receivedAmount tracks
        // cash IN from customers (revenue), not OUT to subcontractors.
      }

      return { payable: { ...targetPayable, paidAmount: newPaid, outstandingAmount: newOutstanding, status: newStatus }, journalEntryId };
    });

    await this.audit.log({
      userId,
      action: 'RECORD_PAYMENT',
      entityType: 'SubcontractorRecord',
      entityId: sub.id,
      companyId: sub.companyId,
      newValue: { amount, payableId: targetPayable.id, journalEntryId: result.journalEntryId } as unknown as Record<string, unknown>,
    });

    return { subcontractor: await this.findOne(id), payable: result.payable };
  }

  async update(id: string, dto: UpdateSubcontractorDto, userId: string) {
    await this.findOne(id);
    const sub = await this.prisma.subcontractorRecord.update({ where: { id }, data: dto });
    await this.audit.log({ userId, action: 'UPDATE', entityType: 'SubcontractorRecord', entityId: id, newValue: dto as unknown as Record<string, unknown> });
    return sub;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.subcontractorRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entityType: 'SubcontractorRecord', entityId: id, newValue: {} });
    return { message: 'Subcontractor deleted' };
  }

}
