import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AccountingControlService } from '../../common/services/accounting-control.service';
import { AccountResolverService } from '../../common/services/account-resolver.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { UpdateIntercompanyTransactionDto } from './dto/update-intercompany-transaction.dto';
import { QueryIntercompanyTransactionDto } from './dto/query-intercompany-transaction.dto';
import { RejectIntercompanyTransactionDto } from './dto/reject-intercompany-transaction.dto';
import { AccessLevel, AuditSeverity } from '@prisma/client';

@Injectable()
export class IntercompanyTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly accountingControl: AccountingControlService,
    private readonly accountResolver: AccountResolverService,
    private readonly companyScope: CompanyScopeService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly postingEngine: PostingEngineService,
  ) {}

  /**
   * Assert the caller may access at least ONE side (from OR to) of an
   * intercompany transaction. Used for read access in findOne.
   */
  private async assertCanAccessEitherSide(
    user: AuthUser,
    record: { fromCompanyId: string; toCompanyId: string },
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    try {
      await this.companyScope.assertCanAccessCompany(user, record.fromCompanyId, minimum);
      return;
    } catch (err) {
      if (!(err instanceof ForbiddenException)) throw err;
    }
    await this.companyScope.assertCanAccessCompany(user, record.toCompanyId, minimum);
  }

  /**
   * Assert the caller may access BOTH sides (from AND to) of an intercompany
   * transaction at the given access level. Used for mutations and posting,
   * which write to both companies' ledgers/records.
   */
  private async assertCanAccessBothSides(
    user: AuthUser,
    record: { fromCompanyId: string; toCompanyId: string },
    minimum: AccessLevel = AccessLevel.WRITE,
  ) {
    await this.companyScope.assertCanAccessCompany(user, record.fromCompanyId, minimum);
    await this.companyScope.assertCanAccessCompany(user, record.toCompanyId, minimum);
  }

  async findAll(query: QueryIntercompanyTransactionDto, user: AuthUser) {
    const { page = 1, limit = 20, fromCompanyId, toCompanyId, status, type } = query;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (fromCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, fromCompanyId);
      where.fromCompanyId = fromCompanyId;
    }
    if (toCompanyId) {
      await this.companyScope.assertCanAccessCompany(user, toCompanyId);
      where.toCompanyId = toCompanyId;
    }
    if (status) where.status = status;
    if (type) where.transactionType = type;

    // Group-scoped admins keep full visibility. Company-scoped users only see
    // transactions where at least one side is a company they can access.
    if (!this.companyScope.isGroupScoped(user)) {
      const accessibleIds = await this.companyScope.accessibleCompanyIds(user);
      where.OR = [
        { fromCompanyId: { in: accessibleIds } },
        { toCompanyId: { in: accessibleIds } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.interCompanyTransaction.findMany({
        where,
        include: {
          fromCompany: { select: { id: true, name: true, code: true } },
          toCompany: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { transactionDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.interCompanyTransaction.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.interCompanyTransaction.findFirst({
      where: { id, deletedAt: null },
      include: {
        fromCompany: { select: { id: true, name: true, code: true } },
        toCompany: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!record) throw new NotFoundException('Intercompany transaction not found');
    await this.assertCanAccessEitherSide(user, record);
    return record;
  }

  async create(dto: CreateIntercompanyTransactionDto, user: AuthUser) {
    const userId = user.id;
    if (dto.fromCompanyId === dto.toCompanyId) {
      throw new BadRequestException('fromCompanyId and toCompanyId must be different');
    }

    await this.assertCanAccessBothSides(
      user,
      { fromCompanyId: dto.fromCompanyId, toCompanyId: dto.toCompanyId },
      AccessLevel.WRITE,
    );

    const transactionNumber = await this.codes.next({ entityType: 'IntercompanyTransaction', companyId: dto.fromCompanyId });
    const record = await this.prisma.interCompanyTransaction.create({
      data: {
        transactionNumber,
        fromCompanyId: dto.fromCompanyId,
        toCompanyId: dto.toCompanyId,
        transactionType: dto.transactionType,
        amount: dto.amount,
        currency: dto.currency,
        transactionDate: new Date(dto.transactionDate),
        description: dto.description,
        status: 'DRAFT',
        createdById: userId,
      },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_CREATE',
      entityType: 'InterCompanyTransaction',
      entityId: record.id,
      userId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdateIntercompanyTransactionDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.assertCanAccessBothSides(user, existing, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT intercompany transactions can be updated');
    }

    if (dto.fromCompanyId && dto.toCompanyId && dto.fromCompanyId === dto.toCompanyId) {
      throw new BadRequestException('fromCompanyId and toCompanyId must be different');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: {
        ...(dto.transactionType && { transactionType: dto.transactionType }),
        ...(dto.amount !== undefined && { amount: dto.amount }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.transactionDate && { transactionDate: new Date(dto.transactionDate) }),
        ...(dto.description && { description: dto.description }),
      },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_UPDATE',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  async submit(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.assertCanAccessBothSides(user, existing, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT transactions can be submitted');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_SUBMIT',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'PENDING_APPROVAL' } as any,
    });

    return record;
  }

  async approve(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.assertCanAccessBothSides(user, existing, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL transactions can be approved');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date() },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_APPROVE',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'APPROVED' } as any,
    });

    return record;
  }

  async reject(id: string, dto: RejectIntercompanyTransactionDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.assertCanAccessBothSides(user, existing, AccessLevel.WRITE);
    if (existing.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException('Only PENDING_APPROVAL transactions can be rejected');
    }

    const record = await this.prisma.interCompanyTransaction.update({
      where: { id },
      data: { status: 'REJECTED', rejectedReason: dto.reason },
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_REJECT',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'PENDING_APPROVAL' } as any,
      newValue: { status: 'REJECTED', reason: dto.reason } as any,
    });

    return record;
  }

  async post(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    // Posting writes balanced POSTED journal entries into BOTH companies'
    // ledgers, so the caller must have write access to BOTH sides.
    await this.assertCanAccessBothSides(user, existing, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only APPROVED transactions can be posted');
    }

    // Period locks must be honored on BOTH sides of the intercompany posting.
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.fromCompanyId,
      transactionDate: existing.transactionDate,
      moduleName: 'intercompany',
    });
    await this.accountingControl.assertPostingAllowed({
      companyId: existing.toCompanyId,
      transactionDate: existing.transactionDate,
      moduleName: 'intercompany',
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Atomic status guard: claim the APPROVED -> POSTED transition guarded on
      // the current status so two concurrent posts race here and exactly one
      // wins (the loser sees count 0). Without this, both requests pass the
      // pre-transaction status check above and each writes a full pair of
      // journal entries, doubling both companies' intercompany balances and
      // cash movements. postedAt is stamped now so the claim is a single
      // atomic write; the journal entry ids are attached after posting.
      const postedAt = new Date();
      const claim = await tx.interCompanyTransaction.updateMany({
        where: { id, status: 'APPROVED', deletedAt: null },
        data: { status: 'POSTED', postedAt },
      });
      if (claim.count !== 1) {
        throw new ConflictException(
          'Intercompany transaction is no longer APPROVED and cannot be posted (it may already be posted)',
        );
      }

      const amount = Number(existing.amount);
      const desc = existing.description;
      const date = existing.transactionDate;

      // Resolve all four accounts up-front. If any role is unmappable on
      // either company's chart, this throws BEFORE any journal lines are
      // written — no more silent skips when accounts are missing.
      const fromAccounts = await this.accountResolver.resolveMany(
        existing.fromCompanyId,
        ['INTERCOMPANY_RECEIVABLE', 'CASH_ON_HAND'],
        tx,
      );
      const toAccounts = await this.accountResolver.resolveMany(
        existing.toCompanyId,
        ['CASH_ON_HAND', 'INTERCOMPANY_PAYABLE'],
        tx,
      );
      const fromArAccount = fromAccounts.INTERCOMPANY_RECEIVABLE;
      const fromCashAccount = fromAccounts.CASH_ON_HAND;
      const toCashAccount = toAccounts.CASH_ON_HAND;
      const toApAccount = toAccounts.INTERCOMPANY_PAYABLE;

      const fromJeNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: existing.fromCompanyId, tx });
      const toJeNumber = await this.codes.next({ entityType: 'JournalEntry', companyId: existing.toCompanyId, tx });

      const fromJe = await this.postingEngine.postLines({
        journalNumber: fromJeNumber,
        companyId: existing.fromCompanyId,
        transactionDate: date,
        description: `IC Transaction: ${desc}`,
        referenceType: 'InterCompanyTransaction',
        referenceId: id,
        status: 'POSTED',
        userId,
        moduleName: 'intercompany',
        lines: [
          {
            accountId: fromArAccount.id,
            description: `IC Receivable: ${desc}`,
            debit: amount,
            credit: 0,
          },
          {
            accountId: fromCashAccount.id,
            description: `IC Cash: ${desc}`,
            debit: 0,
            credit: amount,
          },
        ],
      }, tx);

      const toJe = await this.postingEngine.postLines({
        journalNumber: toJeNumber,
        companyId: existing.toCompanyId,
        transactionDate: date,
        description: `IC Transaction: ${desc}`,
        referenceType: 'InterCompanyTransaction',
        referenceId: id,
        status: 'POSTED',
        userId,
        moduleName: 'intercompany',
        lines: [
          {
            accountId: toCashAccount.id,
            description: `IC Cash received: ${desc}`,
            debit: amount,
            credit: 0,
          },
          {
            accountId: toApAccount.id,
            description: `IC Payable: ${desc}`,
            debit: 0,
            credit: amount,
          },
        ],
      }, tx);

      // Status/postedAt were already set by the atomic claim above; here we
      // only attach the journal entry ids so we never re-flip status (which
      // would defeat the guard) and never overwrite a claim we did not win.
      return tx.interCompanyTransaction.update({
        where: { id },
        data: {
          fromCompanyJournalEntryId: fromJe.id,
          toCompanyJournalEntryId: toJe.id,
        },
      });
    });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_POST',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: { status: 'APPROVED' } as any,
      newValue: { status: 'POSTED' } as any,
      severity: AuditSeverity.HIGH,
    });

    return result;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user);
    await this.assertCanAccessBothSides(user, existing, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT transactions can be deleted');
    }

    await this.prisma.interCompanyTransaction.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'INTERCOMPANY_DELETE',
      entityType: 'InterCompanyTransaction',
      entityId: id,
      userId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}
